// @ts-nocheck
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getWolfDir, ensureWolfDir, readJSON, writeJSON, appendMarkdown, timeShort, getSizeDisciplineConfig, getReviewHookConfig, getQualityGateConfig, getAutonomyContinuationConfig, getClaimCalibrationConfig, readStdin, readLastAssistantText, normalizeFilePath, hashFilesAtRest, HASH_SENTINEL_UNREADABLE } from "./shared.js";
import { cappedSessionsJson, monthlyRotateMarkdown, rollingWindowJson, acquireFileLock } from "../utils/size-discipline.js";
// Per-session firing cap shared by the buglog-missing and cerebrum-freshness
// stderr nudges. They have no per-state hash to dedup against (unlike the
// review/file gates), so a session-scoped cap is the right shape. Symmetric
// with verify-conclusions' max_fires_per_session. Hard-coded for now;
// promote to config if a project needs to tune it.
const STOP_NUDGE_PER_SESSION_CAP = 3;
/**
 * Atomically claim a per-session nudge slot for the given counter field.
 *
 * Reads _session.json under file lock, checks if the counter < cap, increments
 * + writes back, releases lock. Returns true iff the slot was claimed (caller
 * may emit its stderr nudge). On lock contention OR cap reached, returns
 * false without writing.
 *
 * This is the load-bearing primitive that fixes the round-3 race Codex
 * caught: previously, the counter check read from in-memory `session` and the
 * write happened later under a separate lock, so two concurrent stops could
 * both read counter=0, both emit, then both write counter=1 (the cap
 * effectively becomes capN+concurrency). With read-modify-write under one
 * lock, the cap is honored exactly.
 *
 * `field` is keyof SessionData restricted to the two cap-tracking number
 * fields. Returning false on lock contention preserves the existing "skip
 * silently rather than nudge without a log entry" behavior; the slot is
 * effectively given to whoever wins the next contention.
 */
