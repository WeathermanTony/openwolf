// @ts-nocheck
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getWolfDir, ensureWolfDir, readJSON, writeJSON, readMarkdown, readStdin, runHook, getBehaviorConfig } from "./shared.js";
import { acquireFileLock, atomicWriteJson } from "../utils/size-discipline.js";
async function main() {
    ensureWolfDir();
    if (getBehaviorConfig().mode === "quiet")
        return;
    const wolfDir = getWolfDir();
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    }
    catch {
        return;
        return;
    }
    // For Edit tool, the meaningful content is old_string + new_string
    const content = input.tool_input?.content ?? "";
    const oldStr = input.tool_input?.old_string ?? "";
    const newStr = input.tool_input?.new_string ?? "";
    const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
    const allContent = [content, oldStr, newStr].join("\n");
    if (!allContent.trim()) return;
    // 1. Cerebrum Do-Not-Repeat check
    checkCerebrum(wolfDir, allContent);
    // 2. Bug log: search for similar past bugs when editing code
    // This fires when Claude is about to edit a file — if the edit looks like a fix
    // (changing error handling, modifying catch blocks, etc.), check the bug log
    if (filePath && (oldStr || content)) {
        checkBugLog(wolfDir, filePath, oldStr, newStr, content);
    }
    return;
}
function lessonId(lessonText) {
    // 12-char hash. Stable across hook runs for IDENTICAL text. Wording edits
    // produce a new ID — that's intentional: a meaningfully reworded lesson
    // is a different lesson, and stats continuity for typo fixes is a feature
    // we explicitly don't try to provide (would require fuzzy matching).
    return crypto.createHash("sha1").update(lessonText).digest("hex").slice(0, 12);
}
// Prose words that follow "never use" but are never code names. Keywords
// such as any, new, this, for and not stay matchable.
const FILLER_WORDS = /^(a|an|the|that|these|those|its|their|our|your)$/i;
// Two or more characters including a letter: rm, fs, eval, md5, 3DES, $VAR.
function isCodeName(word) {
    return word.trim().length >= 2 && /[A-Za-z]/.test(word);
}
function checkCerebrum(wolfDir, content) {
    const cerebrumContent = readMarkdown(path.join(wolfDir, "cerebrum.md"));
    // Anchor on real `## ` headings. An unanchored "## " also matches inside
    // every "### " subheading, which cut the section at its first subheading
    // and silently disabled every lesson below it.
    const heading = /^ {0,3}## Do-Not-Repeat.*$/m.exec(cerebrumContent);
    if (!heading)
        return;
    const entries = cerebrumContent.slice(heading.index + heading[0].length).split(/^ {0,3}## /m)[0];
    const lines = entries.split("\n").filter((l) => l.trim().startsWith("[") || l.trim().startsWith("-"));
    // Track lessons that fired THIS invocation so a single Do-Not-Repeat line
    // with multiple matching patterns counts as one hit, not many.
    const firedThisCall = new Set();
    for (const line of lines) {
        const trimmed = line.trim().replace(/^[-*]\s*/, "").replace(/^\[[\d-]+\]\s*/, "");
        if (!trimmed)
            continue;
        const patterns = [];
        const quotedMatches = trimmed.match(/"([^"]+)"/g) || trimmed.match(/'([^']+)'/g) || trimmed.match(/`([^`]+)`/g);
        if (quotedMatches) {
            for (const qm of quotedMatches) {
                const fragment = qm.replace(/["'`]/g, "");
                // Short fragments ("the", "a", "_", "if") match almost any write
                // and turn the warning into noise. Keep 5+ chars with a letter, or
                // a backticked name of 2+ chars (`rm`, `eval`), which is deliberate.
                const longEnough = fragment.trim().length >= 5 && /[A-Za-z]/.test(fragment);
                const codeName = qm.startsWith("`") && isCodeName(fragment);
                if (longEnough || codeName)
                    patterns.push(fragment);
            }
        }
        const neverMatch = trimmed.match(/(?:never use|avoid|don't use|do not use)\s+[`"']?(\w+)/i);
        // "Never use eval" names its word on purpose, so short names count,
        // but not filler such as "never use the ...".
        if (neverMatch && !FILLER_WORDS.test(neverMatch[1]))
            patterns.push(neverMatch[1]);
        for (const pattern of patterns) {
            try {
                const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
                if (regex.test(content)) {
                    const id = lessonId(trimmed);
                    if (!firedThisCall.has(id)) {
                        firedThisCall.add(id);
                        recordLessonHit(wolfDir, id, trimmed);
                    }
                    process.stderr.write(`⚠️ OpenWolf cerebrum warning: "${trimmed}" — check your code before proceeding.\n`);
                }
            }
            catch { }
        }
    }
}
/**
 * Increment hit counter for a lesson in cerebrum-stats.json sidecar.
 * Silent no-op on error — must never block the hook. Uses a file lock so
 * concurrent pre-write hooks (Claude Code can dispatch parallel Edit/Write
 * tool calls) cannot lose increments via read-modify-write races.
 */
function recordLessonHit(wolfDir, id, lessonText) {
    try {
        const statsPath = path.join(wolfDir, "cerebrum-stats.json");
        const release = acquireFileLock(statsPath);
        if (!release)
            return; // Couldn't acquire lock — drop this increment.
        try {
            // Re-read AFTER lock acquisition so we see any concurrent writes.
            const stats = readJSON(statsPath, { version: 1, lessons: {} });
            if (!stats.lessons)
                stats.lessons = {};
            const now = new Date().toISOString();
            const existing = stats.lessons[id];
            if (existing) {
                existing.hits++;
                existing.last_hit = now;
                existing.text = lessonText.slice(0, 120);
            }
            else {
                stats.lessons[id] = {
                    text: lessonText.slice(0, 120),
                    hits: 1,
                    first_hit: now,
                    last_hit: now,
                };
            }
            atomicWriteJson(statsPath, stats);
        }
        finally {
            release();
        }
    }
    catch { }
}
// Common words that appear in most code — must be excluded from similarity matching
const STOP_WORDS = new Set([
    "error", "function", "return", "const", "this", "that", "with", "from",
    "import", "export", "class", "interface", "type", "undefined", "null",
    "true", "false", "string", "number", "object", "array", "value",
    "file", "path", "name", "data", "response", "request", "result",
    "should", "must", "does", "have", "been", "will", "would", "could",
    "when", "then", "else", "each", "some", "every", "only",
]);
function checkBugLog(wolfDir, filePath, oldStr, newStr, content) {
    const bugLogPath = path.join(wolfDir, "buglog.json");
    if (!fs.existsSync(bugLogPath))
        return;
    const bugLog = readJSON(bugLogPath, { version: 1, bugs: [] });
    if (bugLog.bugs.length === 0)
        return;
    const basename = path.basename(filePath);
    const projectRoot = path.dirname(wolfDir);
    const targetPath = path.resolve(projectRoot, filePath);
    // ONLY surface bugs that match the SAME file being edited.
    // Cross-file matching is too noisy and risks misdirecting Claude.
    const fileMatches = bugLog.bugs.filter(b => {
        return typeof b.file === "string" && b.file.trim().length > 0
            && path.resolve(projectRoot, b.file) === targetPath;
    });
    if (fileMatches.length === 0)
        return;
    // Further filter: require tag or error_message overlap with the edit content
    const editText = (oldStr + " " + newStr + " " + content).toLowerCase();
    const editTokens = tokenize(editText);
    const relevant = fileMatches.filter(bug => {
        // Check if any bug tag appears in the edit content
        const tagHit = bug.tags.some(t => editText.includes(t.toLowerCase()));
        if (tagHit)
            return true;
        // Check meaningful word overlap (excluding stop words)
        const bugTokens = tokenize(bug.error_message + " " + bug.root_cause);
        const overlap = [...editTokens].filter(t => bugTokens.has(t));
        // Require at least 3 meaningful overlapping words
        return overlap.length >= 3;
    });
    if (relevant.length === 0)
        return;
    // Surface as a FYI, not a directive — Claude should evaluate, not blindly apply
    process.stderr.write(`📋 OpenWolf buglog: ${relevant.length} past bug(s) found for ${basename} — review for context, do NOT apply blindly:\n`);
    for (const bug of relevant.slice(0, 2)) {
        process.stderr.write(`   [${bug.id}] "${bug.error_message.slice(0, 70)}"\n   Cause: ${bug.root_cause.slice(0, 80)}\n   Fix: ${bug.fix.slice(0, 80)}\n`);
    }
}
function tokenize(text) {
    return new Set(text.replace(/[^\w\s]/g, " ").split(/\s+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
        .map(w => w.toLowerCase()));
}
runHook("pre-write", main);
