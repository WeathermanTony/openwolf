// @ts-nocheck
/**
 * size-discipline.ts
 *
 * Bounds the size of .wolf/ corpus files so they don't grow unbounded
 * and bleed Claude's context window when re-read each turn.
 *
 * Four primitives, each idempotent — they only do work when the file
 * actually exceeds its bound. Safe to call on every write.
 *
 * Archives are written to .wolf/archive/{basename}-YYYY-MM.{ext} so
 * multiple files trimmed in the same month merge into one archive
 * rather than scattering monthly files everywhere.
 *
 * CONCURRENCY CONTRACT:
 *   The trim primitives hold `<file>.lock` (via acquireFileLock) around
 *   their entire read-modify-write of the live file. This serializes
 *   trims with each other AND with any other writer that uses
 *   acquireFileLock on the same path. Writers that bypass the lock
 *   (e.g. plain fs.writeFileSync) are NOT serialized — their writes
 *   can be silently overwritten by a concurrent trim. Consumers in
 *   this codebase (hook scripts) must wrap their writes in
 *   acquireFileLock to participate in the lock discipline.
 *
 * All operations swallow errors and continue — size discipline must
 * never block a hook from finishing. Caller-supplied callbacks
 * (getDate, getId, getSectionDate) are wrapped in safeCall, so
 * exceptions from those callbacks are absorbed too.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
/**
 * Apply a rolling-window retention policy to a JSON file containing
 * an array of dated entries. Entries older than `retentionDays` are
 * archived; the live file keeps only the recent window.
 *
 * Suitable for buglog.json and reviewlog.json.
 *
 * Idempotent — safe to call after every append; a no-op when nothing
 * is out of window.
 */
export function rollingWindowJson(opts) {
    const result = { trimmed: 0, archived: 0, archivePath: null };
    if (opts.retentionDays === null || opts.retentionDays <= 0)
        return result;
    if (!fs.existsSync(opts.file))
        return result;
    const nowMs = opts.now ?? Date.now();
    const cutoffMs = nowMs - opts.retentionDays * 24 * 60 * 60 * 1000;
    // CRITICAL: hold a lock on the live file across the entire
    // read-modify-write so concurrent appends from other hooks cannot
    // be silently overwritten. The lock is released in finally.
    const releaseLive = acquireFileLock(opts.file);
    if (!releaseLive)
        return result;
    try {
        // Re-read AFTER lock acquisition — captures anything a concurrent
        // hook wrote while we were waiting for the lock.
        let doc;
        try {
            const parsed = JSON.parse(fs.readFileSync(opts.file, "utf-8"));
            // Guard against parses-but-not-an-object: null, arrays, primitives.
            // doc[arrayKey] would throw on null and is misleading on arrays/primitives.
            if (!isPlainObject(parsed))
                return result;
            doc = parsed;
        }
        catch {
            return result; // Malformed file — leave it alone.
        }
        const arr = doc[opts.arrayKey];
        if (!Array.isArray(arr) || arr.length === 0)
            return result;
        const keep = [];
        const archive = [];
        for (const entry of arr) {
            // Caller callbacks must never crash the hook.
            const dateStr = safeCall(() => opts.getDate(entry), undefined);
            const t = dateStr ? Date.parse(dateStr) : NaN;
            // Undated or unparseable entries are kept — we don't archive what we can't date.
            if (!Number.isFinite(t) || t >= cutoffMs) {
                keep.push(entry);
            }
            else {
                archive.push(entry);
            }
        }
        if (archive.length === 0)
            return result;
        const wolfDir = path.dirname(opts.file);
        const archiveDir = opts.archiveDir ?? path.join(wolfDir, "archive");
        const basename = path.basename(opts.file, path.extname(opts.file));
        const ext = path.extname(opts.file);
        const monthSlug = monthSlugUtc(nowMs);
        const archivePath = path.join(archiveDir, `${basename}-${monthSlug}${ext}`);
        ensureDir(archiveDir);
        // CRITICAL: archive must commit before we trim the live file.
        // If the archive write fails, leave the live file untouched.
        const archiveOk = mergeIntoArchive(archivePath, opts.arrayKey, archive, doc, opts.getId);
        if (!archiveOk)
            return result;
        doc[opts.arrayKey] = keep;
        if (!atomicWriteJson(opts.file, doc)) {
            // Live trim failed after archive succeeded. With getId, the
            // next call will dedup the replayed entries. Without getId,
            // duplicates accumulate in the archive — acceptable trade-off
            // vs. losing data from the live file.
            return result;
        }
        result.trimmed = archive.length;
        result.archived = archive.length;
        result.archivePath = archivePath;
        return result;
    }
    finally {
        releaseLive();
    }
}
/**
 * Cap the inline length of a JSON sessions array. Overflow is moved to
 * a monthly archive. Order preserved: newest stays inline.
 *
 * Suitable for token-ledger.json (sessions array grows one per session).
 *
 * Idempotent — safe to call after every append.
 */