function exitAfterStderrFlush(code) {
    if (!process.stderr.writableNeedDrain)
        process.exit(code);
    process.stderr.write("", () => process.exit(code));
}
function tryConsumeNudgeSlot(sessionFile, field, capN) {
    const release = acquireFileLock(sessionFile);
    if (!release)
        return false;
    try {
        const onDisk = readJSON(sessionFile, null);
        if (!onDisk || typeof onDisk !== "object")
            return false;
        const prior = typeof onDisk[field] === "number" ? onDisk[field] : 0;
        if (prior >= capN)
            return false;
        onDisk[field] = prior + 1;
        writeJSON(sessionFile, onDisk);
        return true;
    }
    catch {
        return false;
    }
    finally {
        release();
    }
}
async function main() {
    ensureWolfDir();
    const wolfDir = getWolfDir();
    const hooksDir = path.join(wolfDir, "hooks");
    const sessionFile = path.join(hooksDir, "_session.json");
    // Claude Code passes {session_id, transcript_path, stop_hook_active} on stdin.
    // We need transcript_path for the verify-conclusions sub-gate. Tolerate
    // missing/empty stdin — older Claude Code versions or non-Stop invocations
    // may not provide a payload, and we still want the rest of the hook to run.
    let hookPayload = {};
    try {
        const raw = await readStdin();
        if (raw && raw.trim()) {
            hookPayload = JSON.parse(raw);
        }
    }
    catch { }
    // Acquire a lock for the _session.json read-modify-write so concurrent
    // stop hooks cannot lose stop_count increments. We hold the lock only
    // for the increment+persist; the rest of main() reads the local copy.
    // If lock acquisition fails, fall back to a non-persisting read — the
    // increment is dropped (intentional) rather than risking lost increments
    // from a racing unlocked write.
    const sessionLock = acquireFileLock(sessionFile);
    const defaultSession = {
        session_id: "",
        started: "",
        files_read: {},
        files_written: [],
        edit_counts: {},
        anatomy_hits: 0,
        anatomy_misses: 0,
        repeated_reads_warned: 0,
        cerebrum_warnings: 0,
        stop_count: 0,
    };
    let session;
    if (sessionLock) {
        try {
            session = readJSON(sessionFile, defaultSession);
            // Defensive: existing _session.json may pre-date the stop_count field
            // or have it as a non-number; `undefined++` yields NaN which serializes
            // as `null` and corrupts the file.
            const prevCount = typeof session.stop_count === "number" ? session.stop_count : 0;
            session.stop_count = prevCount + 1;
            // Persist the incremented count immediately so a concurrent stop sees it.
            writeJSON(sessionFile, session);
        }
        finally {
            sessionLock();
        }
    }
    else {
        // No lock — read but don't write. Local stop_count increment is lost.
        session = readJSON(sessionFile, defaultSession);
    }
    // Normalize against full SessionData schema. _session.json can be partially
    // initialized by post-write.ts (which only sets files_written + edit_counts)
    // before any session-start hook fires, so any of these fields may be missing
    // or wrong-typed. Defaults preserve everything ledger/review code downstream
    // expects, without overwriting present data.
    if (!session.files_read || typeof session.files_read !== "object" || Array.isArray(session.files_read)) {
        session.files_read = {};
    }
    if (!Array.isArray(session.files_written))
        session.files_written = [];
    if (!session.edit_counts || typeof session.edit_counts !== "object" || Array.isArray(session.edit_counts)) {
        session.edit_counts = {};
    }
    if (typeof session.anatomy_hits !== "number")
        session.anatomy_hits = 0;
    if (typeof session.anatomy_misses !== "number")
        session.anatomy_misses = 0;
    if (typeof session.repeated_reads_warned !== "number")
        session.repeated_reads_warned = 0;
    if (typeof session.cerebrum_warnings !== "number")
        session.cerebrum_warnings = 0;
    if (typeof session.buglog_warnings !== "number")
        session.buglog_warnings = 0;
    if (typeof session.autonomy_continuation_warnings !== "number")
        session.autonomy_continuation_warnings = 0;
    if (typeof session.session_id !== "string")
        session.session_id = "";
    if (!session.session_id && typeof hookPayload.session_id === "string")
        session.session_id = hookPayload.session_id;
    if (typeof session.started !== "string")
        session.started = "";
    // Only write to ledger if there's been activity
    const readCount = Object.keys(session.files_read).length;
    const writeCount = session.files_written.length;
    // Track nudges across all sub-gates so we can exit 2 (advisory failure)
    // when ANY of them fires. This is what makes the autonomy loop work:
    // exit 2 blocks Stop and forces Claude to address the nudge next turn
    // instead of stopping and waiting for the user to re-prompt.
    let nudgeFired = false;
    // Even on a zero-read zero-write turn we still want the conclusion gate to
    // run — a pure-text "verdict" turn (no file ops) is exactly the case the
    // gate was built for. Run it BEFORE the early-return.
    if (readCount === 0 && writeCount === 0) {
        const emptyEntry = {
            id: session.session_id,
            started: session.started,
            ended: new Date().toISOString(),
            reads: [],
            writes: [],
            totals: {
                input_tokens_estimated: 0,
                output_tokens_estimated: 0,
                reads_count: 0,
                writes_count: 0,
                repeated_reads_blocked: session.repeated_reads_warned,
                anatomy_lookups: session.anatomy_hits,
            },
        };
        try {
            const conclusionNudgeFired = maybeNudgeConclusionVerification(wolfDir, session, emptyEntry, hookPayload.transcript_path);
            if (conclusionNudgeFired) {
                nudgeFired = true;
            }
            if (!conclusionNudgeFired && maybeNudgeClaimCalibration(wolfDir, session, emptyEntry, hookPayload.transcript_path)) {
                nudgeFired = true;
            }
            if (maybeNudgeAutonomyContinuation(wolfDir, session, sessionFile, hookPayload.transcript_path)) {
                nudgeFired = true;
            }
        }
        catch { }
        exitAfterStderrFlush(nudgeFired ? 2 : 0);
        return;
    }
    // Check for files edited many times without a buglog entry.
    // Counter increment + cap check happen ATOMICALLY inside tryConsumeNudgeSlot
    // under the _session.json file lock — see the helper for the race that
    // motivated this design (Codex round-3 finding).
    if (checkForMissingBugLogs(wolfDir, session, sessionFile, hookPayload.transcript_path))
        nudgeFired = true;
    // Check if cerebrum was updated this session (it should be if there were edits)
    if (checkCerebrumFreshness(wolfDir, session, sessionFile))
        nudgeFired = true;
    // Build session entry for ledger
    const reads = Object.entries(session.files_read).map(([file, data]) => ({
        file,
        tokens_estimated: data.tokens,
        was_repeated: data.count > 1,
        anatomy_had_description: false, // simplified
    }));
    const writes = session.files_written.map((w) => ({
        file: w.file,
        tokens_estimated: w.tokens,
        action: w.action,
    }));
    const inputTokens = reads.reduce((sum, r) => sum + r.tokens_estimated, 0);
    const outputTokens = writes.reduce((sum, w) => sum + w.tokens_estimated, 0);
    const sessionEntry = {
        id: session.session_id,
        started: session.started,
        ended: new Date().toISOString(),
        reads,
        writes,
        totals: {
            input_tokens_estimated: inputTokens,
            output_tokens_estimated: outputTokens,
            reads_count: readCount,
            writes_count: writeCount,
            repeated_reads_blocked: session.repeated_reads_warned,
            anatomy_lookups: session.anatomy_hits,
        },
    };
    // Update token-ledger.json under a lock so concurrent stop hooks cannot
    // lose updates via read-modify-write races. cappedSessionsJson uses its
    // own lock, so we release ours before calling it to avoid double-locking.
    const ledgerPath = path.join(wolfDir, "token-ledger.json");
    const releaseLedger = acquireFileLock(ledgerPath);
    if (releaseLedger) {
        try {
            const ledger = readJSON(ledgerPath, {
                version: 1,
                created_at: "",
                lifetime: {
                    total_tokens_estimated: 0,
                    total_reads: 0,
                    total_writes: 0,
                    total_sessions: 0,
                    anatomy_hits: 0,
                    anatomy_misses: 0,
                    repeated_reads_blocked: 0,
                    estimated_savings_vs_bare_cli: 0,
                },
                sessions: [],
                daemon_usage: [],
                waste_flags: [],
                optimization_report: { last_generated: null, patterns: [] },
            });
            ledger.sessions.push(sessionEntry);
            ledger.lifetime.total_reads += readCount;
            ledger.lifetime.total_writes += writeCount;
            ledger.lifetime.total_tokens_estimated += inputTokens + outputTokens;
            ledger.lifetime.anatomy_hits += session.anatomy_hits;
            ledger.lifetime.anatomy_misses += session.anatomy_misses;
            ledger.lifetime.repeated_reads_blocked += session.repeated_reads_warned;
            // Estimate savings: anatomy hits save ~200 tokens each, repeated reads blocked save their token count
            const savedFromAnatomy = session.anatomy_hits * 200;
            const savedFromRepeats = Object.values(session.files_read)
                .filter((r) => r.count > 1)
                .reduce((sum, r) => sum + r.tokens * (r.count - 1), 0);
            ledger.lifetime.estimated_savings_vs_bare_cli += savedFromAnatomy + savedFromRepeats;
            writeJSON(ledgerPath, ledger);
        }
        finally {
            releaseLedger();
        }
    }
    // Cap token-ledger sessions array — silent no-op on error.
    // cappedSessionsJson acquires its own lock internally.
    try {
        const cfg = getSizeDisciplineConfig();
        if (cfg.enabled) {
            cappedSessionsJson({
                file: ledgerPath,
                arrayKey: "sessions",
                maxInline: cfg.token_ledger.max_inline_sessions,
                getId: (e) => e.id,
            });
        }
    }
    catch { }
    // Write a session summary line to memory.md if there was meaningful activity.
    // Append AND any subsequent rotate must run under the same lock so a
    // concurrent rotate cannot snapshot the file before our append, then
    // rewrite from the stale snapshot and lose the line.
    if (writeCount > 0) {
        try {
            const uniqueFiles = new Set(session.files_written.map(w => path.basename(w.file)));
            const fileList = [...uniqueFiles].slice(0, 5).join(", ");
            const memoryPath = path.join(wolfDir, "memory.md");
            const releaseMem = acquireFileLock(memoryPath);
            if (releaseMem) {
                try {
                    appendMarkdown(memoryPath, `| ${timeShort()} | Session end: ${writeCount} writes across ${uniqueFiles.size} files (${fileList}) | ${readCount} reads | ~${inputTokens + outputTokens} tok |\n`);
                }
                finally {
                    releaseMem();
                }
            }
            // Rotate older memory.md sections to monthly archive — silent no-op on
            // error. monthlyRotateMarkdown acquires its own lock internally, so we
            // call it after releasing ours.
            try {
                const cfg = getSizeDisciplineConfig();
                if (cfg.enabled) {
                    monthlyRotateMarkdown({
                        file: memoryPath,
                        retentionDays: cfg.memory.retention_days,
                        sectionHeaderPattern: /^## Session: /,
                        getSectionDate: (headerLine) => {
                            // "## Session: 2026-05-19 17:42" → "2026-05-19T17:42:00Z"
                            const m = headerLine.match(/^## Session:\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
                            if (!m)
                                return undefined;
                            return m[2] ? `${m[1]}T${m[2]}:00Z` : `${m[1]}T00:00:00Z`;
                        },
                    });
                }
            }
            catch { }
        }
        catch { }
    }
    // Review-hook nudge: log session to reviewlog.json and prompt for Codex
    // review when thresholds are crossed. Silent no-op on error — never blocks.
    try {
        if (maybeNudgeReview(wolfDir, session, sessionEntry))
            nudgeFired = true;
    }
    catch { }
    // Quality gate: nudge when an edited code file lacks a current adversarial
    // reduction in .wolf/qa/. Soft-mode only — never blocks Stop, but exits 2
    // (advisory failure) when a nudge fires so Claude Code surfaces it visibly
    // and the assistant can't silently skip the warning.
    try {
        if (maybeNudgeQualityGate(wolfDir, session, sessionEntry))
            nudgeFired = true;
    }
    catch { }
    // Verify-conclusions sub-gate: scan the assistant's last text for conclusion
    // language. If hit AND no fresh reduction was written this turn, nudge.
    try {
        const conclusionNudgeFired = maybeNudgeConclusionVerification(wolfDir, session, sessionEntry, hookPayload.transcript_path);
        if (conclusionNudgeFired) {
            nudgeFired = true;
        }
        if (!conclusionNudgeFired && maybeNudgeClaimCalibration(wolfDir, session, sessionEntry, hookPayload.transcript_path)) {
            nudgeFired = true;
        }
        if (maybeNudgeAutonomyContinuation(wolfDir, session, sessionFile, hookPayload.transcript_path)) {
            nudgeFired = true;
        }
    }
    catch { }
    // Note: _session.json was already persisted at the top under a lock to
    // protect the stop_count increment. The local `session` object is otherwise
    // read-only from this hook's perspective; post-read/post-write hooks are
    // the writers for the other fields.
    // Exit 2 when any nudge fired so Claude Code surfaces a clear advisory
    // signal. The turn still completes — Stop already ran — but the assistant
    // sees the non-zero exit code and can't silently miss or ignore the gate.
    exitAfterStderrFlush(nudgeFired ? 2 : 0);
}
// Convert a glob like `<doublestar>/auth/<doublestar>` to a RegExp. Supports
// `**`, `*`, and `?`. `**` matches across path segments (including slashes);
// `*` matches within a single segment; `?` matches a single non-slash char.
//
// CRITICAL: `<doublestar>/` at a segment boundary must match either nothing
// or "any dirs ending in /" — otherwise `<doublestar>/auth/<doublestar>`
// collapses to `.*auth/.*` and matches paths like `src/noauth/x` where
// `auth` is just a substring. We convert `<doublestar>/` to `(?:.*/)?` so
// it anchors on a path segment boundary. (Doc uses <doublestar> instead of
// the literal sequence to avoid closing this comment block prematurely.)
function globToRegex(glob) {
    let re = "";
    let i = 0;
    while (i < glob.length) {
        const c = glob[i];
        if (c === "*" && glob[i + 1] === "*") {
            i += 2;
            if (glob[i] === "/") {
                i++;
                // "**/" at start or after a separator: match zero or more path segments
                re += "(?:.*/)?";
            }
            else {
                // Trailing or mid-path "**": match anything (including slashes)
                re += ".*";
            }
        }
        else if (c === "*") {
            re += "[^/]*";
            i++;
        }
        else if (c === "?") {
            re += "[^/]";
            i++;
        }
        else if (/[.+^${}()|[\]\\]/.test(c)) {
            re += "\\" + c;
            i++;
        }
        else {
            re += c;
            i++;
        }
    }
    return new RegExp("^" + re + "$");
}
function maybeNudgeReview(wolfDir, session, sessionEntry) {
    const reviewCfg = getReviewHookConfig();
    if (!reviewCfg.enabled)
        return false;
    if (sessionEntry.writes.length === 0)
        return false;
    // Approximate lines-changed from output-token estimate: code averages
    // ~3.5 chars/token, ~60 chars/line → ~17 tokens/line.
    const approxLines = Math.round(sessionEntry.totals.output_tokens_estimated / 17);
    const allWrittenFiles = [...new Set(sessionEntry.writes.map(w => w.file))];
    // Filter out scratch/driver/test files: editing a one-off falsifier under
    // /tmp/ or a *.test.ts spec isn't a production-review obligation. Without
    // this, every iteration on a test driver re-fires the nudge.
    const excludeRegexes = reviewCfg.scope_excludes.map(globToRegex);
    const writtenFiles = allWrittenFiles.filter(f => !excludeRegexes.some(re => re.test(f)));
    if (writtenFiles.length === 0)
        return false;
    const pathRegexes = reviewCfg.always_review_paths.map(globToRegex);
    const matchedPaths = writtenFiles.filter(f => pathRegexes.some(re => re.test(f)));
    const sizeTrigger = approxLines >= reviewCfg.min_diff_lines;
    const pathTrigger = matchedPaths.length > 0;
    if (!sizeTrigger && !pathTrigger) {
        const reviewLogPath = path.join(wolfDir, "reviewlog.json");
        const releaseReviewLock = acquireFileLock(reviewLogPath);
        if (!releaseReviewLock)
            return false;
        let refreshNudge = false;
        try {
            const reviewLog = readJSON(reviewLogPath, { version: 1, reviews: [] });
            if (!Array.isArray(reviewLog.reviews))
                return false;
            const existingPending = session.session_id
                ? reviewLog.reviews.find(r => r.session_id === session.session_id && r.status === "pending")
                : undefined;
            const pending = existingPending ?? [...reviewLog.reviews].reverse().find(r => r.status === "pending" && Array.isArray(r.files) && r.files.some((file) => writtenFiles.includes(file)));
            if (!pending)
                return false;
            const currentHashes = hashFilesAtRest(writtenFiles);
            pending.ended = sessionEntry.ended;
            pending.approx_lines_changed = Math.max(pending.approx_lines_changed ?? 0, approxLines);
            pending.files = [...new Set([...(pending.files ?? []), ...writtenFiles])];
            pending.reason = "follow-up edit below review threshold";
            pending.content_hashes = {
                ...(pending.content_hashes ?? {}),
                ...currentHashes,
            };
            const sortedEntries = Object.entries(currentHashes).sort(([a], [b]) => a.localeCompare(b));
            const refreshSig = crypto.createHash("sha256").update(JSON.stringify(sortedEntries)).digest("hex");
            if (!pending.refresh_history)
                pending.refresh_history = {};
            const prevRefreshCount = pending.refresh_history[refreshSig] ?? 0;
            if (prevRefreshCount === 0) {
                pending.refresh_history[refreshSig] = 1;
                refreshNudge = true;
            }
            writeJSON(reviewLogPath, reviewLog);
            if (refreshNudge)
                process.stderr.write(`🔄 OpenWolf review refresh [${pending.id}]: refreshed pending review hashes for ${Object.keys(currentHashes).length} file(s). Review log: ${reviewLogPath}\n`);
        }
        finally {
            releaseReviewLock();
        }
        return refreshNudge;
    }
    const trigger = sizeTrigger && pathTrigger ? "size+path" : sizeTrigger ? "size" : "path";
    const reasonParts = [];
    if (sizeTrigger)
        reasonParts.push(`~${approxLines} lines changed (threshold ${reviewCfg.min_diff_lines})`);
    if (pathTrigger)
        reasonParts.push(`sensitive path(s): ${matchedPaths.slice(0, 3).join(", ")}`);
    const reason = reasonParts.join("; ");
    // Append to reviewlog.json under a file lock so concurrent stop hooks
    // (possible if Claude Code dispatches them in parallel) cannot lose updates.
    // Coalesce with any existing pending entry for the same session_id.
    const reviewLogPath = path.join(wolfDir, "reviewlog.json");
    const releaseReviewLock = acquireFileLock(reviewLogPath);
    if (!releaseReviewLock) {
        // Couldn't acquire lock — skip the nudge entirely. Emitting a nudge
        // without a matching reviewlog entry would confuse the user.
        return false;
    }
    let nextId = "";
    let coalescedSilent = false;
    let suppressedByCap = false; // Fix-3: nudge-cap suppression flag
    let nudgeCountForState = 1;
    try {
        // Re-read AFTER lock acquisition to capture concurrent appends.
        const reviewLog = readJSON(reviewLogPath, { version: 1, reviews: [] });
        if (!reviewLog.reviews)
            reviewLog.reviews = [];
        const existingPending = session.session_id
            ? reviewLog.reviews.find(r => r.session_id === session.session_id && r.status === "pending")
            : undefined;
        // Delta coalesce: across sessions, the user works on the same code from
        // multiple Stop turns. A fresh ID per session means review-0020, -0021,
        // -0022, … all wrap the same diff. We coalesce only when the *on-disk
        // content* of every written file matches a prior completed review's
        // recorded hashes. A size heuristic (±15% line count) was rejected: it can
        // false-positive on genuinely-new code of similar shape, silently skipping
        // the review obligation. Content hashes are exact — no review required
        // means no content change since the prior review. See bug-091b, R3-3.
        //
        // Look back at the last 5 entries to bound the scan. Older entries are
        // unlikely to be relevant, and unbounded scan is a DoS vector if the log
        // ever grows past the retention sweep.
        const currentHashes = hashFilesAtRest(writtenFiles);
        // If any current file is "unreadable" (transient FS error, oversized,
        // non-regular file), we can't confidently identify what was just edited
        // — never coalesce. Forces a fresh review nudge in the rare "Stop fires
        // while file is transiently inaccessible" case. Safer to over-nudge than
        // to silently match an unreadable-vs-unreadable pair (where the two
        // unreadables may correspond to entirely different bytes). See Codex
        // round-final finding #2 and bug-101.
        //
        // NOTE: "tombstone" (file was deleted, ENOENT) is a STABLE identity and
        // DOES participate in coalesce — sibling reports 1 + 4 (bug-085 class)
        // showed that without tombstone semantics, a single deleted file in
        // session.files_written caused infinite review re-fires (every Stop
        // turn the file is "unreadable", every coalesce skips, every nudge
        // re-fires for the same diff). With tombstone, two consecutive stops
        // see the same tombstone identity → coalesce hits → silent.
        const currentHasUnreadable = Object.values(currentHashes).some(h => h === HASH_SENTINEL_UNREADABLE);
        // Lookback window: previously 5, widened to 50 in Fix-2 (sibling reports
        // showed review-0029 through 0037 — 9 entries — all wrapping the same
        // diff, so a 5-entry tail missed the original completed review). 50 is
        // still bounded (retention sweep caps reviewlog at ~30 days anyway) and
        // covers realistic multi-session work spans. Configurable via
        // openwolf.review_hook.coalesce_lookback.
        //
        // Sanitize:
        //  - undefined/null/non-number/non-finite/string → default 50
        //  - 0 or negative → 0 (DISABLES coalesce — user-intent honored;
        //    `?? 50` would have preserved a user-set 0 and slice(-0) returns
        //    the FULL array, defeating the bounded-window DoS guard the
        //    design explicitly set out to provide; see Fix-2 Claude review #1)
        //  - positive integer → floored value
        const rawLookback = reviewCfg.coalesce_lookback;
        let lookbackN;
        if (rawLookback === undefined || rawLookback === null
            || typeof rawLookback !== "number" || !Number.isFinite(rawLookback)) {
            lookbackN = 50;
        }
        else if (rawLookback <= 0) {
            lookbackN = 0;
        }
        else {
            // Clamp positive values to LOOKBACK_HARD_CAP (=50000). A user-supplied
            // Number.MAX_SAFE_INTEGER would otherwise bypass the bounded-window
            // DoS guard by making the absolute lookback exceed the log length.
            // 50000 is ~3 orders of magnitude above the realistic working range
            // (50 default × 1000) and stays well under array-indexing limits.
            // See Fix-2 Codex round-2 LOW finding.
            lookbackN = Math.min(Math.floor(rawLookback), 50000);
        }
        let deltaMatch;
        if (!existingPending && !currentHasUnreadable && lookbackN > 0) {
            const tail = reviewLog.reviews.slice(-lookbackN);
            const currentPaths = new Set(Object.keys(currentHashes));
            // Scan newest → oldest. The IDENTITY of the current file set is
            // established by the most recent prior review that touched any of
            // these files: if that review's recorded hash differs, the user
            // changed state between then and now (even if they later reverted
            // to a hash matching an older review) — that's a state change
            // worth nudging. Aborting on the first overlapping-but-differing
            // review prevents A→B→A reversions from silently coalescing
            // against the original A-review (Codex Fix-2 review HIGH #1).
            for (let i = tail.length - 1; i >= 0; i--) {
                const r = tail[i];
                if (r.status !== "completed")
                    continue;
                // Pre-content-hash entries lack the field; never coalesce against them
                // (defensive — old completed reviews shouldn't suppress new work).
                if (!r.content_hashes)
                    continue;
                // Prior entries that recorded any "unreadable" hash are ambiguous —
                // we don't know what bytes were actually reviewed for that file. Never
                // coalesce against them, but ALSO don't let them abort the scan —
                // an unreadable in a prior review doesn't tell us anything about
                // state changes either way. Skip and keep walking.
                if (Object.values(r.content_hashes).some(h => h === HASH_SENTINEL_UNREADABLE))
                    continue;
                // Does this prior review touch any of the currently-written files?
                const overlappingPaths = Object.keys(r.content_hashes).filter(p => currentPaths.has(p));
                if (overlappingPaths.length === 0)
                    continue;
                // Every overlapping file's prior hash must equal its current hash.
                // Real sha256 and tombstone both participate; unreadable is already
                // skipped above. Tombstone-vs-tombstone is a coalesce hit (stable
                // identity); tombstone-vs-sha or sha1-vs-sha2 is a mismatch.
                const overlappingMatches = overlappingPaths.every(p => r.content_hashes?.[p] === currentHashes[p]);
                if (!overlappingMatches) {
                    // The most recent overlapping review recorded a DIFFERENT hash for
                    // at least one of these files. That's the relevant prior state —
                    // do not walk further into older history (A→B→A guard).
                    break;
                }
                // Overlapping files all match. But we also need every CURRENT file
                // to be covered by SOME prior review, not just this one. The simplest
                // correct check: this prior review must cover EVERY current path.
                // (A partial overlap with full match still leaves uncovered current
                // files whose state we haven't verified against any prior review.)
                if (overlappingPaths.length !== currentPaths.size) {
                    // Partial overlap, all overlapping hashes match — but some current
                    // files weren't in this prior review. Those files might be at a
                    // never-reviewed state. Don't coalesce. (Also don't abort — an
                    // older review might cover the missing files at matching hashes
                    // without intervening edits.)
                    continue;
                }
                deltaMatch = r;
                break;
            }
        }
        if (existingPending) {
            // Coalesce: refresh end timestamp, union files, take max line count.
            // CRITICAL: also refresh content_hashes for the currently-written files.
            // Without this, a future delta coalesce could silently match against
            // bytes that were never actually reviewed (Stop 1 records hash v1, Stop
            // 2 in same session writes v2 but leaves stored hash at v1; user
            // reviews v2 → entry completed with hash v1; later session writes back
            // v1 → false-positive coalesce skips a never-reviewed state). See
            // Codex round-final finding #1.
            existingPending.ended = sessionEntry.ended;
            existingPending.approx_lines_changed = Math.max(existingPending.approx_lines_changed, approxLines);
            existingPending.files = [...new Set([...existingPending.files, ...writtenFiles])];
            existingPending.reason = reason;
            existingPending.trigger = trigger;
            existingPending.content_hashes = {
                ...(existingPending.content_hashes ?? {}),
                ...currentHashes,
            };
            if (pathTrigger) {
                existingPending.matched_paths = [...new Set([...(existingPending.matched_paths ?? []), ...matchedPaths])];
            }
            nextId = existingPending.id;
        }
        else if (deltaMatch) {
            // Delta coalesce hit: don't allocate a new ID, don't append, don't nudge.
            // Do NOT mutate the prior entry — mutating .ended would make a stale
            // completed review appear current and extend its retention, masking that
            // it was actually completed long ago. The prior review stands as-is.
            // See R3-4.
            nextId = deltaMatch.id;
            coalescedSilent = true;
        }
        else {
            // ID generation: max existing N + 1, NOT array length. Length-based
            // IDs collide if entries are deleted or if a concurrent process
            // appended before us.
            let maxN = 0;
            for (const r of reviewLog.reviews) {
                const m = r.id.match(/^review-(\d+)$/);
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (n > maxN)
                        maxN = n;
                }
            }
            nextId = `review-${String(maxN + 1).padStart(4, "0")}`;
            reviewLog.reviews.push({
                id: nextId,
                session_id: session.session_id,
                ended: sessionEntry.ended,
                files: writtenFiles,
                approx_lines_changed: approxLines,
                reason,
                status: "pending",
                trigger,
                content_hashes: currentHashes,
                ...(pathTrigger ? { matched_paths: matchedPaths } : {}),
            });
        }
        // Fix-3: per-(review-id, content-hash-tuple) nudge cap.
        // If this exact (id, hash-tuple) has been nudged ≥cap times already,
        // suppress further nudges for this state. The entry stays pending and
        // a material code change creates a new tuple-key with a fresh counter.
        // Skip the cap entirely on delta-coalesce hits (they don't nudge anyway).
        if (!coalescedSilent) {
            const rawCap = reviewCfg.nudge_cap;
            // Same sanitization shape as coalesce_lookback: invalid → default,
            // 0 → disabled (no cap), positive → floored, hard-cap at 100 so a
            // misconfigured huge value can't run nudge_history maps to gigabytes.
            let capN;
            if (rawCap === undefined || rawCap === null
                || typeof rawCap !== "number" || !Number.isFinite(rawCap)) {
                capN = 3;
            }
            else if (rawCap <= 0) {
                capN = 0;
            }
            else {
                capN = Math.min(Math.floor(rawCap), 100);
            }
            if (capN > 0) {
                // Hash-tuple signature: sha256 of canonical-JSON of content_hashes.
                // Keys sorted to ensure {a:x, b:y} and {b:y, a:x} hash identically.
                const sortedEntries = Object.entries(currentHashes).sort(([a], [b]) => a.localeCompare(b));
                const sig = crypto.createHash("sha256").update(JSON.stringify(sortedEntries)).digest("hex");
                // Find the entry we just modified or created.
                const entry = reviewLog.reviews.find(r => r.id === nextId);
                if (entry) {
                    if (!entry.nudge_history)
                        entry.nudge_history = {};
                    const prevCount = entry.nudge_history[sig] ?? 0;
                    nudgeCountForState = Math.min(prevCount + 1, capN);
                    if (prevCount >= capN) {
                        suppressedByCap = true;
                        // Don't increment further — count saturates at cap. Keeps the
                        // value bounded and signals "we've stopped nudging for this state".
                    }
                    else {
                        entry.nudge_history[sig] = nudgeCountForState;
                    }
                }
            }
        }
        writeJSON(reviewLogPath, reviewLog);
    }
    finally {
        releaseReviewLock();
    }
    // Apply rolling-window retention on reviewlog — runs AFTER our lock is
    // released; rollingWindowJson re-reads under its own lock so this is safe.
    try {
        const sizeCfg = getSizeDisciplineConfig();
        if (sizeCfg.enabled) {
            rollingWindowJson({
                file: reviewLogPath,
                arrayKey: "reviews",
                getDate: (e) => e.ended,
                getId: (e) => e.id,
                retentionDays: sizeCfg.reviewlog.retention_days,
            });
        }
    }
    catch { }
    // Delta coalesce hit: a prior completed review already covers this work.
    // Don't emit a nudge — return false so the hook doesn't drive exit 2.
    if (coalescedSilent)
        return false;
    // Fix-3: nudge-cap suppression. The (review-id, content-hash-tuple) has
    // already fired ≥cap nudges; further fires for this exact state are noise.
    // The entry stays pending in reviewlog so the obligation is preserved; the
    // assistant can address it without the gate re-pestering every turn.
    if (suppressedByCap)
        return false;
    // Emit advisory nudge (stderr → next-turn context, never blocks).
    //
    // Suggests known reviewer companions and a generic installed-plugin fallback.
    // The local AI plugin set changes over time, so avoid hardcoding every vendor;
    // assistants should inspect available slash commands/subagents and use any
    // suitable installed reviewer plugin when present. The assistant picks one
    // (or runs multiple for independent takes) and iterates until production-ready.
    if (reviewCfg.nudge_only) {
        const fileList = writtenFiles.slice(0, 3).join(", ");
        const more = writtenFiles.length > 3 ? ` +${writtenFiles.length - 3} more` : "";
        const cmd = redactSecrets(reviewCfg.codex_command);
        const repeat = nudgeCountForState > 1 ? ` Repeat ${nudgeCountForState}/${Math.max(1, reviewCfg.nudge_cap || 3)} for this exact file-hash state; if a review is already in flight, wait for it or complete it with the helper below. ` : "";
        process.stderr.write(`🔍 OpenWolf review nudge [${nextId}]: ${reason}. ` +
            `Files: ${fileList}${more}.${repeat} ` +
            `Consider an independent review BEFORE you stop — one of these US-based companions ` +
            `(pick one, or run more than one for a panel):\n` +
            `  • Codex (OpenAI):  mkdir /tmp/codex-${nextId} && cp <files> /tmp/codex-${nextId}/ && ` +
            `cd /tmp/codex-${nextId} && ${cmd} -o /tmp/codex_${nextId}.txt ` +
            `"Are there critical flaws or things I overlooked in ./<file> that are important to the code intent?"\n` +
            `  • ChatGPT (OpenAI):  Use Agent tool with subagent_type "chatgpt:chatgpt-rescue" ` +
            `or run /chatgpt:ask review --file <abs-path> for each file.\n` +
            `  • Claude (Anthropic, claude.ai subscription):  Use Agent tool with subagent_type "claude:claude-rescue" ` +
            `or run /claude:ask review --file <abs-path> for each file.\n` +
            `  • Grok (xAI):  Use Agent tool with subagent_type "grok:grok-rescue" ` +
            `or run /grok:ask review --file <abs-path> for each file.\n` +
            `  • Other installed AI reviewer plugins: inspect available slash commands/subagents ` +
            `and use a suitable reviewer if present; record its provider label in --reviewer.\n` +
            `If one reviewer hangs for several minutes on a small file, stop it and try a different model family; stale local brokers can wedge silently.\n` +
            `Review log: ${reviewLogPath}\n` +
            `Iterate until the reviewer gives a production-ready OK, then run:\n` +
            `  node ${path.join(wolfDir, "hooks", "complete-review.js")} ${nextId} --reviewer <codex|chatgpt|claude|grok|other|manual> --summary "<one-line outcome>"\n` +
            `If the review leads to edits, re-review after the next Stop refreshes this pending review's hashes; a hash-drift refusal means the helper protected you from closing unreviewed bytes. ` +
            `If complete-review reports a lock error, rerun it after a moment. ` +
            `Do not edit .wolf/reviewlog.json by hand.\n`);
        return true;
    }
    return false;
}
/**
 * Strip likely-secret material from a shell-command string before echoing it
 * to stderr (which lands in the next-turn assistant context, and may be
 * uploaded to telemetry). The redactor is conservative: it catches the most
 * common shapes (env-var assignments with token-like values, --token/--api-key
 * flag values, bare tokens with `sk-`/`ghp_`/etc. prefixes) and leaves the
 * rest alone. The risk model here is the user putting a token directly into
 * `openwolf.review_hook.codex_command` config — not a determined exfiltrator.
 */
