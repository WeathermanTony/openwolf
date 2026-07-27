import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
export function readJSON(filePath, fallback) {
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
export function tryWriteJSON(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(tmp, filePath);
        return true;
    }
    catch {
        // On Windows, rename can fail if another process holds a handle.
        // Fall back to direct write and clean up the tmp file.
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
            return true;
        }
        catch { }
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        return false;
    }
}
export function writeJSON(filePath, data) {
    void tryWriteJSON(filePath, data);
}
export function readText(filePath, fallback = "") {
    try {
        return fs.readFileSync(filePath, "utf-8");
    }
    catch {
        return fallback;
    }
}
export function tryWriteText(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(tmp, content, "utf-8");
        fs.renameSync(tmp, filePath);
        return true;
    }
    catch {
        // On Windows, rename can fail if another process holds a handle.
        // Fall back to direct write and clean up the tmp file.
        try {
            fs.writeFileSync(filePath, content, "utf-8");
            return true;
        }
        catch { }
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
        return false;
    }
}
export function writeText(filePath, content) {
    void tryWriteText(filePath, content);
}
export function appendText(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, content, "utf-8");
}
// Drop-in replacement for fs.copyFileSync that works around a libuv/9P
// limitation: fs.copyFileSync uses the copy_file_range syscall on Linux,
// which fails with EPERM when writing to EFS-encrypted directories on
// Windows volumes mounted via WSL2 9P. Plain read+write bypasses
// copy_file_range and works in all cases.
export function safeCopyFile(src, dest) {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dest, fs.readFileSync(src));
    try {
        fs.chmodSync(dest, fs.statSync(src).mode);
    }
    catch { }
}
// Recursively copy a directory tree via safeCopyFile.
//
// Deliberately NOT fs.cpSync: that hits the same copy_file_range EPERM on
// WSL2 9P mounts that safeCopyFile exists to work around.
//
// Motivation: hook scripts are copied into `.wolf/hooks/` by an explicit flat
// allowlist, which silently skipped nested module trees. `stop.js` imports
// `./nudges/engine.js`, so a project got the importer without the imports and
// the Stop hook died with ERR_MODULE_NOT_FOUND — invisibly, because the hook
// wrapper swallows errors. Any nested runtime dependency must be copied as a
// tree, not enumerated file-by-file.
//
// Returns the number of files copied so callers can verify a non-empty result
// rather than assuming success.
export function safeCopyDir(srcDir, destDir, filter = (name) => name.endsWith(".js")) {
    if (!fs.existsSync(srcDir))
        return 0;
    let copied = 0;
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const from = path.join(srcDir, entry.name);
        const to = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copied += safeCopyDir(from, to, filter);
        }
        else if (entry.isFile() && filter(entry.name)) {
            safeCopyFile(from, to);
            copied++;
        }
    }
    return copied;
}
//# sourceMappingURL=fs-safe.js.map