export function cappedSessionsJson(opts) {
    const result = { trimmed: 0, archived: 0, archivePath: null };
    if (opts.maxInline <= 0)
        return result;
    if (!fs.existsSync(opts.file))
        return result;
    const releaseLive = acquireFileLock(opts.file);
    if (!releaseLive)
        return result;
    try {
        let doc;
        try {
            const parsed = JSON.parse(fs.readFileSync(opts.file, "utf-8"));
            if (!isPlainObject(parsed))
                return result;
            doc = parsed;
        }
        catch {
            return result;
        }
        const arr = doc[opts.arrayKey];
        if (!Array.isArray(arr) || arr.length <= opts.maxInline)
            return result;
        const overflow = arr.length - opts.maxInline;
        const archive = arr.slice(0, overflow);
        const keep = arr.slice(overflow);
        const wolfDir = path.dirname(opts.file);
        const archiveDir = opts.archiveDir ?? path.join(wolfDir, "archive");
        const basename = path.basename(opts.file, path.extname(opts.file));
        const ext = path.extname(opts.file);
        const monthSlug = monthSlugUtc(opts.now ?? Date.now());
        const archivePath = path.join(archiveDir, `${basename}-${monthSlug}${ext}`);
        ensureDir(archiveDir);
        const archiveOk = mergeIntoArchive(archivePath, opts.arrayKey, archive, doc, opts.getId);
        if (!archiveOk)
            return result;
        doc[opts.arrayKey] = keep;
        if (!atomicWriteJson(opts.file, doc))
            return result;
        result.trimmed = archive.length;
        result.archived = archive.length;
        result.archivePath = archivePath;
        return result;
    }
    finally {
        releaseLive();
    }
}
/**
 * Trim a markdown audit-trail file by section. Sections older than
 * retentionDays are moved to a monthly archive. The file's preamble
 * (everything before the first section header) is preserved inline.
 *
 * Suitable for memory.md.
 */
