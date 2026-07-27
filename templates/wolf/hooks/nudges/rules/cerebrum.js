// @ts-nocheck
/**
 * Cerebrum freshness rule — PROJECT-SCOPED.
 *
 * Previous behavior (stop.ts `checkCerebrumFreshness`): stat the DRIVING
 * project's `.wolf/cerebrum.md`, and if it was >24h old while
 * `session.files_written.length >= 3`, nudge. The write list was never checked
 * for ownership. In the measured failure all six writes belonged to project
 * `aistatistical` while the hook read `CLIProxyAPI/.wolf/cerebrum.md` — a
 * 45.8-hour-stale warning about a project the session had not touched, while
 * the project it HAD touched was freshly updated.
 *
 * New behavior: group writes by owning project, then evaluate each owner
 * against ITS OWN cerebrum. A stale project produces a candidate; a fresh one
 * does not; an unattributable file produces nothing at all.
 *
 * FRESHNESS EVIDENCE: content hash captured at session start beats mtime.
 * mtime moves for reasons that are not edits (checkout, touch, sync), and a
 * hook that nags after a `git checkout` teaches the user to ignore it. mtime
 * remains a fallback when no session-start baseline exists.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { makeCandidate } from "../engine.js";
import { groupByOwner } from "../project-scope.js";
export const RULE_ID = "cerebrum.stale";
// 3: fingerprint payload canonicalizes path-like evidence and type-tags target
// hashes; the digest changes, so v2 dispositions no longer apply.
const SCHEMA_VERSION = 3;
function hashFile(p) {
    try {
        return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
    catch {
        return null;
    }
}
/**
 * @param writes           absolute paths written this session
 * @param baselines        { [canonicalCerebrumPath]: sha256 } captured at session start
 * @param minWrites        activity floor before the reminder is worth showing
 * @param staleHours       age threshold
 */
export function collect({ writes = [], baselines = {}, minWrites = 3, staleHours = 24, clock = null, resolver, } = {}) {
    const now = clock && clock.now ? clock.now() : Date.now();
    const { owners, unattributed } = groupByOwner(writes, resolver ? { resolver } : {});
    const candidates = [];
    for (const owner of owners.values()) {
        // Only count activity OWNED BY THIS PROJECT toward its own threshold.
        if (owner.files.length < minWrites)
            continue;
        const cerebrumPath = path.join(owner.wolfDir, "cerebrum.md");
        let stat;
        try {
            stat = fs.statSync(cerebrumPath);
        }
        catch {
            continue; // no cerebrum → nothing to be stale about
        }
        // Did cerebrum change during this session? Content hash first.
        const currentHash = hashFile(cerebrumPath);
        const baselineKey = cerebrumPath.replace(/\\/g, "/");
        const baseline = baselines[baselineKey] ?? baselines[cerebrumPath];
        if (baseline && currentHash && baseline !== currentHash) {
            continue; // updated this session — silent, regardless of mtime
        }
        const hoursSince = (now - stat.mtimeMs) / 3_600_000;
        if (hoursSince <= staleHours)
            continue;
        // No baseline recorded and mtime is recent-ish relative to session
        // start? Fall through on mtime alone (supplementary evidence only).
        const rel = path.relative(owner.root, cerebrumPath).replace(/\\/g, "/") || "cerebrum.md";
        candidates.push(makeCandidate({
            ruleId: RULE_ID,
            ownerRoot: owner.root,
            severity: "info",
            confidence: baseline ? 0.9 : 0.7, // hash-backed evidence is stronger
            schemaVersion: SCHEMA_VERSION,
            title: "Cerebrum not updated",
            reason: `${path.basename(owner.root)}: ${rel} unchanged for ${Math.floor(hoursSince)}h across ${owner.files.length} write(s) — record anything learned.`,
            action: { command: null, label: "Update cerebrum.md" },
            // FULL evidence: every owned file, not the displayed subset.
            targetHashes: { [cerebrumPath]: currentHash || "unreadable" },
            evidence: {
                owner_root: owner.root,
                cerebrum: rel,
                written_files: owner.files,
                write_count: owner.files.length,
                hours_since_update: Math.floor(hoursSince),
                freshness_source: baseline ? "content_hash" : "mtime",
            },
            clock,
        }));
    }
    return { candidates, unattributed };
}
