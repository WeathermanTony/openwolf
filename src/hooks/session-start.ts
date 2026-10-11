// @ts-nocheck
import * as fs from "node:fs";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, readJSON, mutateJSON, appendMarkdown, timestamp, timeShort, readStdin, getSessionFilePath, runHook, recordHookHealth, getBehaviorConfig } from "./shared.js";
async function main() {
    ensureWolfDir();
    const wolfDir = getWolfDir();
    // The installed manifest is generated from the CLI's canonical hook manifest.
    // Checking it here catches partial upgrades and stale support trees before a
    // silently broken PostToolUse or Stop hook can go unnoticed for days.
    try {
        const manifest = readJSON(path.join(wolfDir, "hooks", "manifest.json"), null);
        const hookFiles = Array.isArray(manifest?.hooks) ? manifest.hooks : [];
        const utilityFiles = Array.isArray(manifest?.utilities) ? manifest.utilities : [];
        const missing = [
            ...hookFiles.map(file => path.join(wolfDir, "hooks", file)),
            ...utilityFiles.map(file => path.join(wolfDir, "utils", file)),
        ].filter(file => !fs.existsSync(file));
        if (!manifest || missing.length > 0) {
            process.stderr.write(`⚠️ WolfPack: hook installation is incomplete (${manifest ? missing.length : "manifest missing"}); run openwolf update.\n`);
        }
        const health = readJSON(path.join(wolfDir, "hooks", "_health.json"), {});
        const degraded = Object.entries(health?.hooks ?? {})
            .filter(([, entry]) => Number(entry?.consecutive_failures ?? 0) > 0)
            .map(([name]) => name);
        if (degraded.length > 0) {
            process.stderr.write(`⚠️ WolfPack: hook health degraded: ${degraded.join(", ")}. Run openwolf status and hook self-checks.\n`);
        }
    }
    catch { }
    // Clean up stale .tmp files left from failed atomic writes
    try {
        const files = fs.readdirSync(wolfDir);
        const staleBefore = Date.now() - 10 * 60 * 1000;
        for (const f of files) {
            if (!f.endsWith(".tmp"))
                continue;
            try {
                const tmpPath = path.join(wolfDir, f);
                if (fs.statSync(tmpPath).mtimeMs < staleBefore)
                    fs.unlinkSync(tmpPath);
            }
            catch { }
        }
    }
    catch { }
    let input = {};
    try {
        input = JSON.parse(await readStdin());
    }
    catch { }
    const now = new Date();
    const fallbackSessionId = `session-${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}-${process.pid}`;
    const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : fallbackSessionId;
    const sessionFile = getSessionFilePath(wolfDir, sessionId, true);
    // Capture a content-hash baseline for this project's cerebrum.md.
    //
    // The Stop-hook freshness rule needs to answer "did cerebrum change during
    // this session?", and mtime cannot answer it: a checkout, touch, or file
    // sync moves mtime without an edit, and a hook that nags right after a
    // `git checkout` trains the user to ignore it. A content hash taken now and
    // compared at Stop is direct evidence. mtime survives only as a fallback
    // when no baseline exists (e.g. this hook did not run).
    //
    // Keyed by absolute POSIX-normalized path because a session can span
    // multiple projects and each owner is evaluated against its OWN cerebrum.
    const cerebrumBaselines = {};
    try {
        const cerebrumPath = path.join(wolfDir, "cerebrum.md");
        const buf = fs.readFileSync(cerebrumPath);
        const { createHash } = await import("node:crypto");
        cerebrumBaselines[cerebrumPath.replace(/\\/g, "/")] = createHash("sha256").update(buf).digest("hex");
    }
    catch { }
    // Initialize this session without replacing state when SessionStart fires again
    // for a resume or compaction lifecycle event.
    let newSession = false;
    const sessionReady = mutateJSON(sessionFile, {
        session_id: sessionId,
        started: timestamp(),
        files_read: {},
        files_written: [],
        edit_counts: {},
        anatomy_hits: 0,
        anatomy_misses: 0,
        repeated_reads_warned: 0,
        cerebrum_warnings: 0,
        stop_count: 0,
        cerebrum_baselines: cerebrumBaselines,
    }, (session, meta) => {
        newSession = !meta.existed;
        return session;
    });
    if (!sessionReady)
        return;
    // Quiet mode keeps session bookkeeping but skips the memory.md header.
    if (getBehaviorConfig().mode === "quiet")
        return;
    // Append session header to memory.md only for a genuinely new session.
    const memoryPath = path.join(wolfDir, "memory.md");
    const header = `\n## Session: ${now.toISOString().slice(0, 10)} ${timeShort()}\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n`;
    // Worst case of the three memory.md appends: if the HEADER is lost, every
    // later row lands under no session header, corrupting the structure that
    // monthlyRotateMarkdown parses to decide what to archive.
    if (newSession && !appendMarkdown(memoryPath, header)) {
        try {
            recordHookHealth("session-start:memory-header", new Error(`append to ${memoryPath} failed`));
        }
        catch { }
    }
    // Check cerebrum freshness — remind Claude to learn
    try {
        const cerebrumPath = path.join(wolfDir, "cerebrum.md");
        const cerebrumContent = fs.readFileSync(cerebrumPath, "utf-8");
        const stat = fs.statSync(cerebrumPath);
        const daysSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        // Count actual entries (non-comment, non-empty lines in content sections)
        const entryLines = cerebrumContent.split("\n").filter(l => {
            const t = l.trim();
            return t.startsWith("- ") || t.startsWith("* ") || (t.startsWith("[") && t.includes("]"));
        });
        if (entryLines.length < 3) {
            process.stderr.write(`💡 OpenWolf: cerebrum.md has only ${entryLines.length} entries. Learn from this session — record user preferences, project conventions, and mistakes to .wolf/cerebrum.md.\n`);
        }
        else if (daysSinceUpdate > 3) {
            process.stderr.write(`💡 OpenWolf: cerebrum.md hasn't been updated in ${Math.floor(daysSinceUpdate)} days. Look for opportunities to add learnings this session.\n`);
        }
    }
    catch { }
    // Check buglog — remind if empty
    try {
        const buglogPath = path.join(wolfDir, "buglog.json");
        const buglog = readJSON(buglogPath, { bugs: [] });
        if (buglog.bugs.length === 0) {
            process.stderr.write(`📋 OpenWolf: buglog.json is empty. If you encounter or fix any bugs, errors, or failed tests this session, log them to .wolf/buglog.json.\n`);
        }
    }
    catch { }
    // Increment exactly once for this session, under the same cross-process
    // transaction discipline as hook state.
    if (newSession) {
        const ledgerPath = path.join(wolfDir, "token-ledger.json");
        const ledgerUpdated = mutateJSON(ledgerPath, { version: 1, lifetime: { total_sessions: 0 } }, (ledger) => {
            ledger.lifetime ??= { total_sessions: 0 };
            ledger.lifetime.total_sessions = (ledger.lifetime.total_sessions ?? 0) + 1;
            return ledger;
        }, { timeoutMs: 4_000 });
        if (!ledgerUpdated)
            process.stderr.write(`⚠️ WolfPack: could not record SessionStart in ${ledgerPath}; existing bytes were preserved.\n`);
    }
    return;
}
runHook("session-start", main);