export function monthlyRotateMarkdown(opts) {
    const result = { trimmed: 0, archived: 0, archivePath: null };
    if (opts.retentionDays === null || opts.retentionDays <= 0)
        return result;
    if (!opts.sectionHeaderPattern || !opts.getSectionDate)
        return result;
    if (!fs.existsSync(opts.file))
        return result;
    const releaseLive = acquireFileLock(opts.file);
    if (!releaseLive)
        return result;
    try {
        let content;
        try {
            content = fs.readFileSync(opts.file, "utf-8");
        }
        catch {
            return result;
        }
        // CRITICAL: rebuild regex without g/y flags. RegExp.test() mutates
        // lastIndex on those flags, so reusing across test() calls silently
        // skips matches.
        const headerRe = withoutStatefulFlags(opts.sectionHeaderPattern);
        const lines = content.split("\n");
        const sectionStarts = [];
        for (let i = 0; i < lines.length; i++) {
            if (headerRe.test(lines[i]))
                sectionStarts.push(i);
        }
        if (sectionStarts.length === 0)
            return result;
        const preamble = lines.slice(0, sectionStarts[0]).join("\n");
        const nowMs = opts.now ?? Date.now();
        const cutoffMs = nowMs - opts.retentionDays * 24 * 60 * 60 * 1000;
        const sections = [];
        const getSectionDate = opts.getSectionDate;
        for (let i = 0; i < sectionStarts.length; i++) {
            const start = sectionStarts[i];
            const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1] : lines.length;
            const secLines = lines.slice(start, end);
            // Caller callback must never crash the hook.
            const dateStr = safeCall(() => getSectionDate(secLines[0]), undefined);
            const t = dateStr ? Date.parse(dateStr) : NaN;
            sections.push({ lines: secLines, dateMs: Number.isFinite(t) ? t : null });
        }
        const keepSections = [];
        const archiveSections = [];
        for (const sec of sections) {
            if (sec.dateMs === null || sec.dateMs >= cutoffMs)
                keepSections.push(sec);
            else
                archiveSections.push(sec);
        }
        if (archiveSections.length === 0)
            return result;
        const wolfDir = path.dirname(opts.file);
        const archiveDir = opts.archiveDir ?? path.join(wolfDir, "archive");
        const basename = path.basename(opts.file, path.extname(opts.file));
        const ext = path.extname(opts.file);
        const monthSlug = monthSlugUtc(nowMs);
        const archivePath = path.join(archiveDir, `${basename}-${monthSlug}${ext}`);
        ensureDir(archiveDir);
        // Atomic + dedup merge into the markdown archive (matches the JSON
        // archive discipline). Dedup key = first-line section header (the
        // header line including its date is stable per section).
        const archiveOk = mergeIntoMarkdownArchive(archivePath, archiveSections.map((s) => s.lines), headerRe);
        if (!archiveOk)
            return result;
        const liveText = preamble + (keepSections.length > 0
            ? "\n" + keepSections.map((s) => s.lines.join("\n")).join("\n")
            : "\n");
        if (!atomicWriteText(opts.file, liveText))
            return result;
        result.trimmed = archiveSections.length;
        result.archived = archiveSections.length;
        result.archivePath = archivePath;
        return result;
    }
    finally {
        releaseLive();
    }
}
/**
 * Standard log-rotation primitive. When file exceeds maxBytes,
 * shift .keep -> .keep+1 (delete oldest), .keep-1 -> .keep, ...
 * .1 -> .2, and current file becomes .1. New empty file created.
 *
 * Suitable for daemon.log (not read by Claude — pure disk hygiene).
 */
export function rotateLogFile(opts) {
    const result = { rotated: false, removed: [] };
    if (opts.maxBytes <= 0)
        return result;
    if (!fs.existsSync(opts.file))
        return result;
    // Lock the log file so two concurrent rotators don't race
    // (e.g. a hook and the daemon both noticing the threshold).
    const release = acquireFileLock(opts.file);
    if (!release)
        return result;
    try {
        let stat;
        try {
            stat = fs.statSync(opts.file);
        }
        catch {
            return result;
        }
        if (stat.size < opts.maxBytes)
            return result;
        // Delete rotations beyond keep
        for (let n = opts.keep + 1; n <= opts.keep + 10; n++) {
            const old = `${opts.file}.${n}`;
            if (fs.existsSync(old)) {
                try {
                    fs.unlinkSync(old);
                    result.removed.push(old);
                }
                catch { }
            }
            else {
                break;
            }
        }
        // Shift existing rotations down. ABORT on first rename failure
        // (rather than continue and silently overwrite a kept rotation).
        // Order matters: keep → keep+1 first, then keep-1 → keep, ...
        // If we abort partway, the higher-numbered rotations may have
        // a duplicate of the next-lower file, but no rotation is LOST:
        // we never run a rename whose target wasn't first shifted away.
        for (let n = opts.keep; n >= 1; n--) {
            const src = `${opts.file}.${n}`;
            const dst = `${opts.file}.${n + 1}`;
            if (!fs.existsSync(src))
                continue;
            try {
                fs.renameSync(src, dst);
            }
            catch {
                // A rename failed mid-chain. Stop the rotation entirely —
                // the .log → .1 step would clobber .1 if we proceeded.
                return result;
            }
        }
        // Drop the keep+1 we just created (we keep `keep` rotations, not keep+1)
        const overflow = `${opts.file}.${opts.keep + 1}`;
        if (fs.existsSync(overflow)) {
            try {
                fs.unlinkSync(overflow);
                result.removed.push(overflow);
            }
            catch { }
        }
        // Move current -> .1. Only safe to do this if either .1 didn't
        // exist or the shift above succeeded in moving it to .2.
        try {
            fs.renameSync(opts.file, `${opts.file}.1`);
        }
        catch {
            return result;
        }
        // Create fresh empty log
        try {
            fs.writeFileSync(opts.file, "", "utf-8");
        }
        catch { }
        result.rotated = true;
        return result;
    }
    finally {
        release();
    }
}
// ─── Internal helpers ──────────────────────────────────────────────
function ensureDir(dir) {
    try {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
    }
    catch { }
}
/**
 * Atomic write via tmp+rename. Returns true on success, false on any
 * failure. On failure the original file is left UNTOUCHED — we never
 * fall back to a non-atomic overwrite because that can leave the file
 * partially written on a flaky FS (WSL2 9P, disk-full, perms races).
 *
 * Callers that need to update multiple files atomically (e.g. write
 * archive then trim live) MUST check the return value before mutating
 * the second file.
 */
