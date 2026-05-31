import * as fs from "node:fs";
import * as path from "node:path";
import {
  getWolfDir, ensureWolfDir, readJSON, writeJSON, appendMarkdown, timeShort,
  getSizeDisciplineConfig, getReviewHookConfig
} from "./shared.js";
import { cappedSessionsJson, monthlyRotateMarkdown, rollingWindowJson, acquireFileLock } from "../utils/size-discipline.js";

interface FileRead {
  count: number;
  tokens: number;
  first_read: string;
}

interface FileWrite {
  file: string;
  action: string;
  tokens: number;
  at: string;
}

interface SessionData {
  session_id: string;
  started: string;
  files_read: Record<string, FileRead>;
  files_written: FileWrite[];
  edit_counts: Record<string, number>;
  anatomy_hits: number;
  anatomy_misses: number;
  repeated_reads_warned: number;
  cerebrum_warnings: number;
  stop_count: number;
}

interface SessionEntry {
  id: string;
  started: string;
  ended: string;
  reads: Array<{
    file: string;
    tokens_estimated: number;
    was_repeated: boolean;
    anatomy_had_description: boolean;
  }>;
  writes: Array<{ file: string; tokens_estimated: number; action: string }>;
  totals: {
    input_tokens_estimated: number;
    output_tokens_estimated: number;
    reads_count: number;
    writes_count: number;
    repeated_reads_blocked: number;
    anatomy_lookups: number;
  };
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();
  const hooksDir = path.join(wolfDir, "hooks");
  const sessionFile = path.join(hooksDir, "_session.json");

  // Acquire a lock for the _session.json read-modify-write so concurrent
  // stop hooks cannot lose stop_count increments. We hold the lock only
  // for the increment+persist; the rest of main() reads the local copy.
  // If lock acquisition fails, fall back to a non-persisting read — the
  // increment is dropped (intentional) rather than risking lost increments
  // from a racing unlocked write.
  const sessionLock = acquireFileLock(sessionFile);
  const defaultSession: SessionData = {
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
  let session: SessionData;
  if (sessionLock) {
    try {
      session = readJSON<SessionData>(sessionFile, defaultSession);
      // Defensive: existing _session.json may pre-date the stop_count field
      // or have it as a non-number; `undefined++` yields NaN which serializes
      // as `null` and corrupts the file.
      const prevCount = typeof session.stop_count === "number" ? session.stop_count : 0;
      session.stop_count = prevCount + 1;
      // Persist the incremented count immediately so a concurrent stop sees it.
      writeJSON(sessionFile, session);
    } finally {
      sessionLock();
    }
  } else {
    // No lock — read but don't write. Local stop_count increment is lost.
    session = readJSON<SessionData>(sessionFile, defaultSession);
  }

  // Normalize against full SessionData schema. _session.json can be partially
  // initialized by post-write.ts (which only sets files_written + edit_counts)
  // before any session-start hook fires, so any of these fields may be missing
  // or wrong-typed. Defaults preserve everything ledger/review code downstream
  // expects, without overwriting present data.
  if (!session.files_read || typeof session.files_read !== "object" || Array.isArray(session.files_read)) {
    session.files_read = {};
  }
  if (!Array.isArray(session.files_written)) session.files_written = [];
  if (!session.edit_counts || typeof session.edit_counts !== "object" || Array.isArray(session.edit_counts)) {
    session.edit_counts = {};
  }
  if (typeof session.anatomy_hits !== "number") session.anatomy_hits = 0;
  if (typeof session.anatomy_misses !== "number") session.anatomy_misses = 0;
  if (typeof session.repeated_reads_warned !== "number") session.repeated_reads_warned = 0;
  if (typeof session.cerebrum_warnings !== "number") session.cerebrum_warnings = 0;
  if (typeof session.session_id !== "string") session.session_id = "";
  if (typeof session.started !== "string") session.started = "";

  // Only write to ledger if there's been activity
  const readCount = Object.keys(session.files_read).length;
  const writeCount = session.files_written.length;

  if (readCount === 0 && writeCount === 0) {
    process.exit(0);
    return;
  }

  // Check for files edited many times without a buglog entry
  checkForMissingBugLogs(wolfDir, session);

  // Check if cerebrum was updated this session (it should be if there were edits)
  checkCerebrumFreshness(wolfDir, session);

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

  const sessionEntry: SessionEntry = {
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
        sessions: [] as SessionEntry[],
        daemon_usage: [],
        waste_flags: [],
        optimization_report: { last_generated: null, patterns: [] },
      }) as {
        version: number;
        lifetime: Record<string, number>;
        sessions: SessionEntry[];
        [key: string]: unknown;
      };

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
    } finally {
      releaseLedger();
    }
  }

  // Cap token-ledger sessions array — silent no-op on error.
  // cappedSessionsJson acquires its own lock internally.
  try {
    const cfg = getSizeDisciplineConfig();
    if (cfg.enabled) {
      cappedSessionsJson<SessionEntry>({
        file: ledgerPath,
        arrayKey: "sessions",
        maxInline: cfg.token_ledger.max_inline_sessions,
        getId: (e) => e.id,
      });
    }
  } catch {}

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
        } finally {
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
              if (!m) return undefined;
              return m[2] ? `${m[1]}T${m[2]}:00Z` : `${m[1]}T00:00:00Z`;
            },
          });
        }
      } catch {}
    } catch {}
  }

  // Review-hook nudge: log session to reviewlog.json and prompt for Codex
  // review when thresholds are crossed. Silent no-op on error — never blocks.
  try {
    maybeNudgeReview(wolfDir, session, sessionEntry);
  } catch {}

  // Note: _session.json was already persisted at the top under a lock to
  // protect the stop_count increment. The local `session` object is otherwise
  // read-only from this hook's perspective; post-read/post-write hooks are
  // the writers for the other fields.

  process.exit(0);
}