function redactSecrets(cmd) {
    if (!cmd)
        return cmd;
    let out = cmd;
    // KEY=value where the key name looks credential-ish OR the value matches a
    // known token prefix. Use the matched separator (space, ;, &, end) verbatim
    // so we don't mangle command structure.
    out = out.replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASS(?:WORD)?|AUTH|CRED(?:ENTIALS?)?|API_?KEY|URL|URI|DSN|CONN(?:ECTION)?(?:_STR(?:ING)?)?))=\S+/gi, "$1=***REDACTED***");
    out = out.replace(/\b([A-Z][A-Z0-9_]*)=(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})/g, "$1=***REDACTED***");
    // --token=value / --token value, --api-key, --auth, --password, --secret
    out = out.replace(/(--(?:token|api[-_]?key|auth(?:[-_]?token)?|password|secret|bearer)[=\s]+)\S+/gi, "$1***REDACTED***");
    // -H 'Authorization: Bearer foo' / Authorization: Basic xyz (any quoting).
    // Match the header name + value run, replace just the credential portion.
    out = out.replace(/(Authorization\s*:\s*(?:Bearer|Basic|Digest|Token)\s+)[^\s'")]+/gi, "$1***REDACTED***");
    // URL with embedded user:password — schema://user:pass@host[/...]
    // Cover http(s), postgres(ql), mysql, mongodb, redis, amqp, ftp, ssh, etc.
    // The userinfo segment is the bit we redact; keep the rest of the URL intact.
    out = out.replace(/\b([a-z][a-z0-9+\-.]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1***REDACTED***@");
    // Bare token-prefixed strings anywhere in the command
    out = out.replace(/\b(sk-[A-Za-z0-9_\-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})/g, "***REDACTED***");
    return out;
}
/**
 * Check if files were edited multiple times but buglog.json wasn't updated.
 * Emit a stderr reminder so Claude sees it in the next turn.
 */
function buglogFalsePositiveAcknowledged(text) {
    if (!text)
        return false;
    return /false[- ]positive/i.test(text)
        && /buglog|bug log/i.test(text)
        && /not (?:a )?bug ?fix|not bug ?fix|no (?:new )?buglog|no buglog entry warranted|nothing to log/i.test(text);
}
function checkForMissingBugLogs(wolfDir, session, sessionFile, transcriptPath) {
    if (!session.edit_counts)
        return false;
    // Scratch/driver/test exclusions — repeatedly editing a /tmp falsifier or a
    // *.test.ts isn't a bug-fix obligation. Filter BEFORE the threshold check so
    // an excluded file's edit count never contributes to the multi-edit set.
    const qualityCfg = getQualityGateConfig();
    const buglogExcludeRegexes = qualityCfg.buglog_scan_excludes.map(globToRegex);
    const isExcluded = (file) => buglogExcludeRegexes.some(re => re.test(file));
    // The full edit_counts keys are absolute paths (post-write.ts records them
    // that way); multiEditFileKeys keeps the original paths for identity match
    // against files_written, multiEditDisplay is the basename list for the
    // user-facing nudge.
    const multiEditEntries = Object.entries(session.edit_counts).filter(([file, count]) => count >= 3 && !isExcluded(file));
    if (multiEditEntries.length === 0)
        return false;
    const multiEditFileKeys = new Set(multiEditEntries.map(([file]) => normalizeFilePath(file)));
    const multiEditDisplay = multiEditEntries.map(([file]) => path.basename(file));
    const latestByFile = new Map();
    // Change-detection: don't nudge if buglog.json was modified more recently
    // than the most recent edit *to one of the multi-edit files*. Using
    // session-cumulative latestEditMs over ALL files_written (Codex R3-2) would
    // make a later unrelated edit re-fire the warning even when the multi-edit
    // obligation was already addressed; scoping to the multi-edit file set
    // matches the intent. The buglog-written fallback (R3-1) must also be
    // scoped: a buglog write earlier in the session before subsequent multi-
    // edits doesn't discharge the obligation for those later edits.
    const buglogPath = path.join(wolfDir, "buglog.json");
    let buglogMtimeMs = 0;
    try {
        buglogMtimeMs = fs.statSync(buglogPath).mtimeMs;
    }
    catch {
        // buglog doesn't exist → treat as never-written (mtime stays 0)
    }
    // Match this project's bug log EXACTLY — not bare-substring, not suffix.
    // The producer (post-write.ts) only allowlists `relPath === ".wolf/buglog.json"`
    // computed against THIS project's root, so the consumer's predicate must use
    // the same project-anchored identity. A bare `.endsWith("/.wolf/buglog.json")`
    // would still over-match nested fixtures like `fixtures/.wolf/buglog.json` or
    // a vendored upstream's `.wolf/buglog.json` (codex review-0031 caught this
    // residual over-match after Claude review-0030's substring tightening). Use
    // `normalizeFilePath` so backslash/case variants on case-insensitive FS still
    // compare equal — mirrors normalizeFilePath's use for multiEditFileKeys above.
    const buglogIdentity = normalizeFilePath(buglogPath);
    // latestRelevantEditMs: the max `at` timestamp across files_written whose
    // normalized path is in the multi-edit set. Falls back to 0 if no
    // multi-edit file has a parseable timestamp (in which case mtime-based
    // suppression is skipped and we rely on the in-session fallback below).
    let latestRelevantEditMs = 0;
    let latestBuglogWriteMs = 0;
    for (const w of session.files_written) {
        if (typeof w.at !== "string")
            continue;
        const t = Date.parse(w.at);
        if (Number.isNaN(t))
            continue;
        const normalized = normalizeFilePath(w.file);
        if (multiEditFileKeys.has(normalized)) {
            latestByFile.set(normalized, Math.max(latestByFile.get(normalized) ?? 0, t));
            if (t > latestRelevantEditMs) {
                latestRelevantEditMs = t;
            }
        }
        if (normalized === buglogIdentity && t > latestBuglogWriteMs) {
            latestBuglogWriteMs = t;
        }
    }
    // Mtime-on-disk suppression: buglog newer than the latest multi-edit.
    if (buglogMtimeMs > latestRelevantEditMs && latestRelevantEditMs > 0)
        return false;
    // In-session buglog-write suppression — must be AT OR AFTER the latest
    // multi-edit. An earlier-in-the-session buglog write that predates a later
    // 3rd-edit on a file does NOT discharge the obligation.
    if (latestBuglogWriteMs > 0 && latestBuglogWriteMs >= latestRelevantEditMs)
        return false;
    const signaturePayload = multiEditEntries.map(([file, count]) => {
        const normalized = normalizeFilePath(file);
        return [normalized, count, latestByFile.get(normalized) ?? 0];
    }).sort(([a], [b]) => String(a).localeCompare(String(b)));
    const signature = crypto.createHash("sha256").update(JSON.stringify(signaturePayload)).digest("hex");
    const sessionState = readJSON(sessionFile, {});
    if (sessionState.buglog_false_positive_acks?.[signature]) {
        return false;
    }
    const priorWarnings = typeof sessionState.buglog_warnings === "number" ? sessionState.buglog_warnings : 0;
    const lastAssistant = priorWarnings > 0 ? readLastAssistantText(transcriptPath) : null;
    if (buglogFalsePositiveAcknowledged(lastAssistant?.text)) {
        const release = acquireFileLock(sessionFile);
        if (release) {
            try {
                const onDisk = readJSON(sessionFile, {});
                if (!onDisk.buglog_false_positive_acks || typeof onDisk.buglog_false_positive_acks !== "object")
                    onDisk.buglog_false_positive_acks = {};
                onDisk.buglog_false_positive_acks[signature] = {
                    at: new Date().toISOString(),
                    files: multiEditDisplay,
                };
                writeJSON(sessionFile, onDisk);
            }
            catch { }
            finally {
                release();
            }
        }
        return false;
    }
    // Per-session firing cap (atomically read-checked-incremented under the
    // _session.json file lock by tryConsumeNudgeSlot — see the helper's
    // docblock for the Codex round-3 race that motivated the lock).
    if (!tryConsumeNudgeSlot(sessionFile, "buglog_warnings", STOP_NUDGE_PER_SESSION_CAP)) {
        return false;
    }
    process.stderr.write(`⚠️ OpenWolf: Files edited 3+ times this session (${multiEditDisplay.join(", ")}) but buglog.json was not updated. If you fixed bugs, please log them.\n`);
    return true;
}
/**
 * Check if cerebrum.md was updated recently. If it hasn't been updated in
 * a while and there was significant activity, emit a gentle reminder.
 */
function checkCerebrumFreshness(wolfDir, session, sessionFile) {
    const cerebrumPath = path.join(wolfDir, "cerebrum.md");
    try {
        const stat = fs.statSync(cerebrumPath);
        const hoursSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
        // If cerebrum hasn't been updated in 24h+ and there were significant writes
        if (hoursSinceUpdate > 24 && session.files_written.length >= 3) {
            // Per-session firing cap, atomically claimed under the _session.json
            // file lock (see tryConsumeNudgeSlot for the race motivation).
            if (!tryConsumeNudgeSlot(sessionFile, "cerebrum_warnings", STOP_NUDGE_PER_SESSION_CAP)) {
                return false;
            }
            process.stderr.write(`💡 OpenWolf: cerebrum.md hasn't been updated in ${Math.floor(hoursSinceUpdate)}h. Did you learn any user preferences, conventions, or gotchas this session? Consider updating .wolf/cerebrum.md.\n`);
            return true;
        }
    }
    catch {
        // cerebrum.md doesn't exist, that's ok
    }
    return false;
}
const CODE_EXTENSIONS = new Set([
    ".go", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".rs",
    ".c", ".cc", ".cpp", ".h", ".hpp", ".java", ".rb", ".php",
    ".swift", ".scala", ".sh", ".sql"
]);
const EXCLUDE_PATH_FRAGMENTS = [
    ".wolf/", "node_modules/", ".git/", "dist/", "build/",
    "__tests__/", "/test/", "/tests/", "/spec/", "/__mocks__/",
];
const EXCLUDE_PATH_SEGMENT_PATTERNS = [
    /(^|\/)test\//,
    /(^|\/)tests\//,
    /(^|\/)spec\//,
    /(^|\/)__tests__\//,
    /(^|\/)__mocks__\//,
];
const TEST_FILE_PATTERNS = [
    /\.(test|spec)\.[^/]+$/,
    /_test\.go$/,
    /(^|\/)test_[^/]+\.py$/,
    /_test\.py$/,
    /_spec\.rb$/,
    /_test\.rb$/,
    /\.test\.rs$/,
];
const JAVA_TEST_FILE_PATTERNS = [
    /(^|\/)Test[^/]*\.java$/,
    /(^|\/)[^/]*Test\.java$/,
    /(^|\/)[^/]*Tests\.java$/,
];
function isCodeFile(file) {
    const ext = path.extname(file).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext))
        return false;
    // Test files are excluded — they verify behavior, not assumptions.
    if (ext === ".java" && JAVA_TEST_FILE_PATTERNS.some(re => re.test(file)))
        return false;
    const lower = file.toLowerCase();
    if (TEST_FILE_PATTERNS.some(re => re.test(lower)))
        return false;
    for (const frag of EXCLUDE_PATH_FRAGMENTS) {
        if (lower.includes(frag))
            return false;
    }
    if (EXCLUDE_PATH_SEGMENT_PATTERNS.some(re => re.test(lower)))
        return false;
    return true;
}
function hashFileContent(absPath) {
    try {
        const buf = fs.readFileSync(absPath);
        return crypto.createHash("sha256").update(buf).digest("hex");
    }
    catch {
        return null;
    }
}
function nearestWolfDirForFile(file, fallbackWolfDir) {
    let dir = path.dirname(path.resolve(file));
    while (true) {
        const candidate = path.join(dir, ".wolf");
        try {
            if (fs.statSync(candidate).isDirectory())
                return candidate;
        }
        catch { }
        const parent = path.dirname(dir);
        if (parent === dir)
            return fallbackWolfDir;
        dir = parent;
    }
}
function readQaFrontmatter(file) {
    try {
        const fd = fs.openSync(file, "r");
        try {
            const buf = Buffer.alloc(8192);
            const n = fs.readSync(fd, buf, 0, buf.length, 0);
            const text = buf.toString("utf8", 0, n);
            const end = text.indexOf("\n---", 4);
            return end === -1 ? text : text.slice(0, end + 5);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return "";
    }
}
/**
 * Scan .wolf/qa/*.md files for one whose frontmatter `target-hash` matches the
 * given content hash. Read through the frontmatter (capped at 8 KiB) so multi-file
 * reductions with several target-hash lines do not silently fall past a 2 KiB head.
 */
function qaReductionExists(qaDir, _file, contentHash) {
    let names;
    try {
        names = fs.readdirSync(qaDir);
    }
    catch {
        return false;
    }
    for (const name of names) {
        if (!name.endsWith(".md"))
            continue;
        if (name.startsWith("_"))
            continue; // _README.md, _template.md
        const full = path.join(qaDir, name);
        const head = readQaFrontmatter(full);
        if (!head)
            continue;
        // Match frontmatter line: target-hash: <hex> OR target-hash-<suffix>: <hex>
        // (quotes optional). The suffixed form lets a single reduction cover
        // multiple files (e.g. target-hash-stop-ts, target-hash-shared-ts) since
        // matching only the singular `target-hash:` would falsely require one
        // reduction per file even when the assumptions span them.
        const re = /^target-hash(?:-[a-zA-Z0-9_-]+)?:\s*["']?([a-f0-9]{16,64})["']?\s*$/gm;
        let m;
        while ((m = re.exec(head)) !== null) {
            if (m[1] === contentHash)
                return true;
        }
    }
    return false;
}
function maybeNudgeQualityGate(wolfDir, session, sessionEntry) {
    const cfg = getQualityGateConfig();
    if (!cfg.enabled || cfg.scope === "none")
        return false;
    if (sessionEntry.writes.length === 0)
        return false;
    // Deduplicate edited files, filter to in-scope code files
    const written = [...new Set(sessionEntry.writes.map(w => w.file))];
    const excludeRegexes = cfg.scope_excludes.map(globToRegex);
    const candidates = [];
    for (const file of written) {
        if (!isCodeFile(file))
            continue;
        // Scratch/driver/test exclusions — scope_excludes overrides scope_paths
        // and "all" alike. An excluded file is never a QA-reduction obligation.
        if (excludeRegexes.some(re => re.test(file)))
            continue;
        if (cfg.scope === "paths") {
            const matched = cfg.scope_paths.some(g => globToRegex(g).test(file));
            if (!matched)
                continue;
        }
        candidates.push(file);
    }
    if (candidates.length === 0)
        return false;
    const defaultQaDir = path.join(wolfDir, "qa");
    const qaDirsByFile = {};
    const qaDirsScanned = new Set();
    const missing = [];
    const missingHashes = {};
    for (const file of candidates) {
        const fileWolfDir = nearestWolfDirForFile(file, wolfDir);
        const qaDir = path.join(fileWolfDir, "qa");
        qaDirsByFile[file] = qaDir;
        qaDirsScanned.add(qaDir);
        try {
            fs.mkdirSync(qaDir, { recursive: true });
        }
        catch { }
        const hash = hashFileContent(file);
        if (!hash)
            continue; // file unreadable — skip silently
        if (!qaReductionExists(qaDir, file, hash)) {
            missing.push(file);
            missingHashes[file] = hash;
        }
    }
    const qaDir = defaultQaDir;
    try {
        fs.mkdirSync(qaDir, { recursive: true });
    }
    catch { }
    const decision = missing.length === 0 ? "ok" : "nudge";
    // Sanitize nudge_cap symmetric with ReviewHookConfig: invalid → 3,
    // ≤0 → disabled (0), positive → floor + hard-cap at 100. Same trap
    // class as coalesce_lookback; same defense.
    const rawCap = cfg.nudge_cap;
    let capN;
    if (rawCap === undefined || rawCap === null
        || typeof rawCap !== "number" || !Number.isFinite(rawCap)) {
        capN = 3;
    }
    else if (rawCap <= 0) {
        capN = 0;
    }
    else {
        capN = Math.min(Math.floor(rawCap), 100);
    }
    // Canonical sig over (sorted [path, content_hash] pairs) — used to dedup
    // nudges across Stop invocations on the same unreduced set. Same pattern
    // as the review-hook cap. Only computed for nudge decisions.
    let missingSig;
    if (decision === "nudge") {
        const sortedPairs = missing.slice().sort().map(f => [f, missingHashes[f]]);
        missingSig = crypto.createHash("sha256").update(JSON.stringify(sortedPairs)).digest("hex");
    }
    // Log the gate decision (append-only, retention-trimmed below)
    const gateLogPath = path.join(qaDir, "_gate-log.json");
    const releaseGateLock = acquireFileLock(gateLogPath);
    if (!releaseGateLock) {
        // Lock contention — skip without nudging; a nudge without a matching
        // log entry would confuse the user.
        return false;
    }
    let nextId = "gate-00001";
    let suppressedByFileCap = false;
    try {
        const gateLog = readJSON(gateLogPath, { version: 1, entries: [] });
        if (!gateLog.entries)
            gateLog.entries = [];
        // Per-(missing-files-sig) cap. Count prior file-type nudge entries with
        // the same missing_sig. If >= capN, suppress this nudge (and don't
        // pollute the log with a duplicate entry).
        if (decision === "nudge" && capN > 0 && missingSig) {
            const priorNudges = gateLog.entries.filter(e => (e.type === "file" || e.type === undefined)
                && e.decision === "nudge"
                && e.missing_sig === missingSig).length;
            if (priorNudges >= capN) {
                suppressedByFileCap = true;
            }
        }
        if (suppressedByFileCap) {
            // No-op: don't append, don't nudge. The previous entries already
            // recorded the gate's verdict.
        }
        else {
            let maxN = 0;
            for (const e of gateLog.entries) {
                const m = e.id.match(/^gate-(\d+)$/);
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (n > maxN)
                        maxN = n;
                }
            }
            nextId = `gate-${String(maxN + 1).padStart(5, "0")}`;
            gateLog.entries.push({
                id: nextId,
                session_id: session.session_id,
                ended: sessionEntry.ended,
                type: "file",
                files_checked: candidates,
                files_missing_reduction: missing,
                qa_dirs_scanned: [...qaDirsScanned],
                missing_sig: missingSig,
                decision,
                mode: cfg.nudge_only ? "soft" : "hard",
                trigger: "stop",
            });
            writeJSON(gateLogPath, gateLog);
        }
    }
    finally {
        releaseGateLock();
    }
    if (suppressedByFileCap)
        return false;
    // Apply rolling-window retention; archive lands in .wolf/archive/, not
    // .wolf/qa/archive/, so it's co-located with the other archived logs.
    try {
        const sizeCfg = getSizeDisciplineConfig();
        if (sizeCfg.enabled) {
            rollingWindowJson({
                file: gateLogPath,
                arrayKey: "entries",
                getDate: (e) => e.ended,
                getId: (e) => e.id,
                retentionDays: cfg.retention_days,
                archiveDir: path.join(wolfDir, "archive"),
            });
        }
    }
    catch { }
    if (decision === "ok")
        return false;
    if (!cfg.nudge_only)
        return false; // hard mode would block, but we don't ship that yet
    const fileList = missing.slice(0, 3).join(", ");
    const more = missing.length > 3 ? ` +${missing.length - 3} more` : "";
    const qaDirList = [...new Set(missing.map(f => qaDirsByFile[f] ?? defaultQaDir))];
    const qaDirDisplay = qaDirList.slice(0, 2).join(", ") + (qaDirList.length > 2 ? ` +${qaDirList.length - 2} more` : "");
    process.stderr.write(`🧪 OpenWolf quality gate [${nextId}]: ${missing.length} edited code file(s) ` +
        `lack a current adversarial reduction in ${qaDirDisplay}. ` +
        `Files: ${fileList}${more}. ` +
        `Before claiming done, write a reduction (see .wolf/qa/_template.md) that names ` +
        `≥${cfg.min_assumptions} concrete assumptions the code makes and ` +
        `${cfg.require_run_output ? "shows a run that falsifies the riskiest one" : "explains why each holds"}.\n`);
    return true;
}
/**
 * Verify-conclusions sub-gate. Reads the assistant's last text turn from the
 * transcript, scans for conclusion-language patterns. If ≥min_pattern_hits
 * distinct patterns match AND the gate log has no covering reduction entry
 * for this session, emit a stderr nudge requiring the assistant to test the
 * conclusion twice before stating it as fact.
 *
 * Returns true iff a nudge was emitted (caller uses this to set exit code 2).
 */
function autonomyContinuationMessage() {
    return "OpenWolf autonomy reminder: if you know the next step with confidence and it needs no user decision, perform it now without asking or waiting. Do not stop merely to summarize or ask whether to continue.\n";
}
function maybeNudgeAutonomyContinuation(wolfDir, session, sessionFile, transcriptPath) {
    const cfg = getAutonomyContinuationConfig();
    if (!cfg.enabled || !cfg.nudge_only || !transcriptPath)
        return false;
    if (cfg.max_fires_per_session > 0 && session.autonomy_continuation_warnings >= cfg.max_fires_per_session)
        return false;
    const last = readLastAssistantText(transcriptPath);
    if (!last?.text || last.text.length < cfg.min_text_chars)
        return false;
    let matched = false;
    for (const src of cfg.patterns) {
        try {
            if (new RegExp(src, "i").test(last.text)) {
                matched = true;
                break;
            }
        }
        catch { }
    }
    if (!matched)
        return false;
    if (!tryConsumeNudgeSlot(sessionFile, "autonomy_continuation_warnings", cfg.max_fires_per_session || STOP_NUDGE_PER_SESSION_CAP))
        return false;
    process.stderr.write(autonomyContinuationMessage());
    return true;
}
const CLAIM_CALIBRATION_SIGNALS = {
    strong_claims: [
        /\bdefinitely\s+(?:proves?|means|shows|confirms|establishes)\b/i,
        /\bcertainly\s+(?:means|shows|proves?|confirms|establishes)\b/i,
        /\bconclusive\s+(?:evidence|proof|result|finding)\b/i,
        /\bimpossible\s+(?:for|to|that)\b/i,
        /\balways\s+(?:works|passes|fails|happens|causes|means)\b/i,
        /\bnever\s+(?:works|passes|fails|happens|causes|means)\b/i,
    ],
    causal_claims: [
        /\broot\s+cause\b/i,
        /\bcaused\s+by\b/i,
        /\bdue\s+to\b/i,
        /\bexplains\s+why\b/i,
        /\bthe\s+reason\s+is\b/i,
        /\bthe\s+culprit\s+is\b/i,
        /\bresponsible\s+for\b/i,
    ],
    generalizations: [
        /\bworks\s+across\b/i,
        /\bin\s+all\s+cases\b/i,
        /\bfor\s+every\b/i,
        /\buniversal(?:ly)?\b/i,
        /\balways\s+\w+\b/i,
        /\bnever\s+\w+\b/i,
    ],
    debugging_conclusions: [
        /\bverified\s+the\s+fix\b/i,
        /\bbug\s+is\s+fixed\b/i,
        /\bissue\s+is\s+resolved\b/i,
        /\bnow\s+works\s+because\b/i,
        /\bcannot\s+reproduce\s+after\b/i,
        /\bready\s+(?:to\s+ship|to\s+merge|for\s+review)\b/i,
    ],
    methodology_claims: [
        /\bevidence\s+shows\b/i,
        /\bdata\s+proves\b/i,
        /\banalysis\s+confirms\b/i,
        /\btest\s+demonstrates\b/i,
        /\bbenchmark\s+proves\b/i,
        /\bresults?\s+demonstrate\b/i,
    ],
    confidence_claims: [
        /\bhigh\s+confidence\b/i,
        /\bno\s+doubt\b/i,
        /\bguaranteed\b/i,
        /\bclearly\s+established\b/i,
        /\bcertain\s+based\s+on\b/i,
    ],
};
const CLAIM_CALIBRATION_MARKERS = {
    observed: [
        /\bobserved\s*:/i,
        /\bi\s+observed\b/i,
        /\bevidence\s*:/i,
        /\bactual\s+output\b/i,
        /\bfrom\s+the\s+(?:logs?|run|output)\b/i,
        /\bthe\s+run\s+showed\b/i,
    ],
    inferred: [
        /\binferred\s*:/i,
        /\bi\s+infer\b/i,
        /\bsuggests\b/i,
        /\blikely\b/i,
        /\bpoints\s+to\b/i,
        /\bhypothesis\b/i,
    ],
    limits: [
        /\blimit\s*:/i,
        /\blimitation\b/i,
        /\bscope\b/i,
        /\bboundar(?:y|ies)\b/i,
        /\bdoes\s+not\s+prove\b/i,
        /\bnot\s+enough\s+to\s+show\b/i,
    ],
    falsifiers: [
        /\bfalsifier\s*:/i,
        /\bwould\s+falsify\b/i,
        /\bwould\s+lower\s+confidence\b/i,
        /\bcounterexample\b/i,
        /\brival\s+explanation\b/i,
        /\bdisprove\b/i,
    ],
};
function detectClaimCalibrationSignals(text, categories) {
    const hits = [];
    for (const [category, patterns] of Object.entries(CLAIM_CALIBRATION_SIGNALS)) {
        if (categories && categories[category] === false)
            continue;
        if (patterns.some((pattern) => pattern.test(text))) {
            hits.push(category);
        }
    }
    return hits;
}
function detectPresentDisciplineMarkers(text, markersConfig) {
    const present = [];
    for (const [marker, patterns] of Object.entries(CLAIM_CALIBRATION_MARKERS)) {
        if (markersConfig && markersConfig[marker] === false)
            continue;
        if (patterns.some((pattern) => pattern.test(text))) {
            present.push(marker);
        }
    }
    return present;
}
function detectMissingDisciplineMarkers(text, markersConfig) {
    const present = new Set(detectPresentDisciplineMarkers(text, markersConfig));
    return Object.keys(CLAIM_CALIBRATION_MARKERS)
        .filter((marker) => markersConfig?.[marker] !== false && !present.has(marker));
}
function claimCalibrationCategoryLabel(category) {
    return category.replace(/_claims$/, "").replace(/_/g, "/");
}
function claimCalibrationNudgeMessage(id, categories) {
    const labels = categories.map(claimCalibrationCategoryLabel).slice(0, 3).join("/");
    return `OpenWolf claim calibration [${id}]: ${labels || "strong"} claim without calibration. Add 4 short lines: Observed: ... Inferred: ... Limit: ... Falsifier: ...\n`;
}
function isCalibrationLikeType(type) {
    return type === "claim_calibration" || type === "scientific_mode";
}

function claimStateSignature(sessionEntry, labels) {
    const written = [...new Set((sessionEntry.writes ?? []).map(w => w.file))]
        .filter(file => typeof file === "string" && isCodeFile(file));
    const entries = written.map(file => [path.resolve(file).replace(/\\/g, "/"), hashFileContent(file) ?? "unreadable"])
        .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0)
        return "";
    return crypto.createHash("sha256").update(JSON.stringify({ labels: [...labels].sort(), entries })).digest("hex");
}
function maybeNudgeClaimCalibration(wolfDir, session, sessionEntry, transcriptPath) {
    const cfg = getClaimCalibrationConfig();
    if (!cfg.enabled || !cfg.nudge_only || !cfg.log_decisions)
        return false;
    if (!transcriptPath)
        return false;
    const last = readLastAssistantText(transcriptPath);
    if (!last || !last.text || last.text.length < cfg.min_text_chars)
        return false;
    const categories = detectClaimCalibrationSignals(last.text, cfg.categories);
    if (categories.length < cfg.min_signal_hits)
        return false;
    const missingMarkers = detectMissingDisciplineMarkers(last.text, cfg.discipline_markers);
    if (cfg.require_missing_markers && missingMarkers.length === 0)
        return false;
    const normalizedText = last.text.replace(/\s+/g, " ").trim();
    const textHash = crypto.createHash("sha256").update(normalizedText).digest("hex");
    const claimSig = claimStateSignature(sessionEntry, categories);
    const qaDir = path.join(wolfDir, "qa");
    try {
        fs.mkdirSync(qaDir, { recursive: true });
    }
    catch { }
    const gateLogPath = path.join(qaDir, "_gate-log.json");
    const release = acquireFileLock(gateLogPath);
    if (!release)
        return false;
    let nextId = "calib-00001";
    let alreadyNudged = false;
    let sessionCapReached = false;
    try {
        const gateLog = readJSON(gateLogPath, { version: 1, entries: [] });
        if (!gateLog.entries)
            gateLog.entries = [];
        if (cfg.max_fires_per_session > 0 && session.session_id) {
            const priorFiresThisSession = gateLog.entries.filter((e) => isCalibrationLikeType(e.type)
                && e.decision === "nudge"
                && e.session_id === session.session_id).length;
            if (priorFiresThisSession >= cfg.max_fires_per_session) {
                sessionCapReached = true;
            }
        }
        alreadyNudged = gateLog.entries.some((e) => (isCalibrationLikeType(e.type) || e.type === "conclusion")
            && (e.decision === "nudge" || e.decision === "covered_by_reduction")
            && (e.text_sha256 === textHash || (claimSig && e.claim_signature === claimSig)));
        if (!sessionCapReached && !alreadyNudged) {
            let maxN = 0;
            for (const e of gateLog.entries) {
                const m = typeof e.id === "string" ? e.id.match(/^(?:calib|science)-(\d+)$/) : null;
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (n > maxN)
                        maxN = n;
                }
            }
            nextId = `calib-${String(maxN + 1).padStart(5, "0")}`;
            gateLog.entries.push({
                id: nextId,
                session_id: session.session_id,
                ended: sessionEntry.ended,
                type: "claim_calibration",
                categories,
                missing_markers: missingMarkers,
                text_excerpt: normalizedText.slice(0, 240),
                text_sha256: textHash,
                claim_signature: claimSig,
                decision: "nudge",
                mode: "soft",
                trigger: "stop",
            });
            writeJSON(gateLogPath, gateLog);
        }
    }
    finally {
        release();
    }
    if (alreadyNudged || sessionCapReached)
        return false;
    try {
        rollingWindowJson({
            file: gateLogPath,
            arrayKey: "entries",
            getDate: (e) => e.ended,
            getId: (e) => e.id,
            retentionDays: cfg.retention_days,
            archiveDir: path.join(wolfDir, "archive"),
        });
    }
    catch { }
    process.stderr.write(claimCalibrationNudgeMessage(nextId, categories));
    return true;
}

