// @ts-nocheck
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getWolfDir, ensureWolfDir, readJSON, writeJSON, parseAnatomy, serializeAnatomy, extractDescription, estimateTokens, appendMarkdown, timeShort, readStdin, normalizePath, getSizeDisciplineConfig } from "./shared.js";
import { rollingWindowJson, acquireFileLock } from "../utils/size-discipline.js";
async function main() {
    ensureWolfDir();
    const wolfDir = getWolfDir();
    const hooksDir = path.join(wolfDir, "hooks");
    const sessionFile = path.join(hooksDir, "_session.json");
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    }
    catch {
        process.exit(0);
        return;
    }
    const toolName = input.tool_name ?? "Write";
    const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
    if (!filePath) {
        process.exit(0);
        return;
    }
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
    // Skip most processing for .wolf/ internal files to avoid slow self-referential
    // updates of anatomy/memory/buglog by their own auto-maintenance. EXCEPTIONS:
    //
    //   1. `.wolf/qa/<slug>.md` (adversarial reductions, direct children only)
    //      MUST be tracked in _session.json:files_written so stop.js's
    //      conclusion gate can detect that the assistant addressed the gate
    //      this turn (sessionWroteReduction check). See bug-111 and
    //      .wolf/qa/conclusion-gate-cannot-self-suppress.md.
    //
    //   2. `.wolf/buglog.json` MUST be tracked so stop.js's buglog freshness
    //      gate (checkBuglogFreshness at stop.ts:679–751) can see the
    //      in-session write. The gate has an mtime-on-disk fallback path
    //      (line 740) that covers the common case, but its in-session path
    //      (line 745) is load-bearing when no multi-edit file has a parseable
    //      `at` timestamp (Scenario C in the QA reduction). Without this
    //      exception, the buglog gate's self-suppression is unreliable —
    //      same convergence failure mode as bug-111. See bug-112 and
    //      .wolf/qa/post-write-allow-buglog-tracking.md.
    //
    // Path classification:
    //   `isInWolfDir` uses CASE-INSENSITIVE `.wolf/` matching so case-insensitive
    //     filesystems (Windows, default macOS HFS+/APFS) don't bypass the
    //     self-trigger skip when a tool emits `.WOLF/anatomy.md`.
    //   `isWolfQaReduction` and `isWolfBuglog` use CASE-SENSITIVE matching to
    //     align with stop.ts's case-sensitive substring checks (stop.ts:1062
    //     for qa, stop.ts:734 for buglog). A `.WOLF/qa/Foo.md` or
    //     `.WOLF/buglog.json` on a case-insensitive FS would refer to the
    //     same files but stop.ts wouldn't see them — so taking the allowlist
    //     fast-path here would record entries the consumers can't read.
    //     Better to drop those uppercase variants entirely via `isInWolfDir`.
    //   The qa predicate is restricted to DIRECT children of `.wolf/qa/` (no
    //     nested subdirs) so future sub-features under qa/ don't accidentally
    //     become reductions.
    //   This case-asymmetry is intentional and load-bearing — claude
    //   review-0028 caught the previous half-implemented case-insensitive
    //   state on the qa predicate; the same lesson applies to buglog.
    const relPath = normalizePath(path.relative(projectRoot, absolutePath));
    const isInWolfDir = relPath.toLowerCase().startsWith(".wolf/");
    const qaPrefix = ".wolf/qa/";
    const isWolfQaReduction = relPath.startsWith(qaPrefix) &&
        relPath.endsWith(".md") &&
        !path.basename(relPath).startsWith("_") &&
        // direct child only: slash count after the qa/ prefix must be zero
        !relPath.slice(qaPrefix.length).includes("/");
    // CONTRACT: the consumer at stop.ts checkForMissingBugLogs (the buglog
    // freshness gate) uses `normalizeFilePath(path.join(wolfDir, "buglog.json"))`
    // as its identity check. Both this producer and that consumer derive
    // wolfDir/projectRoot from `process.env.CLAUDE_PROJECT_DIR || process.cwd()`
    // — the same anchor — so this exact-match check accepts a write iff the
    // consumer would accept the stored absolute path for that write. Do not
    // weaken this to a substring or suffix match; do not strengthen it without
    // also changing the consumer.
    const isWolfBuglog = relPath === ".wolf/buglog.json";
    const isWolfAllowlisted = isWolfQaReduction || isWolfBuglog;
    if (isInWolfDir && !isWolfAllowlisted) {
        process.exit(0);
        return;
    }
    // Never track .env files in anatomy — they contain secrets
    const baseName = path.basename(absolutePath);
    if (baseName === ".env" || baseName.startsWith(".env.")) {
        process.exit(0);
        return;
    }
    const oldStr = input.tool_input?.old_string ?? "";
    const newStr = input.tool_input?.new_string ?? "";
    // 1. Update anatomy.md — read-modify-write must be lock-protected to prevent
    // concurrent post-write hooks from clobbering each other's anatomy entries.
    // Skip for .wolf/qa/ reductions AND .wolf/buglog.json: they're closed
    // feedback loops with the gates, not part of the project's file map.
    if (!isWolfAllowlisted)
        try {
            const anatomyPath = path.join(wolfDir, "anatomy.md");
            const anatomyLock = acquireFileLock(anatomyPath);
            if (anatomyLock) {
                try {
                    let anatomyContent;
                    try {
                        anatomyContent = fs.readFileSync(anatomyPath, "utf-8");
                    }
                    catch {
                        anatomyContent = "# anatomy.md\n\n> Auto-maintained by OpenWolf.\n";
                    }
                    const sections = parseAnatomy(anatomyContent);
                    const relPathLocal = normalizePath(path.relative(projectRoot, absolutePath));
                    const dir = path.dirname(relPathLocal);
                    const fileName = path.basename(relPathLocal);
                    const sectionKey = dir === "." ? "./" : dir + "/";
                    let fileContent = "";
                    try {
                        fileContent = fs.readFileSync(absolutePath, "utf-8");
                    }
                    catch {
                        fileContent = input.tool_input?.content ?? "";
                    }
                    const desc = extractDescription(absolutePath).slice(0, 100);
                    const ext = path.extname(absolutePath).toLowerCase();
                    const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".json", ".yaml", ".yml", ".css"]);
                    const proseExts = new Set([".md", ".txt", ".rst"]);
                    const type = codeExts.has(ext) ? "code" : proseExts.has(ext) ? "prose" : "mixed";
                    const tokens = estimateTokens(fileContent, type);
                    if (!sections.has(sectionKey))
                        sections.set(sectionKey, []);
                    const entries = sections.get(sectionKey);
                    const idx = entries.findIndex((e) => e.file === fileName);
                    if (idx !== -1) {
                        entries[idx] = { file: fileName, description: desc, tokens };
                    }
                    else {
                        entries.push({ file: fileName, description: desc, tokens });
                    }
                    let fileCount = 0;
                    for (const [, list] of sections)
                        fileCount += list.length;
                    const serialized = serializeAnatomy(sections, {
                        lastScanned: new Date().toISOString(),
                        fileCount,
                        hits: 0,
                        misses: 0,
                    });
                    const tmp = anatomyPath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
                    try {
                        fs.writeFileSync(tmp, serialized, "utf-8");
                        fs.renameSync(tmp, anatomyPath);
                    }
                    catch {
                        try {
                            fs.writeFileSync(anatomyPath, serialized, "utf-8");
                        }
                        catch { }
                        try {
                            fs.unlinkSync(tmp);
                        }
                        catch { }
                    }
                }
                finally {
                    anatomyLock();
                }
            }
        }
        catch { }
    // 2. Append richer entry to memory.md. Skip for .wolf/qa/ reductions AND
    // .wolf/buglog.json — the stop hook already appends session-end summary
    // lines, and per-write memory entries for the gates' own outputs would
    // just amplify noise.
    if (!isWolfAllowlisted)
        try {
            const action = toolName === "Write" ? "Created" : toolName === "MultiEdit" ? "Multi-edited" : "Edited";
            const relFile = normalizePath(path.relative(projectRoot, absolutePath));
            const fileContent = input.tool_input?.content ?? "";
            const ext = path.extname(absolutePath).toLowerCase();
            const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".json", ".yaml", ".yml", ".css"]);
            const type = codeExts.has(ext) ? "code" : "mixed";
            const writeTokens = estimateTokens(fileContent || newStr, type);
            let changeDesc = "";
            if (oldStr && newStr) {
                changeDesc = summarizeEdit(oldStr, newStr, baseName);
            }
            const memoryPath = path.join(wolfDir, "memory.md");
            const outcome = changeDesc || "—";
            // Lock the append so a concurrent monthlyRotateMarkdown call (stop.ts) can't
            // truncate the file between our append and a downstream read. Drop silently
            // if the lock can't be acquired — we'd rather lose one memory line than block.
            const memLock = acquireFileLock(memoryPath);
            if (memLock) {
                try {
                    appendMarkdown(memoryPath, `| ${timeShort()} | ${action} ${relFile} | ${outcome} | ~${writeTokens} |\n`);
                }
                finally {
                    memLock();
                }
            }
        }
        catch { }
    // 3. Record in session tracker + track edit counts — lock-protected so
    // parallel post-write hooks can't drop each other's files_written/edit_counts
    // updates via overlapping read-modify-write.
    //
    // For .wolf/qa/<slug>.md reductions, the conclusion gate's autonomy-loop
    // convergence DEPENDS on the write reaching files_written. A normal write
    // can silently drop on lock contention (acceptable: at worst we lose one
    // session-tracker line), but a qa reduction must NOT — otherwise the gate
    // re-fires every turn and the loop never converges. Retry the lock with
    // bounded backoff for qa reductions only; non-qa writes keep the old
    // best-effort semantics.
    //
    // Same convergence requirement applies to .wolf/buglog.json — the buglog
    // freshness gate's in-session suppression path depends on the write being
    // tracked. A silently-dropped buglog tracking would cause Scenario C
    // (no parseable `at` on multi-edit files) to false-fire the nudge.
    try {
        let sessionLock = acquireFileLock(sessionFile);
        if (!sessionLock && isWolfAllowlisted) {
            // Retry up to 10x ~50ms each = ~500ms total. Beyond that, a stuck lock
            // is a separate bug (lockfile leak) that should fail loudly via stderr.
            for (let i = 0; i < 10 && !sessionLock; i++) {
                const target = Date.now() + 50;
                while (Date.now() < target) { /* spin: no Atomics.wait in this runtime */ }
                sessionLock = acquireFileLock(sessionFile);
            }
            if (!sessionLock) {
                const kind = isWolfQaReduction ? ".wolf/qa/ reduction" : ".wolf/buglog.json write";
                const gate = isWolfQaReduction ? "conclusion gate's" : "buglog freshness gate's";
                process.stderr.write(`⚠️ OpenWolf: post-write could not acquire ${sessionFile} lock for ${kind} "${relPath}" after 10 retries. ` +
                    `The ${gate} self-suppression will fail for this turn. ` +
                    `Check for a stale lockfile at ${sessionFile}.lock.\n`);
            }
        }
        if (sessionLock) {
            try {
                const session = readJSON(sessionFile, { files_written: [], edit_counts: {} });
                if (!session.edit_counts)
                    session.edit_counts = {};
                if (!Array.isArray(session.files_written))
                    session.files_written = [];
                // Store the absolute, forward-slash-normalized file path. stop.ts's
                // sessionWroteReduction check at stop.ts:1062 does
                // `f.replace(/\\/g, "/").includes("/.wolf/qa/")` — a substring check
                // requiring a leading `/`. Absolute paths like `/home/.../.wolf/qa/foo.md`
                // satisfy that; project-relative paths like `.wolf/qa/foo.md` do NOT.
                //
                // CRITICAL: normalize `absolutePath` (the already-resolved form at L55),
                // not `filePath` (the raw tool input). When a tool passes a relative
                // `file_path` like `.wolf/qa/foo.md`, `normalizePath(filePath)` would
                // produce `.wolf/qa/foo.md` (no leading slash) and the gate would
                // never see the reduction. This was the bug Claude review-0028 caught
                // — the prior code used `filePath`, and the falsifier passed only
                // because its driver constructed paths via `path.join(root, ...)`
                // which always yields absolute. Covered by T13.
                const normalizedFile = normalizePath(absolutePath);
                const action = toolName === "Write" ? "create" : "edit";
                const fileContent = input.tool_input?.content ?? "";
                const tokens = estimateTokens(fileContent || newStr, "code");
                session.files_written.push({
                    file: normalizedFile,
                    action,
                    tokens,
                    at: new Date().toISOString(),
                });
                const editKey = relPath && !relPath.startsWith("..") ? relPath : normalizedFile;
                const prevCount = typeof session.edit_counts[editKey] === "number" ? session.edit_counts[editKey] : 0;
                session.edit_counts[editKey] = prevCount + 1;
                writeJSON(sessionFile, session);
                // Suppress the multi-edit buglog warning for qa reductions and for
                // buglog.json itself. Qa reductions are expected to be re-edited
                // within a session as the user iterates on the falsification test.
                // Buglog.json is legitimately edited multiple times per session
                // (each new bug append) — firing "edited 3+ times, log a bug" on
                // the buglog itself recommends logging a bug about logging bugs.
                if (!isWolfAllowlisted && session.edit_counts[editKey] >= 3) {
                    process.stderr.write(`⚠️ OpenWolf: ${baseName} has been edited ${session.edit_counts[editKey]} times this session. If you're fixing a bug, remember to log it to .wolf/buglog.json.\n`);
                }
            }
            finally {
                sessionLock();
            }
        }
    }
    catch { }
    // 4. Auto-detect bug-fix patterns and log them. Skip for .wolf/qa/
    // reductions (they're prose, not code edits — the detector would
    // false-positive on every reduction containing a code snippet) AND for
    // .wolf/buglog.json itself (running fix-pattern detection on the diff
    // between two buglog states would produce a recursive auto-entry every
    // time the assistant logs a real bug).
    if (!isWolfAllowlisted)
        try {
            if (oldStr && newStr) {
                autoDetectBugFix(wolfDir, absolutePath, projectRoot, oldStr, newStr);
            }
        }
        catch { }
    process.exit(0);
}
// ─── Edit Summarizer ─────────────────────────────────────────────
function summarizeEdit(oldStr, newStr, filename) {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");
    const oldCount = oldLines.length;
    const newCount = newLines.length;
    const ext = path.extname(filename).toLowerCase();
    // --- Structural fixes ---
    if (newStr.includes("try") && newStr.includes("catch") && !oldStr.includes("catch")) {
        return "added error handling";
    }
    if (newStr.includes("?.") && !oldStr.includes("?."))
        return "added optional chaining";
    if (newStr.includes("?? ") && !oldStr.includes("?? "))
        return "added nullish coalescing";
    // --- Deleted code ---
    if (!newStr.trim() || newStr.trim().length < oldStr.trim().length * 0.2) {
        return `removed ${oldCount} lines`;
    }
    // --- Import changes ---
    const oldImports = oldLines.filter(l => /^\s*(import|require|use |from )/.test(l)).length;
    const newImports = newLines.filter(l => /^\s*(import|require|use |from )/.test(l)).length;
    if (newImports > oldImports && Math.abs(newCount - oldCount) <= newImports - oldImports + 1) {
        return `added ${newImports - oldImports} import(s)`;
    }
    // --- Value/string replacement (common bug fix: wrong value) ---
    if (oldCount === 1 && newCount === 1) {
        const o = oldStr.trim();
        const n = newStr.trim();
        // String literal change
        const oStr = o.match(/['"`]([^'"`]+)['"`]/);
        const nStr = n.match(/['"`]([^'"`]+)['"`]/);
        if (oStr && nStr && oStr[1] !== nStr[1]) {
            return `"${oStr[1].slice(0, 25)}" → "${nStr[1].slice(0, 25)}"`;
        }
        // Number change
        const oNum = o.match(/\b(\d+\.?\d*)\b/);
        const nNum = n.match(/\b(\d+\.?\d*)\b/);
        if (oNum && nNum && oNum[1] !== nNum[1] && o.replace(oNum[1], "") === n.replace(nNum[1], "")) {
            return `${oNum[1]} → ${nNum[1]}`;
        }
        return "inline fix";
    }
    // --- Method/function call changes ---
    const oldCalls = extractCalls(oldStr);
    const newCalls = extractCalls(newStr);
    const addedCalls = newCalls.filter(c => !oldCalls.includes(c));
    const removedCalls = oldCalls.filter(c => !newCalls.includes(c));
    if (removedCalls.length === 1 && addedCalls.length === 1) {
        return `${removedCalls[0]}() → ${addedCalls[0]}()`;
    }
    // --- CSS/style changes ---
    if (ext === ".css" || ext === ".scss" || ext === ".vue" || ext === ".tsx" || ext === ".jsx") {
        const oldProps = (oldStr.match(/[\w-]+\s*:/g) || []).map(p => p.replace(/\s*:/, ""));
        const newProps = (newStr.match(/[\w-]+\s*:/g) || []).map(p => p.replace(/\s*:/, ""));
        const changed = newProps.filter(p => !oldProps.includes(p));
        if (changed.length > 0 && changed.length <= 3) {
            return `CSS: ${changed.join(", ")}`;
        }
    }
    // --- Condition changes ---
    const oldConds = (oldStr.match(/if\s*\(([^)]+)\)/g) || []);
    const newConds = (newStr.match(/if\s*\(([^)]+)\)/g) || []);
    if (newConds.length > oldConds.length) {
        return `added ${newConds.length - oldConds.length} condition(s)`;
    }
    // --- Function modified ---
    const fnMatch = newStr.match(/(?:function|def|fn|func|async\s+function)\s+(\w+)/);
    if (fnMatch) {
        return `modified ${fnMatch[1]}()`;
    }
    // --- Class/method context ---
    const methodMatch = newStr.match(/(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
    if (methodMatch) {
        return `modified ${methodMatch[1]}()`;
    }
    // --- Size-based fallback ---
    if (newCount > oldCount + 5)
        return `expanded (+${newCount - oldCount} lines)`;
    if (oldCount > newCount + 5)
        return `reduced (-${oldCount - newCount} lines)`;
    return `${oldCount}→${newCount} lines`;
}
function extractCalls(code) {
    return [...new Set((code.match(/(\w+)\s*\(/g) || [])
            .map(m => m.match(/(\w+)/)?.[1] || "")
            .filter(n => n.length > 2 && !["if", "for", "while", "switch", "catch", "function", "return", "new", "typeof", "instanceof", "const", "let", "var"].includes(n)))];
}
// ─── Auto Bug Detection ──────────────────────────────────────────
function autoDetectBugFix(wolfDir, absolutePath, projectRoot, oldStr, newStr) {
    const bugLogPath = path.join(wolfDir, "buglog.json");
    const relFile = normalizePath(path.relative(projectRoot, absolutePath));
    const basename = path.basename(absolutePath);
    const ext = path.extname(basename).toLowerCase();
    // Detect what kind of fix this is — cheap, do it before taking the lock.
    const detection = detectFixPattern(oldStr, newStr, ext);
    if (!detection)
        return;
    // Lock the buglog for the full read-modify-write. Without this, two parallel
    // post-write hooks can both compute `bug-${length+1}` and collide on ID, or
    // one's write can clobber the other's append. Drop the entry silently if the
    // lock can't be acquired — losing one auto-detected log line is acceptable.
    const lockRelease = acquireFileLock(bugLogPath);
    if (!lockRelease)
        return;
    try {
        const bugLog = readJSON(bugLogPath, { version: 1, bugs: [] });
        if (!Array.isArray(bugLog.bugs))
            bugLog.bugs = [];
        for (const entry of bugLog.bugs) {
            if (!Object.prototype.hasOwnProperty.call(entry, "commit"))
                entry.commit = null;
            if (!Object.prototype.hasOwnProperty.call(entry, "reduction"))
                entry.reduction = null;
        }
        // Check for recent duplicate (same file + same category within 5 min)
        const recentDupe = bugLog.bugs.find(b => {
            if (path.basename(b.file) !== basename)
                return false;
            if (!b.tags.includes("auto-detected"))
                return false;
            if (!b.tags.includes(detection.category))
                return false;
            const bugTime = new Date(b.last_seen).getTime();
            return (Date.now() - bugTime) < 5 * 60 * 1000;
        });
        if (recentDupe) {
            recentDupe.occurrences = (typeof recentDupe.occurrences === "number" ? recentDupe.occurrences : 0) + 1;
            recentDupe.last_seen = new Date().toISOString();
            if (detection.context && !recentDupe.fix.includes(detection.context)) {
                recentDupe.fix += ` | Also: ${detection.context}`;
            }
            writeJSON(bugLogPath, bugLog);
            return;
        }
        // ID generation uses max(existing numeric suffix) + 1, NOT array.length + 1.
        // Length-based IDs collide with surviving entries after rolling-window prunes
        // earlier ones, and with parallel writers that all saw the same length.
        let maxId = 0;
        for (const b of bugLog.bugs) {
            const m = /^bug-(\d+)$/.exec(b.id || "");
            if (m) {
                const n = parseInt(m[1], 10);
                if (Number.isFinite(n) && n > maxId)
                    maxId = n;
            }
        }
        const nextId = `bug-${String(maxId + 1).padStart(3, "0")}`;
        bugLog.bugs.push({
            id: nextId,
            timestamp: new Date().toISOString(),
            error_message: detection.summary,
            file: relFile,
            root_cause: detection.rootCause,
            fix: detection.fix,
            tags: ["auto-detected", detection.category, ext.replace(".", "") || "unknown"],
            related_bugs: [],
            occurrences: 1,
            last_seen: new Date().toISOString(),
            commit: null,
            reduction: null,
        });
        writeJSON(bugLogPath, bugLog);
    }
    finally {
        lockRelease();
    }
    // Apply rolling-window retention OUTSIDE the lock (rollingWindowJson takes
    // its own lock internally; nesting would deadlock).
    try {
        const cfg = getSizeDisciplineConfig();
        if (cfg.enabled) {
            rollingWindowJson({
                file: bugLogPath,
                arrayKey: "bugs",
                getDate: (e) => e.last_seen,
                getId: (e) => e.id,
                retentionDays: cfg.buglog.retention_days,
            });
        }
    }
    catch { }
}
function detectFixPattern(oldStr, newStr, ext) {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");
    // --- Error handling added ---
    if (newStr.includes("catch") && !oldStr.includes("catch")) {
        const fn = newStr.match(/(?:function|def|async)\s+(\w+)/)?.[1] || "unknown";
        return {
            category: "error-handling",
            summary: `Missing error handling in ${path.basename(fn)}`,
            rootCause: "Code path had no error handling — exceptions would propagate uncaught",
            fix: `Added try/catch block`,
            context: extractChangedLines(oldStr, newStr),
        };
    }
    // --- Null/undefined safety ---
    if ((newStr.includes("?.") && !oldStr.includes("?.")) ||
        (newStr.includes("?? ") && !oldStr.includes("?? ")) ||
        (/!==?\s*(null|undefined)/.test(newStr) && !/!==?\s*(null|undefined)/.test(oldStr))) {
        return {
            category: "null-safety",
            summary: `Null/undefined access in ${path.basename(path.basename(""))}`,
            rootCause: "Property access on potentially null/undefined value",
            fix: `Added null safety (optional chaining or null check)`,
            context: extractChangedLines(oldStr, newStr),
        };
    }
    // --- Guard clause / early return added ---
    if (/if\s*\([^)]*\)\s*(return|throw|continue|break)/.test(newStr) &&
        !/if\s*\([^)]*\)\s*(return|throw|continue|break)/.test(oldStr)) {
        const condition = newStr.match(/if\s*\(([^)]+)\)/)?.[1]?.trim().slice(0, 60) || "condition";
        return {
            category: "guard-clause",
            summary: `Missing guard clause`,
            rootCause: `No early return/throw for edge case: ${condition}`,
            fix: `Added guard clause: if (${condition.slice(0, 40)})`,
        };
    }
    // --- Wrong value / string fix (very common bug) ---
    if (oldLines.length <= 3 && newLines.length <= 3) {
        const oldJoined = oldStr.trim();
        const newJoined = newStr.trim();
        // String literal changed
        const oStrs = oldJoined.match(/['"`]([^'"`]{2,})['"`]/g) || [];
        const nStrs = newJoined.match(/['"`]([^'"`]{2,})['"`]/g) || [];
        if (oStrs.length > 0 && nStrs.length > 0) {
            for (let i = 0; i < Math.min(oStrs.length, nStrs.length); i++) {
                if (oStrs[i] !== nStrs[i]) {
                    return {
                        category: "wrong-value",
                        summary: `Incorrect value in code`,
                        rootCause: `Had ${oStrs[i].slice(0, 50)}`,
                        fix: `Changed to ${nStrs[i].slice(0, 50)}`,
                    };
                }
            }
        }
        // Variable name / method call changed
        const oldTokens = tokenizeCode(oldJoined);
        const newTokens = tokenizeCode(newJoined);
        const changed = [];
        for (let i = 0; i < Math.min(oldTokens.length, newTokens.length); i++) {
            if (oldTokens[i] !== newTokens[i]) {
                changed.push([oldTokens[i], newTokens[i]]);
            }
        }
        if (changed.length === 1 && changed[0][0].length > 2) {
            return {
                category: "wrong-reference",
                summary: `Wrong reference: ${changed[0][0]} should be ${changed[0][1]}`,
                rootCause: `Used "${changed[0][0]}" instead of "${changed[0][1]}"`,
                fix: `Changed ${changed[0][0]} → ${changed[0][1]}`,
            };
        }
    }
    // --- Logic fix (condition changed) ---
    const oldCond = oldStr.match(/if\s*\(([^)]+)\)/)?.[1];
    const newCond = newStr.match(/if\s*\(([^)]+)\)/)?.[1];
    if (oldCond && newCond && oldCond !== newCond && oldLines.length <= 5) {
        return {
            category: "logic-fix",
            summary: `Wrong condition in logic`,
            rootCause: `Condition was: if (${oldCond.slice(0, 50)})`,
            fix: `Changed to: if (${newCond.slice(0, 50)})`,
        };
    }
    // --- Operator fix (=== vs ==, > vs >=, etc.) ---
    const opChange = findOperatorChange(oldStr, newStr);
    if (opChange) {
        return {
            category: "operator-fix",
            summary: `Wrong operator: ${opChange.old} should be ${opChange.new}`,
            rootCause: `Used "${opChange.old}" instead of "${opChange.new}"`,
            fix: `Changed operator ${opChange.old} → ${opChange.new}`,
        };
    }
    // --- Missing import/require ---
    const oldImports = new Set((oldStr.match(/(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g) || []).map(m => m));
    const newImports = (newStr.match(/(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g) || []);
    const addedImports = newImports.filter(i => !oldImports.has(i));
    if (addedImports.length > 0 && newLines.length - oldLines.length <= addedImports.length + 2) {
        const modules = addedImports.map(i => i.match(/['"]([^'"]+)['"]/)?.[1] || "").filter(Boolean);
        return {
            category: "missing-import",
            summary: `Missing import: ${modules.join(", ")}`,
            rootCause: `Module(s) not imported: ${modules.join(", ")}`,
            fix: `Added import(s) for ${modules.join(", ")}`,
        };
    }
    // --- Return value fix ---
    const oldReturn = oldStr.match(/return\s+(.+)/)?.[1]?.trim();
    const newReturn = newStr.match(/return\s+(.+)/)?.[1]?.trim();
    if (oldReturn && newReturn && oldReturn !== newReturn && oldLines.length <= 5) {
        return {
            category: "return-value",
            summary: `Wrong return value`,
            rootCause: `Was returning: ${oldReturn.slice(0, 50)}`,
            fix: `Now returns: ${newReturn.slice(0, 50)}`,
        };
    }
    // --- Async/await fix ---
    if (newStr.includes("await ") && !oldStr.includes("await ")) {
        return {
            category: "async-fix",
            summary: `Missing await`,
            rootCause: `Async call without await — returned Promise instead of value`,
            fix: `Added await to async call`,
            context: extractChangedLines(oldStr, newStr),
        };
    }
    if (newStr.includes("async ") && !oldStr.includes("async ")) {
        return {
            category: "async-fix",
            summary: `Function not marked async`,
            rootCause: `Function uses await but wasn't declared async`,
            fix: `Added async modifier`,
        };
    }
    // --- Type annotation/cast fix ---
    if (ext === ".ts" || ext === ".tsx") {
        if ((newStr.includes(" as ") && !oldStr.includes(" as ")) ||
            (newStr.includes(": ") && !oldStr.includes(": ") && oldLines.length <= 3)) {
            return {
                category: "type-fix",
                summary: `Type error`,
                rootCause: `Missing or incorrect type annotation`,
                fix: `Added type assertion/annotation`,
                context: extractChangedLines(oldStr, newStr),
            };
        }
    }
    // --- CSS/style fix ---
    if (ext === ".css" || ext === ".scss" || ext === ".vue" || ext === ".tsx" || ext === ".jsx") {
        const oldProps = extractCSSProps(oldStr);
        const newProps = extractCSSProps(newStr);
        const changedProps = [...newProps.entries()].filter(([k, v]) => oldProps.get(k) !== v && oldProps.has(k));
        if (changedProps.length > 0 && changedProps.length <= 3) {
            const desc = changedProps.map(([k, v]) => `${k}: ${oldProps.get(k)} → ${v}`).join("; ");
            return {
                category: "style-fix",
                summary: `CSS fix: ${changedProps.map(([k]) => k).join(", ")}`,
                rootCause: desc,
                fix: `Changed ${desc}`,
            };
        }
    }
    // --- Significant diff (catch-all for substantial edits) ---
    const diffRatio = Math.abs(newStr.length - oldStr.length) / Math.max(oldStr.length, 1);
    if (diffRatio > 0.3 && oldLines.length >= 3 && newLines.length >= 3) {
        // Only log if there's meaningful structural change, not just additions
        const removedLines = oldLines.filter(l => l.trim() && !newLines.some(nl => nl.trim() === l.trim()));
        if (removedLines.length >= 2) {
            return {
                category: "refactor",
                summary: `Significant refactor of ${path.basename("")}`,
                rootCause: `${removedLines.length} lines replaced/restructured`,
                fix: `Rewrote ${oldLines.length}→${newLines.length} lines (${removedLines.length} removed)`,
                context: removedLines.slice(0, 2).map(l => l.trim().slice(0, 50)).join("; "),
            };
        }
    }
    return null;
}
function extractChangedLines(oldStr, newStr) {
    const oldLines = new Set(oldStr.split("\n").map(l => l.trim()).filter(Boolean));
    const newLines = newStr.split("\n").map(l => l.trim()).filter(Boolean);
    const added = newLines.filter(l => !oldLines.has(l));
    return added.slice(0, 2).map(l => l.slice(0, 60)).join("; ");
}
function tokenizeCode(code) {
    return code.replace(/[^\w$]/g, " ").split(/\s+/).filter(t => t.length > 0);
}
function findOperatorChange(oldStr, newStr) {
    const operators = ["===", "!==", "==", "!=", ">=", "<=", ">>", "<<", "&&", "||", "??"];
    for (const op of operators) {
        if (oldStr.includes(op) && !newStr.includes(op)) {
            for (const op2 of operators) {
                if (op2 !== op && newStr.includes(op2) && !oldStr.includes(op2)) {
                    return { old: op, new: op2 };
                }
            }
        }
    }
    return null;
}
function extractCSSProps(code) {
    const props = new Map();
    const matches = code.matchAll(/([\w-]+)\s*:\s*([^;}\n]+)/g);
    for (const m of matches) {
        props.set(m[1].trim(), m[2].trim());
    }
    return props;
}
main().catch(() => process.exit(0));
//# sourceMappingURL=post-write.js.map