export function atomicWriteJson(filePath, data) {
    return atomicWriteText(filePath, JSON.stringify(data, null, 2) + "\n");
}
export function atomicWriteText(filePath, content) {
    return atomicWriteBytes(filePath, Buffer.from(content, "utf8"));
}
/** Atomically persist bytes without text decoding or newline transformation. */
export function atomicWriteBytes(filePath, content) {
    const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    let fd = null;
    try {
        fd = fs.openSync(tmp, "wx", 0o600);
        fs.writeFileSync(fd, content);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(tmp, filePath);
        try {
            const dirFd = fs.openSync(path.dirname(filePath), "r");
            try { fs.fsyncSync(dirFd); }
            finally { fs.closeSync(dirFd); }
        }
        catch { }
        return true;
    }
    catch {
        if (fd !== null) {
            try { fs.closeSync(fd); }
            catch { }
        }
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        return false;
    }
}
/**
 * Strip g/y flags from a user-supplied regex. RegExp.test() mutates
 * lastIndex when those flags are set, so reusing the regex across many
 * test() calls (as we do when scanning lines for section headers)
 * silently skips matches. We accept the regex as-is from the caller's
 * API contract, then quietly rebuild without the stateful flags.
 */
function withoutStatefulFlags(re) {
    if (!re.global && !re.sticky)
        return re;
    const cleaned = re.flags.replace(/[gy]/g, "");
    return new RegExp(re.source, cleaned);
}
/**
 * Acquire an advisory lock on any file by creating <path>.lock with
 * O_EXCL. Returns a release function on success, or null after
 * exhausting retries.
 *
 * IDENTITY: each lock is tagged with a unique nonce written to the
 * lock file. release() only unlinks if the nonce still matches —
 * prevents the cross-release race after a reclaim.
 *
 * STALE RECLAIM: a lock is reclaimed only when BOTH conditions hold:
 *   (a) the recorded pid is no longer running (process.kill(pid, 0)
 *       returns ESRCH), OR the absolute fail-safe age is exceeded
 *       (24h — protects against pid-recycled-by-OS edge case);
 *   (b) the mtime suggests the lock isn't actively being held.
 *
 * The pid-liveness check eliminates the "stalled-but-alive holder"
 * scenario that mtime-only reclaim allowed. A long-running but live
 * holder will not be reclaimed; only a crashed/exited holder will.
 *
 * Used in two places:
 *   - around the live file's read-modify-write
 *   - around archive read-modify-write
 *
 * EXPORTED so other hooks/writers can opt into the same lock
 * discipline, ensuring the trim's lock actually protects against
 * concurrent appends.
 */
