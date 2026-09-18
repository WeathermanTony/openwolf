// @ts-nocheck
/**
 * Project ownership resolution.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Rules that combine session-wide activity (`session.files_written`) with a
 * project-LOCAL `.wolf/` file silently assumed the driving project owned every
 * write. In the measured failure, all six writes belonged to project
 * `aistatistical`, but the cerebrum rule read `CLIProxyAPI/.wolf/cerebrum.md`
 * and produced a 45.8-hour-stale warning about the wrong project — while the
 * owning project's cerebrum had just been updated.
 *
 * Ownership must come from the EVIDENCE (where the file actually lives), never
 * from CLAUDE_PROJECT_DIR, cwd, or the hook's own wolfDir.
 *
 * AMBIGUITY POLICY
 * ----------------
 * When a file has no resolvable owner, we do NOT fall back to the driving
 * project. A false negative on a low-severity reminder is strictly better than
 * confidently telling the user to update the wrong project's cerebrum. Callers
 * receive the unattributed files separately and log the ambiguity.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalPath } from "./state.js";
/**
 * Walk from a file toward the filesystem root, returning the nearest project
 * root that carries a WolfPack marker.
 *
 * Marker precedence (strongest first):
 *   1. `.wolf/config.json` — canonical, unambiguous WolfPack project
 *   2. `.wolf/`            — a WolfPack project mid-initialization
 *
 * Repository root (`.git`) is deliberately NOT a fallback marker: a git repo
 * without `.wolf/` is not a WolfPack project, and treating it as one recreates
 * the misattribution class this module exists to prevent.
 *
 * Returns null when no marker is found — callers must handle that, not guess.
 */
export function resolveOwningProject(filePath, { maxDepth = 64 } = {}) {
    if (!filePath)
        return null;
    let dir;
    try {
        dir = path.dirname(path.resolve(filePath));
    }
    catch {
        return null;
    }
    let best = null;
    for (let i = 0; i < maxDepth; i++) {
        const wolf = path.join(dir, ".wolf");
        try {
            if (fs.statSync(wolf).isDirectory()) {
                // Prefer a root whose .wolf carries config.json, but a bare
                // .wolf/ still counts. Because we walk child → parent, the FIRST
                // hit is the nearest and therefore the correct owner: a nested
                // project must win over its parent.
                const strong = fs.existsSync(path.join(wolf, "config.json"));
                best = { root: canonicalPath(dir), wolfDir: canonicalPath(wolf), strong };
                break;
            }
        }
        catch { }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return best;
}
/**
 * Group a list of file paths by owning project.
 *
 * Returns:
 *   owners       — Map<rootPath, {root, wolfDir, files: string[]}>
 *   unattributed — files with no resolvable WolfPack owner
 *
 * Note the ordering guarantee: `files` within each owner is sorted, so a
 * fingerprint computed over a group is independent of write order.
 */
export function groupByOwner(files, { resolver = resolveOwningProject } = {}) {
    const owners = new Map();
    const unattributed = [];
    for (const file of files || []) {
        const owner = resolver(file);
        if (!owner) {
            unattributed.push(file);
            continue;
        }
        let entry = owners.get(owner.root);
        if (!entry) {
            entry = { root: owner.root, wolfDir: owner.wolfDir, strong: owner.strong, files: [] };
            owners.set(owner.root, entry);
        }
        entry.files.push(file);
    }
    for (const entry of owners.values()) {
        entry.files.sort();
    }
    return { owners, unattributed };
}
/**
 * Does `filePath` live inside `root`? Used to decide whether a session write is
 * project-local without re-walking the tree.
 */
export function isUnderRoot(filePath, root) {
    const f = canonicalPath(filePath);
    const r = canonicalPath(root);
    return f === r || f.startsWith(r.endsWith("/") ? r : r + "/");
}
//# sourceMappingURL=project-scope.js.map