import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export function readJSON<T = unknown>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // On Windows, rename can fail if another process holds a handle.
    // Fall back to direct write and clean up the tmp file.
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function readText(filePath: string, fallback: string = ""): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

export function writeText(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // On Windows, rename can fail if another process holds a handle.
    // Fall back to direct write and clean up the tmp file.
    try { fs.writeFileSync(filePath, content, "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function appendText(filePath: string, content: string): void {
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
export function safeCopyFile(src: string, dest: string): void {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(dest, fs.readFileSync(src));
  try {
    fs.chmodSync(dest, fs.statSync(src).mode);
  } catch {}
}