interface ReviewLogEntry {
  id: string;
  session_id: string;
  ended: string;
  files: string[];
  approx_lines_changed: number;
  reason: string;
  status: "pending" | "completed" | "skipped";
  trigger: "size" | "path" | "size+path";
  matched_paths?: string[];
}

interface ReviewLog {
  version: number;
  reviews: ReviewLogEntry[];
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
function globToRegex(glob: string): RegExp {
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
      } else {
        // Trailing or mid-path "**": match anything (including slashes)
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
      i++;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

function maybeNudgeReview(wolfDir: string, session: SessionData, sessionEntry: SessionEntry): void {
  const reviewCfg = getReviewHookConfig();
  if (!reviewCfg.enabled) return;
  if (sessionEntry.writes.length === 0) return;

  // Approximate lines-changed from output-token estimate: code averages
  // ~3.5 chars/token, ~60 chars/line → ~17 tokens/line.
  const approxLines = Math.round(sessionEntry.totals.output_tokens_estimated / 17);
  const writtenFiles = [...new Set(sessionEntry.writes.map(w => w.file))];

  const pathRegexes = reviewCfg.always_review_paths.map(globToRegex);
  const matchedPaths = writtenFiles.filter(f => pathRegexes.some(re => re.test(f)));
  const sizeTrigger = approxLines >= reviewCfg.min_diff_lines;
  const pathTrigger = matchedPaths.length > 0;

  if (!sizeTrigger && !pathTrigger) return;

  const trigger: ReviewLogEntry["trigger"] =
    sizeTrigger && pathTrigger ? "size+path" : sizeTrigger ? "size" : "path";

  const reasonParts: string[] = [];
  if (sizeTrigger) reasonParts.push(`~${approxLines} lines changed (threshold ${reviewCfg.min_diff_lines})`);
  if (pathTrigger) reasonParts.push(`sensitive path(s): ${matchedPaths.slice(0, 3).join(", ")}`);
  const reason = reasonParts.join("; ");

  // Append to reviewlog.json under a file lock so concurrent stop hooks
  // (possible if Claude Code dispatches them in parallel) cannot lose updates.
  // Coalesce with any existing pending entry for the same session_id.
  const reviewLogPath = path.join(wolfDir, "reviewlog.json");
  const releaseReviewLock = acquireFileLock(reviewLogPath);
  if (!releaseReviewLock) {
    // Couldn't acquire lock — skip the nudge entirely. Emitting a nudge
    // without a matching reviewlog entry would confuse the user.
    return;
  }
  let nextId = "";
  try {
    // Re-read AFTER lock acquisition to capture concurrent appends.
    const reviewLog = readJSON<ReviewLog>(reviewLogPath, { version: 1, reviews: [] });
    if (!reviewLog.reviews) reviewLog.reviews = [];

    const existingPending = session.session_id
      ? reviewLog.reviews.find(r => r.session_id === session.session_id && r.status === "pending")
      : undefined;

    if (existingPending) {
      // Coalesce: refresh end timestamp, union files, take max line count.
      existingPending.ended = sessionEntry.ended;
      existingPending.approx_lines_changed = Math.max(existingPending.approx_lines_changed, approxLines);
      existingPending.files = [...new Set([...existingPending.files, ...writtenFiles])];
      existingPending.reason = reason;
      existingPending.trigger = trigger;
      if (pathTrigger) {
        existingPending.matched_paths = [...new Set([...(existingPending.matched_paths ?? []), ...matchedPaths])];
      }
      nextId = existingPending.id;
    } else {
      // ID generation: max existing N + 1, NOT array length. Length-based
      // IDs collide if entries are deleted or if a concurrent process
      // appended before us.
      let maxN = 0;
      for (const r of reviewLog.reviews) {
        const m = r.id.match(/^review-(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxN) maxN = n;
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
        ...(pathTrigger ? { matched_paths: matchedPaths } : {}),
      });
    }
    writeJSON(reviewLogPath, reviewLog);
  } finally {
    releaseReviewLock();
  }

  // Apply rolling-window retention on reviewlog — runs AFTER our lock is
  // released; rollingWindowJson re-reads under its own lock so this is safe.
  try {
    const sizeCfg = getSizeDisciplineConfig();
    if (sizeCfg.enabled) {
      rollingWindowJson<ReviewLogEntry>({
        file: reviewLogPath,
        arrayKey: "reviews",
        getDate: (e) => e.ended,
        getId: (e) => e.id,
        retentionDays: sizeCfg.reviewlog.retention_days,
      });
    }
  } catch {}

  // Emit advisory nudge (stderr → next-turn context, never blocks)
  if (reviewCfg.nudge_only) {
    const fileList = writtenFiles.slice(0, 3).join(", ");
    const more = writtenFiles.length > 3 ? ` +${writtenFiles.length - 3} more` : "";
    const cmd = reviewCfg.codex_command;
    process.stderr.write(
      `🔍 OpenWolf review nudge [${nextId}]: ${reason}. ` +
      `Files: ${fileList}${more}. ` +
      `Consider an independent Codex review BEFORE you stop: ` +
      `mkdir /tmp/codex-${nextId} && cp <files> /tmp/codex-${nextId}/ && cd /tmp/codex-${nextId} && ` +
      `${cmd} -o /tmp/codex_${nextId}.txt "Are there critical flaws or things I overlooked in ./<file> that are important to the code intent?" ` +
      `— iterate until Codex gives a production-ready OK, then mark .wolf/reviewlog.json entry as completed.\n`
    );
  }
}

/**
 * Check if files were edited multiple times but buglog.json wasn't updated.
 * Emit a stderr reminder so Claude sees it in the next turn.
 */
function checkForMissingBugLogs(wolfDir: string, session: SessionData): void {
  if (!session.edit_counts) return;

  const multiEditFiles = Object.entries(session.edit_counts)
    .filter(([, count]) => count >= 3)
    .map(([file]) => path.basename(file));

  if (multiEditFiles.length === 0) return;

  // Check if buglog was written to this session
  const buglogWritten = session.files_written.some(w =>
    w.file.includes("buglog.json")
  );

  if (!buglogWritten) {
    process.stderr.write(
      `⚠️ OpenWolf: Files edited 3+ times this session (${multiEditFiles.join(", ")}) but buglog.json was not updated. If you fixed bugs, please log them.\n`
    );
  }
}

/**
 * Check if cerebrum.md was updated recently. If it hasn't been updated in
 * a while and there was significant activity, emit a gentle reminder.
 */
function checkCerebrumFreshness(wolfDir: string, session: SessionData): void {
  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  try {
    const stat = fs.statSync(cerebrumPath);
    const hoursSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

    // If cerebrum hasn't been updated in 24h+ and there were significant writes
    if (hoursSinceUpdate > 24 && session.files_written.length >= 3) {
      process.stderr.write(
        `💡 OpenWolf: cerebrum.md hasn't been updated in ${Math.floor(hoursSinceUpdate)}h. Did you learn any user preferences, conventions, or gotchas this session? Consider updating .wolf/cerebrum.md.\n`
      );
    }
  } catch {
    // cerebrum.md doesn't exist, that's ok
  }
}

main().catch(() => process.exit(0));