export function acquireFileLock(targetPath, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 2000;
    const staleMs = opts.staleMs ?? 30_000;
    const absoluteStaleMs = opts.absoluteStaleMs ?? 24 * 60 * 60 * 1000;
    const lockPath = targetPath + ".lock";
    const deadline = Date.now() + timeoutMs;
    // The nonce stored in the lock file uses `pid:randomHex` for readability when
    // debugging. The staging filename uses a separator that's legal on every
    // supported platform (Windows rejects `:` in filenames), so we derive a
    // filename-safe variant via `pid-randomHex`. Both are equally unique.
    const nonceRandom = crypto.randomBytes(16).toString("hex");
    const nonce = `${process.pid}:${nonceRandom}`;
    const nonceFsSafe = `${process.pid}-${nonceRandom}`;
    // We use the "link trick" for atomic acquire that survives the
    // stale-reclaim race:
    //   1. Write our nonce to a private staging file <lock>.<nonceFsSafe>.tmp
    //   2. fs.linkSync(stagingPath, lockPath) — atomic; fails if lock exists.
    //   3. After link succeeds, re-read lockPath. If content matches our
    //      nonce, we have it. (Should always match after a successful
    //      link since link is atomic, but the read is cheap defense.)
    // The stale-reclaim TOCTOU is avoided because reclaim is now a SINGLE
    // step (unlink-then-link), and the link step itself enforces mutual
    // exclusion: two concurrent unlink+link sequences can BOTH try to
    // link, but only one link can succeed.
    const stagingPath = lockPath + "." + nonceFsSafe + ".tmp";
    let stagingCreated = false;
    try {
        fs.writeFileSync(stagingPath, nonce);
        stagingCreated = true;
    }
    catch {
        return null;
    }
    try {
        while (true) {
            try {
                fs.linkSync(stagingPath, lockPath);
                // Atomic check: even if link succeeded, verify lock content
                // matches our nonce. If a process raced us between link and
                // verify (impossible with proper link semantics, but defense
                // in depth), we'll detect it.
                let observed;
                try {
                    observed = fs.readFileSync(lockPath, "utf-8");
                }
                catch {
                    // Lock vanished after successful link — extremely unlikely.
                    // Treat as failure to be safe.
                    return null;
                }
                if (observed !== nonce)
                    return null;
                // Success. Return release closure.
                return () => {
                    try {
                        const current = fs.readFileSync(lockPath, "utf-8");
                        if (current === nonce)
                            fs.unlinkSync(lockPath);
                    }
                    catch { }
                };
            }
            catch (err) {
                const code = err?.code;
                if (code !== "EEXIST")
                    return null;
                // CRITICAL: serialize reclaim itself through a dedicated
                // reclaim-lock. Without serialization, multiple contenders
                // observing the same stale lock could each unlink + link in
                // ways that lead to two simultaneous holders.
                //
                // Algorithm:
                //   1. Try to acquire <lock>.reclaim atomically via link.
                //   2. Only one contender gets it. That contender:
                //      a. Re-verifies the lock is still stale (content match).
                //      b. Unlinks the stale lock if confirmed.
                //      c. Releases the reclaim-lock.
                //   3. All other contenders skip the reclaim and re-loop —
                //      they'll see either an empty lockPath (acquire wins) or
                //      a fresh lock (no longer reclaimable, they wait).
                const staleSnapshot = readLockContent(lockPath);
                if (staleSnapshot !== null && isLockReclaimable(lockPath, staleMs, absoluteStaleMs)) {
                    if (tryReclaim(lockPath, staleSnapshot, staleMs, absoluteStaleMs)) {
                        continue;
                    }
                }
                if (Date.now() > deadline)
                    return null;
                // Do not spin-wait here. This lock is used by hooks and daemon
                // helpers; a synchronous busy loop can peg a CPU core under
                // contention. Yield briefly through the kernel instead so short
                // concurrent hook writes can still serialize without burning CPU.
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(25, Math.max(1, deadline - Date.now())));
            }
        }
    }
    finally {
        if (stagingCreated) {
            try {
                fs.unlinkSync(stagingPath);
            }
            catch { }
        }
    }
}
/** Read lock content, returning null on error. */
function readLockContent(lockPath) {
    try {
        return fs.readFileSync(lockPath, "utf-8");
    }
    catch {
        return null;
    }
}
/**
 * Attempt to reclaim a stale lock, with reclaim itself serialized
 * through a dedicated reclaim-lock (<lock>.reclaim).
 *
 * Algorithm (all under reclaim-lock — at most one process executes
 * the body):
 *   1. Re-read lockPath content. If it changed since the caller's
 *      snapshot, someone else already reclaimed — abort.
 *   2. Re-check isLockReclaimable. (Defensive: the previous holder
 *      may have become alive again somehow.)
 *   3. Unlink the lock.
 *
 * Returns true if the lock was successfully removed. The reclaim-lock
 * is always released, even on error.
 *
 * Why a reclaim-lock works where rename-CAS didn't: the reclaim-lock
 * is itself acquired via fs.linkSync (atomic exclusive create). Only
 * one contender can hold the reclaim-lock at a time, so the
 * read-check-unlink sequence is single-threaded across the system —
 * eliminating the race that occurs when multiple contenders all try
 * to reclaim concurrently.
 */