function maybeNudgeConclusionVerification(wolfDir, session, sessionEntry, transcriptPath) {
    const cfg = getQualityGateConfig();
    if (!cfg.enabled)
        return false;
    const vc = cfg.verify_conclusions;
    if (!vc || !vc.enabled)
        return false;
    if (!transcriptPath)
        return false;
    const last = readLastAssistantText(transcriptPath);
    if (!last || !last.text || last.text.length < vc.min_text_chars)
        return false;
    // Match patterns. Each pattern counts once whether it fires once or many
    // times — we measure breadth of conclusion-signaling, not volume.
    const matched = [];
    for (const src of vc.patterns) {
        try {
            const re = new RegExp(src, "i");
            if (re.test(last.text))
                matched.push(src);
        }
        catch {
            // Bad pattern in config — skip rather than blow up the hook.
        }
    }
    if (matched.length < vc.min_pattern_hits)
        return false;
    // Suppress the nudge if this session already produced a fresh reduction
    // (any qa/*.md not starting with _ written this session). That covers the
    // common case where the assistant *did* write the reduction the gate is
    // asking about — no point nagging again.
    const qaDir = path.join(wolfDir, "qa");
    const sessionWroteReduction = sessionEntry.writes.some(w => {
        const f = w.file.replace(/\\/g, "/");
        if (!f.includes("/.wolf/qa/"))
            return false;
        const base = f.split("/").pop() || "";
        return base.endsWith(".md") && !base.startsWith("_");
    });
    // Same-text idempotence. Hash the assistant text (post-whitespace-normalize
    // so trivial reformatting still collapses to the same hash) and skip the
    // nudge if any prior conclusion entry in the gate-log already recorded the
    // same hash. Without this, an unchanged assistant turn re-fires exit 2 on
    // every Stop invocation and the autonomy loop never converges.
    const normalizedText = last.text.replace(/\s+/g, " ").trim();
    const textHash = crypto.createHash("sha256").update(normalizedText).digest("hex");
    const claimSig = claimStateSignature(sessionEntry, matched);
    // Log the conclusion-detector decision
    const gateLogPath = path.join(qaDir, "_gate-log.json");
    try {
        fs.mkdirSync(qaDir, { recursive: true });
    }
    catch { }
    const release = acquireFileLock(gateLogPath);
    if (!release)
        return false;
    let nextId = "gate-00001";
    let alreadyNudged = false;
    let sessionCapReached = false;
    try {
        const gateLog = readJSON(gateLogPath, { version: 1, entries: [] });
        if (!gateLog.entries)
            gateLog.entries = [];
        // Per-session firing cap. text_sha256 idempotence prevents *exact*
        // duplicate nudges, but a long session that produces many *distinct*
        // claims would otherwise burn user attention. After max_fires_per_session
        // conclusion nudges for this session_id, stop firing — the user has
        // already seen the pattern; further nudges add noise, not signal.
        // Disabled with max_fires_per_session === 0.
        if (vc.max_fires_per_session > 0 && session.session_id) {
            const priorFiresThisSession = gateLog.entries.filter((e) => e.type === "conclusion"
                && e.decision === "nudge"
                && e.session_id === session.session_id).length;
            if (priorFiresThisSession >= vc.max_fires_per_session) {
                sessionCapReached = true;
            }
        }
        // Idempotence check BEFORE assigning a new ID — if we've nudged on this
        // exact text before, return without appending a new entry.
        alreadyNudged = gateLog.entries.some((e) => (e.type === "conclusion" || isCalibrationLikeType(e.type))
            && (e.decision === "nudge" || e.decision === "covered_by_reduction")
            && (e.text_sha256 === textHash || (claimSig && e.claim_signature === claimSig)));
        if (sessionCapReached) {
            // No-op: cap reached. Don't pollute the log, don't emit a nudge.
        }
        else if (alreadyNudged) {
            // No-op: don't pollute the log with duplicate entries, don't emit a
            // duplicate nudge. The original entry already recorded our decision.
        }
        else if (sessionWroteReduction) {
            let maxCoveredN = 0;
            for (const e of gateLog.entries) {
                const m = typeof e.id === "string" ? e.id.match(/^gate-covered-(\d+)$/) : null;
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (n > maxCoveredN)
                        maxCoveredN = n;
                }
            }
            gateLog.entries.push({
                id: `gate-covered-${String(maxCoveredN + 1).padStart(5, "0")}`,
                session_id: session.session_id,
                ended: sessionEntry.ended,
                type: "conclusion",
                patterns_matched: matched,
                text_excerpt: normalizedText.slice(0, 240),
                text_sha256: textHash,
                claim_signature: claimSig,
                decision: "covered_by_reduction",
                mode: vc.nudge_only ? "soft" : "hard",
                trigger: "stop",
            });
            writeJSON(gateLogPath, gateLog);
            alreadyNudged = true;
        }
        else {
            let maxN = 0;
            for (const e of gateLog.entries) {
                const m = e.id.match(/^gate-(\d+)$/);
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (n > maxN)
                        maxN = n;
                }
            }
            nextId = `gate-${String(maxN + 1).padStart(5, "0")}`;
            const excerpt = normalizedText.slice(0, 240);
            gateLog.entries.push({
                id: nextId,
                session_id: session.session_id,
                ended: sessionEntry.ended,
                type: "conclusion",
                patterns_matched: matched,
                text_excerpt: excerpt,
                text_sha256: textHash,
                claim_signature: claimSig,
                decision: "nudge",
                mode: vc.nudge_only ? "soft" : "hard",
                trigger: "stop",
            });
            writeJSON(gateLogPath, gateLog);
        }
    }
    finally {
        release();
    }
    if (alreadyNudged || sessionCapReached)
        return false;
    if (!vc.nudge_only)
        return true; // hard-mode would block; not shipped yet
    process.stderr.write(`🧪 OpenWolf conclusion gate [${nextId}]: the assistant's last turn matched ` +
        `${matched.length} conclusion patterns. Before treating the conclusion as final, ` +
        `write an adversarial reduction in .wolf/qa/ that (a) names ≥${cfg.min_assumptions} ` +
        `concrete assumptions the conclusion depends on, (b) picks the riskiest, (c) runs ` +
        `a test designed to falsify it, (d) pastes the actual output. Every conclusion gets ` +
        `tested twice — the original work and the falsification pass.\n`);
    return true;
}
main().catch(() => exitAfterStderrFlush(0));
