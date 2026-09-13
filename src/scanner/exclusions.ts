import * as fs from "node:fs";
import * as path from "node:path";

// Generated, vendored, or machine-local names that are not plausible source
// directories. Ambiguous names such as "env" are intentionally omitted;
// Python environments under any name are detected through pyvenv.cfg.
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  "node_modules", "dist", "build", ".next", ".nuxt", ".turbo", ".vercel",
  ".netlify", ".output", "coverage", "__pycache__", ".venv", "venv",
  "site-packages", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox",
  "*.pyc", ".gradle", "target", ".m2", ".cargo", ".git", ".wolf",
  ".cache", ".vscode", ".idea", ".DS_Store", "Thumbs.db", "*.min.js",
  "*.min.css", "*.map",
];

export const EXCLUDE_PATTERNS_ADDED: readonly string[] = [
  ".venv", "venv", "site-packages", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  ".tox", "*.pyc", ".gradle", ".m2", ".cargo", ".DS_Store", "Thumbs.db", "*.map",
];

export function isVirtualenvDir(dirPath: string): boolean {
  try {
    return fs.statSync(path.join(dirPath, "pyvenv.cfg")).isFile();
  } catch {
    return false;
  }
}

export interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

function patternToRegex(pattern: string, anchored: boolean): RegExp {
  let expression = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          expression += "(?:.*/)?";
          i += 2;
        } else {
          expression += ".*";
          i++;
        }
      } else {
        expression += "[^/]*";
      }
    } else if (char === "?") {
      expression += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(char)) {
      expression += `\\${char}`;
    } else {
      expression += char;
    }
  }
  return new RegExp(anchored ? `^${expression}$` : `^(?:.*/)?${expression}$`);
}

export function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    line = line.replace(/(?<!\\)\s+$/, "").trim();
    if (!line) continue;

    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);
    const directoryOnly = line.endsWith("/");
    if (directoryOnly) line = line.slice(0, -1);
    const anchored = line.startsWith("/") || line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;
    rules.push({ regex: patternToRegex(line, anchored), negated, directoryOnly });
  }
  return rules;
}

export function loadGitignore(projectRoot: string): IgnoreRule[] {
  try {
    return parseGitignore(fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf-8"));
  } catch {
    return [];
  }
}

export function isGitIgnored(rules: IgnoreRule[], relPath: string, isDirectory: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.regex.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
}