function tryReclaim(lockPath, expectedContent, staleMs, absoluteStaleMs) {
    const reclaimLockPath = lockPath + ".reclaim";
    const reclaimStaging = reclaimLockPath + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(reclaimStaging, String(process.pid));
    }
    catch {
        return false;
    }
    let haveReclaimLock = false;
    try {
        try {
            fs.linkSync(reclaimStaging, reclaimLockPath);
            haveReclaimLock = true;
        }
        catch (err) {
            const code = err?.code;
            if (code === "EEXIST") {
                // Another contender is reclaiming. Do not break or steal a live
                // contender's reclaim-lock: it may have already validated the
                // target lock and be paused before unlinking it. Only remove the
                // reclaim-lock when its recorded owner is gone; then let the
                // caller's bounded retry loop attempt a fresh reclaim.
                if (isReclaimLockAbandoned(reclaimLockPath, staleMs * 2)) {
                    try {
                        fs.unlinkSync(reclaimLockPath);
                    }
                    catch { }
                }
                return false;
            }
            return false;
        }
        // Inside the reclaim-lock: re-verify the target is still stale
        // AND still has the exact content the caller observed.
        let currentContent;
        try {
            currentContent = fs.readFileSync(lockPath, "utf-8");
        }
        catch {
            return false; // Already gone.
        }
        if (currentContent !== expectedContent)
            return false; // Someone reclaimed.
        if (!isLockReclaimable(lockPath, staleMs, absoluteStaleMs))
            return false;
        try {
            fs.unlinkSync(lockPath);
            return true;
        }
        catch {
            return false;
        }
    }
    finally {
        if (haveReclaimLock) {
            try {
                fs.unlinkSync(reclaimLockPath);
            }
            catch { }
        }
        try {
            fs.unlinkSync(reclaimStaging);
        }
        catch { }
    }
}
function isReclaimLockAbandoned(reclaimLockPath, staleMs) {
    let stat;
    try {
        stat = fs.statSync(reclaimLockPath);
    }
    catch {
        return false;
    }
    if (Date.now() - stat.mtimeMs <= staleMs)
        return false;
    let pid;
    try {
        pid = Number(fs.readFileSync(reclaimLockPath, "utf-8").trim());
    }
    catch {
        return false;
    }
    if (!Number.isFinite(pid) || pid <= 0)
        return false;
    if (pid === process.pid)
        return false;
    return !isProcessAlive(pid);
}
/**
 * Decide whether a held lock can safely be reclaimed.
 *
 * Reclaim only when:
 *   - absolute fail-safe age exceeded (24h+), OR
 *   - mtime stale AND the recorded pid is no longer running.
 *
 * The pid-liveness check is the key safety property — a long-running
 * but live holder will not be reclaimed, eliminating the
 * "two-active-holders" scenario that pure mtime-based reclaim allowed.
 */
