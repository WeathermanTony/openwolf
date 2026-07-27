// @ts-nocheck
/**
 * Conclusion / reduction gate — EVIDENCE-GATED.
 *
 * Previous behavior: match conclusion-like regexes against the assistant's last
 * turn; suppress only if a reduction happened to be written this session, or if
 * the exact normalized TEXT had been seen before. That makes prose the trigger,
 * so summarizing already-reduced work re-fired the gate — the model rephrases,
 * the text hash changes, the gate fires again. Non-convergent by construction.
 *
 * New behavior requires BOTH:
 *   1. conclusion-like content (secondary signal, necessary but not sufficient)
 *   2. deterministic evidence that relevant work is genuinely UNREDUCED
 *
 * "Unreduced" is a hash question, not an intuition:
 *   - a covered file's current content hash no longer matches any reduction's
 *     `target-hash`, OR
 *   - an in-scope code file has no matching reduction at all
 *
 * Corollary — the case that caused the observed waste: if every in-scope edited
 * file's current hash matches a current reduction, the gate stays SILENT no
 * matter how conclusive the prose reads. A recap of reduced work is not a new
 * claim.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { makeCandidate } from "../engine.js";
import { groupByOwner } from "../project-scope.js";
export const RULE_ID = "conclusion.unreduced";
// 3: see cerebrum.ts — fingerprint payload canonicalization/type-tagging bump.
const SCHEMA_VERSION = 3;
/** Read a reduction's frontmatter (capped) and pull every target-hash it declares. */
export function reductionTargetHashes(qaFile) {
    let head = "";
    try {
        const fd = fs.openSync(qaFile, "r");
        try {
            const buf = Buffer.alloc(8192);
            const n = fs.readSync(fd, buf, 0, buf.length, 0);
            head = buf.toString("utf8", 0, n);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return [];
    }
    const end = head.indexOf("\n---", 4);
    const front = end === -1 ? head : head.slice(0, end + 5);
    // Supports both `target-hash:` and the suffixed multi-file form
    // `target-hash-<slug>:` so one reduction can cover several files.
    const re = /^target-hash(?:-[a-zA-Z0-9_-]+)?:\s*["']?([a-f0-9]{16,64})["']?\s*$/gm;
    const out = [];
    let m;
    while ((m = re.exec(front)) !== null)
        out.push(m[1]);
    return out;
}
/** Every target-hash declared by any non-underscore reduction in a qa dir. */
export function collectCoveredHashes(qaDir) {
    const covered = new Set();
    let names;
    try {
        names = fs.readdirSync(qaDir);
    }
    catch {
        return covered;
    }
    for (const name of names) {
        if (!name.endsWith(".md") || name.startsWith("_"))
            continue;
        for (const h of reductionTargetHashes(path.join(qaDir, name)))
            covered.add(h);
    }
    return covered;
}
function hashFile(p) {
    try {
        return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
    catch {
        return null;
    }
}
/**
 * @param text           assistant's last turn
 * @param patterns       conclusion regex sources (config)
 * @param minHits        how many distinct patterns must match
 * @param codeFiles      in-scope edited code files (absolute)
 * @param eventSeq       max session event sequence covered — changes when new work lands
 */
export function collect({ text = "", patterns = [], minHits = 2, minTextChars = 200, codeFiles = [], minAssumptions = 3, eventSeq = null, clock = null, resolver, } = {}) {
    if (!text || text.length < minTextChars)
        return { candidates: [], matched: [] };
    const matched = [];
    for (const src of patterns) {
        try {
            if (new RegExp(src, "i").test(text))
                matched.push(src);
        }
        catch {
            // Bad user-supplied pattern: skip it rather than crash the hook.
        }
    }
    // Signal 1 absent → nothing to do.
    if (matched.length < minHits)
        return { candidates: [], matched };
    // Signal 2: is any in-scope file actually uncovered RIGHT NOW?
    const { owners, unattributed } = groupByOwner(codeFiles, resolver ? { resolver } : {});
    const candidates = [];
    for (const owner of owners.values()) {
        const qaDir = path.join(owner.wolfDir, "qa");
        const covered = collectCoveredHashes(qaDir);
        const uncovered = [];
        const targetHashes = {};
        for (const file of owner.files) {
            const h = hashFile(file);
            if (!h)
                continue; // deleted/unreadable → not a reduction obligation
            targetHashes[file] = h;
            if (!covered.has(h))
                uncovered.push(file);
        }
        // THE CONVERGENCE CASE: prose looks conclusive, but every covered file's
        // current bytes already match a reduction. Stay silent.
        if (uncovered.length === 0)
            continue;
        const shown = uncovered.slice(0, 3).map(f => path.relative(owner.root, f).replace(/\\/g, "/"));
        const more = uncovered.length > 3 ? ` +${uncovered.length - 3} more` : "";
        candidates.push(makeCandidate({
            ruleId: RULE_ID,
            ownerRoot: owner.root,
            severity: "warn",
            confidence: 0.85,
            schemaVersion: SCHEMA_VERSION,
            title: "Conclusion without current reduction",
            reason: `${uncovered.length} edited file(s) lack a current .wolf/qa reduction: ${shown.join(", ")}${more}. Add ≥${minAssumptions} assumptions + the riskiest falsifier's actual output before finalizing.`,
            action: { command: null, label: "Write a reduction" },
            // Fingerprint over the FULL uncovered set + their exact bytes: a new
            // edit changes a hash → new fingerprint → the gate legitimately
            // re-arms (test 8). Rephrasing the recap changes nothing (test 7).
            targetHashes,
            eventSequence: eventSeq,
            evidence: {
                owner_root: owner.root,
                uncovered_files: uncovered,
                uncovered_count: uncovered.length,
                patterns_matched: matched.length,
                min_assumptions: minAssumptions,
                qa_dir: path.relative(owner.root, qaDir).replace(/\\/g, "/"),
            },
            clock,
        }));
    }
    return { candidates, matched, unattributed };
}
//# sourceMappingURL=conclusion.js.map