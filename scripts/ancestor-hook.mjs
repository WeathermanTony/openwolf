#!/usr/bin/env node
// WolfPack ancestor hook loader.
//
// Claude Code reads hook settings only from the folder a session starts in, so
// a session started in a subfolder of a WolfPack project (for example
// aiforwork/zoomphones) runs no WolfPack hooks at all. This loader is
// registered once at user scope. For each hook event it:
//   1. does nothing if the session folder has its own .wolf/ (its project
//      hooks already run; the settings command also checks this before node
//      starts, so this is a second guard);
//   2. walks up to the NEAREST ancestor with a .wolf/ folder;
//   3. runs that ancestor's hook only if its .wolf/config.json sets
//      openwolf.behavior.cover_subfolders to true. The nearest .wolf/ decides:
//      a closer project that has not opted in stops the walk, so a broad
//      parent like projects/.wolf is never picked by accident;
//   4. runs it only if that ancestor is listed in the user-owned allowlist
//      ~/.openwolf/ancestor-roots.json ({"roots": ["/abs/path", ...]}).
//      This loader fires in every session, so without the allowlist any
//      downloaded folder with an opted-in .wolf/ could run code without
//      Claude Code's project trust prompt. Owner/mode checks are no substitute:
//      on WSL drvfs (/mnt/<drive>) every file reports mode 0777.
//
// Usage: node ancestor-hook.mjs <hook-name>   (session-start, pre-read, ...)
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOKS = new Set(["session-start", "pre-read", "pre-write", "post-read", "post-write", "stop"]);

function realOrNull(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return null;
    }
}

export function loadTrustedRoots(home = os.homedir()) {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(home, ".openwolf", "ancestor-roots.json"), "utf-8"));
        const roots = Array.isArray(data?.roots) ? data.roots : [];
        return new Set(roots.filter((r) => typeof r === "string" && path.isAbsolute(r)).map(realOrNull).filter(Boolean));
    }
    catch {
        return new Set();
    }
}

export function findCoveringAncestor(startDir, trustedRoots = loadTrustedRoots()) {
    let dir = path.resolve(startDir);
    if (fs.existsSync(path.join(dir, ".wolf")))
        return null;
    for (;;) {
        const parent = path.dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
        const wolfDir = path.join(dir, ".wolf");
        if (!fs.existsSync(wolfDir))
            continue;
        try {
            const cfg = JSON.parse(fs.readFileSync(path.join(wolfDir, "config.json"), "utf-8"));
            if (cfg?.openwolf?.behavior?.cover_subfolders !== true)
                return null;
            const real = realOrNull(dir);
            return real && trustedRoots.has(real) ? dir : null;
        }
        catch {
            return null;
        }
    }
}

async function main() {
    const hook = process.argv[2];
    if (!HOOKS.has(hook))
        return;
    const sessionDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const root = findCoveringAncestor(sessionDir);
    if (!root)
        return;
    const hookFile = path.join(root, ".wolf", "hooks", `${hook}.js`);
    if (!fs.existsSync(hookFile))
        return;
    // Hooks resolve .wolf/ from CLAUDE_PROJECT_DIR (shared getWolfDir).
    process.env.CLAUDE_PROJECT_DIR = root;
    process.env.WOLFPACK_ANCESTOR_SESSION_DIR = sessionDir;
    await import(pathToFileURL(hookFile).href);
}

function isMainModule() {
    if (!process.argv[1])
        return false;
    try {
        return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (isMainModule()) {
    main().catch((e) => console.error("WolfPack ancestor hook failed:", e?.message ?? e));
}