function isLockReclaimable(lockPath, staleMs, absoluteStaleMs) {
    let stat;
    try {
        stat = fs.statSync(lockPath);
    }
    catch {
        // Lock vanished between EEXIST and stat — race in our favor.
        return true;
    }
    const age = Date.now() - stat.mtimeMs;
    if (age > absoluteStaleMs)
        return true; // Fail-safe.
    if (age <= staleMs) {
        // Fresh by mtime — but "fresh" is not the same as "held". If the
        // recorded owner is already DEAD, waiting out staleMs accomplishes
        // nothing: the lock can never be released, so every caller inside that
        // window fails hard instead of reclaiming. Observed four times in one
        // session, each a crashed Stop hook whose 30s-fresh lock made
        // complete-review.js unusable while acquire timed out after 2s.
        //
        // A dead pid is definitive evidence, so reclaim immediately — but only
        // after a short grace period, because a lock created microseconds ago
        // may not have been written by a process we can observe yet (pid reuse
        // and same-tick creation both argue for not trusting a brand-new lock).
        if (age <= DEAD_OWNER_GRACE_MS)
            return false;
        const owner = readLockPid(lockPath);
        if (owner === null)
            return false; // Can't tell who owns it — leave it alone.
        return !isProcessAlive(owner);
    }
    // mtime-stale but maybe still alive. Check the recorded pid.
    let nonce;
    try {
        nonce = fs.readFileSync(lockPath, "utf-8");
    }
    catch {
        return true; // Unreadable lock — treat as stale.
    }
    const pidStr = nonce.split(":")[0];
    const pid = Number(pidStr);
    if (!Number.isFinite(pid) || pid <= 0)
        return true; // Malformed nonce.
    // Same-pid is NOT a reclaim trigger. A crash would create a new
    // process with a new pid, so a same-pid lock means another lock
    // holder inside this Node process (worker_threads, concurrent
    // async usage). Treat it like any other live pid: don't reclaim.
    // The absoluteStaleMs fail-safe (24h) handles the edge case of
    // a genuinely stuck same-process holder.
    return !isProcessAlive(pid);
}
/**
 * Check if a process exists. Returns false on ESRCH (process gone) or
 * any unexpected error (conservative: if we can't tell, assume gone
 * so we don't deadlock on a real crash). Returns true on EPERM (process
 * exists but we lack permission to signal it — that's still alive).
 */
/**
 * Grace period before a fresh-by-mtime lock is eligible for dead-owner
 * reclaim. Guards against reclaiming a lock written microseconds ago whose
 * owner we might misjudge, while staying far below the 2s acquire timeout so
 * the fast path is actually reachable.
 */
const DEAD_OWNER_GRACE_MS = 250;

/** Owner pid recorded in a lock file, or null if unreadable/malformed. */
function readLockPid(lockPath) {
    let nonce;
    try {
        nonce = fs.readFileSync(lockPath, "utf-8");
    }
    catch {
        return null;
    }
    const pid = Number(String(nonce).split(":")[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        const code = err?.code;
        if (code === "EPERM")
            return true; // Exists, just not ours to signal.
        return false; // ESRCH or anything else: treat as dead.
    }
}
/**
 * Atomic + dedup merge of new markdown sections into an existing
 * archive file. Mirrors mergeIntoArchive for JSON.
 *
 * DEDUP: keyed by content hash (sha1 of joined lines), not header line.
 * Header-line dedup would drop distinct sections that happen to share
 * a minute-precision timestamp (a real possibility with rapid hook
 * triggers). Content hash collisions only happen when sections are
 * byte-identical — in which case dropping one is the right call.
 *
 * REFUSE-TO-CLOBBER: if the existing archive has content but parses
 * to zero sections (corrupt or unrecognizable format), abort rather
 * than overwrite. Mirrors JSON's refuse-to-clobber on parse failure.
 */
function mergeIntoMarkdownArchive(archivePath, newSections, headerRe) {
    const release = acquireFileLock(archivePath);
    if (!release)
        return false;
    try {
        let existingSections = [];
        if (fs.existsSync(archivePath)) {
            let existingContent;
            try {
                existingContent = fs.readFileSync(archivePath, "utf-8");
            }
            catch {
                return false;
            }
            const parsed = splitIntoSections(existingContent, headerRe);
            // Refuse to clobber: non-empty content that we can't parse is
            // suspicious — better to leave it for human investigation than
            // silently overwrite.
            if (parsed.length === 0 && existingContent.trim().length > 0) {
                return false;
            }
            existingSections = parsed;
        }
        const seen = new Set();
        const merged = [];
        for (const sec of existingSections) {
            const key = sectionHash(sec);
            if (seen.has(key))
                continue;
            seen.add(key);
            merged.push(sec);
        }
        for (const sec of newSections) {
            const key = sectionHash(sec);
            if (seen.has(key))
                continue;
            seen.add(key);
            merged.push(sec);
        }
        const text = merged.map((s) => s.join("\n")).join("\n");
        return atomicWriteText(archivePath, text);
    }
    finally {
        release();
    }
}
/**
 * Split markdown content into sections by header pattern.
 * Content before the first header is dropped (archives have no preamble).
 */
function splitIntoSections(content, headerRe) {
    const re = withoutStatefulFlags(headerRe);
    const lines = content.split("\n");
    const starts = [];
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]))
            starts.push(i);
    }
    if (starts.length === 0)
        return [];
    const out = [];
    for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
        out.push(lines.slice(start, end));
    }
    return out;
}
/**
 * Merge `newEntries` into the monthly archive at `archivePath` under
 * `arrayKey`, holding a lockfile across the read-modify-write so
 * concurrent trims don't clobber each other.
 *
 * Returns true if the merge committed, false on any failure
 * (lock timeout, write failure). On false, caller must NOT trim
 * the live file — entries would be lost.
 */
