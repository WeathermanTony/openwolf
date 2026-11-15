import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Session shims (for example wmux's) wrap `claude` for interactive use and
// may not work outside that session, so a scheduled job must not bake them in.
const SHIM_DIR = /[\\/]wmux-shim[\\/]/;

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Find the Claude Code CLI. Cron runs with PATH=/usr/bin:/bin, where a bare
 * `claude` fails with ENOENT, so callers that may run under cron need an
 * absolute path. Order: OPENWOLF_CLAUDE_BIN, the first non-shim `claude` on
 * PATH, ~/.local/bin/claude (the native installer's stable symlink), then the
 * bare name as a last resort. Symlinks are kept, not resolved, so a version
 * upgrade that repoints ~/.local/bin/claude keeps working.
 */
export function resolveClaudeBin(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const explicit = env.OPENWOLF_CLAUDE_BIN;
  if (explicit) return explicit;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir) || SHIM_DIR.test(dir + path.sep)) continue;
    const candidate = path.join(dir, "claude");
    if (isExecutableFile(candidate)) return candidate;
  }
  const fallback = path.join(home, ".local", "bin", "claude");
  return isExecutableFile(fallback) ? fallback : "claude";
}

/** One line for weekly.log, so a quiet scheduled failure is never silent. */
export function quietFailureLine(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${new Date().toISOString()} ${label} update failed: ${message.replace(/\s+/g, " ").trim().slice(0, 500)}`;
}