function mergeIntoArchive(archivePath, arrayKey, newEntries, liveDoc, getId) {
    const release = acquireFileLock(archivePath);
    if (!release)
        return false;
    try {
        let merged;
        let baseDoc;
        if (fs.existsSync(archivePath)) {
            let parsed;
            try {
                parsed = JSON.parse(fs.readFileSync(archivePath, "utf-8"));
            }
            catch {
                // Existing archive is corrupt. Refuse to clobber.
                return false;
            }
            // Refuse-to-clobber: must be a plain object. null, arrays,
            // primitives all indicate the file is something other than
            // what we wrote — don't overwrite it.
            if (!isPlainObject(parsed)) {
                return false;
            }
            const existing = parsed;
            // Refuse-to-clobber: arrayKey exists but is not an array →
            // schema drift, partial manual edit, malformed-but-valid JSON.
            if (arrayKey in existing && !Array.isArray(existing[arrayKey])) {
                return false;
            }
            baseDoc = existing;
            const existingArr = existing[arrayKey];
            const existingEntries = Array.isArray(existingArr) ? existingArr : [];
            merged = dedupAppend(existingEntries, newEntries, getId);
        }
        else {
            baseDoc = liveDoc;
            merged = newEntries.slice();
        }
        const archiveDoc = { ...baseDoc, [arrayKey]: merged };
        return atomicWriteJson(archivePath, archiveDoc);
    }
    finally {
        release();
    }
}
/**
 * Append `incoming` to `existing`, skipping entries whose id already
 * appears. When `getId` is not provided, plain concatenation is used
 * (callers that need dedup must opt in via getId).
 */
function dedupAppend(existing, incoming, getId) {
    if (!getId)
        return [...existing, ...incoming];
    const seen = new Set();
    for (const e of existing) {
        // Caller callback must never crash the hook.
        const id = safeCall(() => getId(e), undefined);
        if (id)
            seen.add(id);
    }
    const out = existing.slice();
    for (const e of incoming) {
        const id = safeCall(() => getId(e), undefined);
        if (id && seen.has(id))
            continue;
        if (id)
            seen.add(id);
        out.push(e);
    }
    return out;
}
function monthSlugUtc(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}
/**
 * Call a user-supplied callback, swallowing exceptions. Hook-safety
 * contract: a buggy caller callback (getDate/getId/getSectionDate)
 * must not crash the hook. On throw we return `fallback`, which
 * effectively treats the entry as "undated/no-id" — the existing
 * code paths handle that case by keeping the entry inline.
 */
function safeCall(fn, fallback) {
    try {
        return fn();
    }
    catch {
        return fallback;
    }
}
/** Stable content hash for markdown section dedup. */
function sectionHash(lines) {
    return crypto.createHash("sha1").update(lines.join("\n")).digest("hex");
}
/**
 * True if v is a non-null plain object (not array, not null, not primitive).
 * Used to validate JSON.parse output before treating it as a doc — guards
 * against `null`, `[...]`, `"x"`, `123`, etc. that would throw on
 * `doc[key]` or `key in doc`.
 */
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
