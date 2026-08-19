import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";

export type DriftKind = "anatomy-missing" | "command-missing" | "uq-orphan-marker" | "uq-orphan-entry";

export interface DriftFinding {
  kind: DriftKind;
  detail: string;
  source: string;
}

export interface DriftCheckReport {
  version: number;
  root: string;
  checks: Record<string, { extracted: number; checked: number; findings: number; skipped?: string }>;
  findings: DriftFinding[];
  vacuous: string[];
}

const ANATOMY_HEADING = /^##\s+(.+?)\s*$/;
// Auto-maintained anatomies use `- \`name\``; hand-written ones use `- **name**`.
// Supporting only one format makes the check silently blind to the other — the
// vacuity guard catches it, but a blind check is still a check that cannot fail.
const ANATOMY_ENTRY = /^-\s+(?:`([^`]+)`|\*\*([^*]+)\*\*)/;
/** `openwolf foo`, `wolfpack foo bar` — captures the first subcommand token only. */
const CLI_MENTION = /`(?:openwolf|wolfpack)\s+([a-z][a-z0-9-]*)(?:\s+[a-z][a-z0-9-]*)?[^`]*`/g;
const UQ_MARKER = /TODO\(UQ-(\d+)\)/g;
const UQ_ENTRY = /^##\s*UQ-(\d+)\b/gm;

/**
 * Subcommands are read from the CLI source rather than hardcoded, so this check
 * cannot rot in the same way it exists to detect. Returns null when the source
 * is unavailable (installed projects have no src/), which SKIPS the check —
 * never silently passes it.
 */
function knownSubcommands(root: string): Set<string> | null {
  const indexPath = path.join(root, "src", "cli", "index.ts");
  let text: string;
  try {
    text = fs.readFileSync(indexPath, "utf8");
  } catch {
    return null;
  }
  const names = new Set<string>();
  for (const m of text.matchAll(/\.command\(\s*["']([a-z][a-z0-9-]*)/g)) names.add(m[1]);
  return names.size > 0 ? names : null;
}

/**
 * Anatomy headings are usually directory paths ("## src/cli/") but hand-written
 * indexes use prose ("## Top level", "## Reference material"). Treating prose as
 * a directory makes every entry beneath it report missing — a false-positive
 * storm indistinguishable from real drift. Prose headings resolve to the root.
 */
function sectionDir(section: string, root: string): string | null {
  const s = section.trim();
  if (s === "" || s === "." || s === "./") return root;
  // A path-like heading contains a separator or looks like a bare dir/file name
  // with no spaces. Anything with whitespace is prose.
  if (/\s/.test(s)) return root;
  return path.resolve(root, path.normalize(s));
}

/**
 * Anatomy entries sometimes use brace notation for sibling files
 * ("koch_1904_{wikipedia,mactutor}.txt"). Expand so each concrete name is
 * checked; an unexpanded literal never exists on disk and reports as drift.
 */
function expandBraces(name: string): string[] {
  const m = /^(.*?)\{([^{}]*)\}(.*)$/.exec(name);
  if (!m) return [name];
  const parts = m[2].split(",");
  return parts.flatMap((p) => expandBraces(`${m[1]}${p.trim()}${m[3]}`));
}

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Bounded source walk. A session-end check that hangs does not get run, so the
 * walk is capped — but a silent cap would understate marker coverage, so the
 * caller is told when the cap was hit (see `truncated`) and reports it rather
 * than passing on a partial scan.
 */
const MAX_WALK_FILES = 20000;

function listCodeFiles(root: string, wolfDir: string): { files: string[]; truncated: boolean } {
  const out: string[] = [];
  let truncated = false;
  const skip = new Set(["node_modules", ".git", "dist", "build", "coverage", ".wolf", ".next", "out"]);
  const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".sh", ".sql", ".rb", ".java"]);
  const MAX_DEPTH = 8;
  const walk = (dir: string, depth: number): void => {
    if (truncated) return;
    if (depth > MAX_DEPTH) {
      // Depth truncation is a coverage gap like the file cap — report it, do
      // not quietly return a partial file list.
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Dot-directories are skipped entirely; markers live in source, not in
      // .git/.venv/.wolf. (.wolf is also excluded explicitly below.)
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name) || full === wolfDir) continue;
        walk(full, depth + 1);
      } else if (exts.has(path.extname(e.name))) {
        out.push(full);
        if (out.length >= MAX_WALK_FILES) {
          truncated = true;
          return;
        }
      }
    }
  };
  walk(root, 0);
  return { files: out, truncated };
}

export function buildDriftReport(from?: string): DriftCheckReport {
  const root = findProjectRoot(from);
  const wolfDir = path.join(root, ".wolf");
  const findings: DriftFinding[] = [];
  const checks: DriftCheckReport["checks"] = {};
  const vacuous: string[] = [];

  // --- anatomy entries resolve to real files -------------------------------
  const anatomyPath = path.join(wolfDir, "anatomy.md");
  const anatomy = readIfExists(anatomyPath);
  if (anatomy === null) {
    checks.anatomy = { extracted: 0, checked: 0, findings: 0, skipped: "anatomy.md not found" };
  } else {
    let section: string | null = null;
    let extracted = 0;
    let checked = 0;
    for (const line of anatomy.split("\n")) {
      const h = ANATOMY_HEADING.exec(line);
      if (h) {
        section = h[1];
        continue;
      }
      const e = ANATOMY_ENTRY.exec(line);
      if (!e) continue;
      const name = e[1] ?? e[2];
      // Count BEFORE resolving. An entry with no enclosing heading cannot be
      // resolved, but dropping it here would shrink the denominator invisibly —
      // the same vacuity trap this command exists to detect. Count it, then
      // report it as unresolvable.
      extracted += 1;
      checked += 1;
      if (section === null) {
        findings.push({ kind: "anatomy-missing", detail: `${name} (entry precedes any section heading)`, source: ".wolf/anatomy.md" });
        continue;
      }
      // Anatomy section headings are PROJECT-ROOT-relative ("## src/cli/"),
      // not .wolf-relative. Resolving against wolfDir marks nearly every real
      // file missing — a false-positive storm that reads as catastrophic drift.
      const base = sectionDir(section, root);
      const variants = expandBraces(name);
      // An entry may be a bare name relative to its heading ("index.ts" under
      // "## src/cli/") OR already project-root-relative and carrying the same
      // prefix (".wolf/qa/x.md" under "## .wolf/qa/"). Joining unconditionally
      // doubles the prefix and reports existing files as missing. Accept either
      // resolution; only an entry that satisfies neither is drift.
      const resolves = (v: string): boolean => {
        const norm = path.normalize(v);
        if (fs.existsSync(path.resolve(base ?? root, norm))) return true;
        return fs.existsSync(path.resolve(root, norm));
      };
      // Every brace variant must exist; report the entry once if any is absent.
      const absent = variants.filter((v) => !resolves(v));
      if (absent.length > 0) {
        const rel = path.normalize(path.join(section, name));
        findings.push({ kind: "anatomy-missing", detail: rel, source: ".wolf/anatomy.md" });
      }
    }
    checks.anatomy = { extracted, checked, findings: findings.filter((f) => f.kind === "anatomy-missing").length };
    // Vacuity guard (bug-066/-691/-692/-693): a check that extracted nothing
    // from a non-empty source examined nothing, and must not read as a pass.
    if (extracted === 0 && anatomy.trim().length > 0) vacuous.push("anatomy: 0 entries extracted from a non-empty anatomy.md");
    if (extracted !== checked) vacuous.push(`anatomy: extracted ${extracted} but checked ${checked}`);
  }

  // --- CLI subcommands quoted in docs still exist --------------------------
  const known = knownSubcommands(root);
  const docs = ["OPENWOLF.md", "cerebrum.md"].map((f) => path.join(wolfDir, f));
  const claudeMd = path.join(root, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) docs.push(claudeMd);
  if (known === null) {
    checks.commands = { extracted: 0, checked: 0, findings: 0, skipped: "CLI source not present (installed project)" };
  } else {
    let extracted = 0;
    let checked = 0;
    const seen = new Set<string>();
    for (const doc of docs) {
      const text = readIfExists(doc);
      if (text === null) continue;
      for (const m of text.matchAll(CLI_MENTION)) {
        extracted += 1;
        const name = m[1];
        const key = `${doc}::${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checked += 1;
        if (!known.has(name)) {
          findings.push({ kind: "command-missing", detail: name, source: path.relative(root, doc) });
        }
      }
    }
    checks.commands = { extracted, checked, findings: findings.filter((f) => f.kind === "command-missing").length };
    if (extracted === 0) vacuous.push("commands: 0 CLI mentions extracted — pattern may have rotted");
  }

  // --- parked-question markers and ledger entries agree --------------------
  const parkedPath = path.join(wolfDir, "parked-questions.md");
  const parked = readIfExists(parkedPath);
  const markerIds = new Set<string>();
  let markerSites = 0;
  // The source walk is the expensive half of this command (tens of seconds on
  // dependency-heavy trees). Parked questions are rare by design, so when no
  // ledger exists the walk's ONLY purpose is finding an orphan marker — a
  // marker referencing a ledger that was never created. That is worth catching,
  // but not at 30s per session, so the no-ledger case reports honestly that
  // marker discovery was not performed rather than implying a clean scan.
  const walked =
    parked === null
      ? { files: [] as string[], truncated: false, skippedWalk: true }
      : { ...listCodeFiles(root, wolfDir), skippedWalk: false };
  if (walked.truncated) {
    vacuous.push(`parked: source walk truncated (${MAX_WALK_FILES}-file cap or depth limit) — marker coverage is partial`);
  }
  for (const file of walked.files) {
    const text = readIfExists(file);
    if (text === null) continue;
    for (const m of text.matchAll(UQ_MARKER)) {
      markerSites += 1;
      markerIds.add(m[1]);
    }
  }
  const entryIds = new Set<string>();
  if (parked !== null) for (const m of parked.matchAll(UQ_ENTRY)) entryIds.add(m[1]);

  if (parked === null) {
    checks.parked = {
      extracted: 0,
      checked: 0,
      findings: 0,
      skipped: "no parked-questions ledger — code not scanned for orphan TODO(UQ-n) markers",
    };
  } else {
    for (const id of markerIds) {
      if (!entryIds.has(id)) {
        findings.push({ kind: "uq-orphan-marker", detail: `UQ-${id} marked in code but absent from ledger`, source: ".wolf/parked-questions.md" });
      }
    }
    for (const id of entryIds) {
      if (!markerIds.has(id)) {
        findings.push({ kind: "uq-orphan-entry", detail: `UQ-${id} in ledger but no TODO(UQ-${id}) marker in code`, source: ".wolf/parked-questions.md" });
      }
    }
    const total = markerIds.size + entryIds.size;
    checks.parked = {
      extracted: total,
      checked: total,
      findings: findings.filter((f) => f.kind === "uq-orphan-marker" || f.kind === "uq-orphan-entry").length,
    };
    if (parked !== null && parked.trim().length > 0 && entryIds.size === 0) {
      vacuous.push("parked: non-empty parked-questions.md yielded 0 UQ entries");
    }
    if (markerSites > 0 && markerIds.size === 0) vacuous.push("parked: marker sites found but 0 ids extracted");
  }

  return { version: 1, root, checks, findings, vacuous };
}

export function driftCheck(opts: { check?: boolean; json?: boolean } = {}): void {
  const report = buildDriftReport();

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Wolfpack drift check");
    for (const [name, c] of Object.entries(report.checks)) {
      if (c.skipped) {
        console.log(`  ${name.padEnd(9)} SKIPPED — ${c.skipped}`);
      } else {
        console.log(`  ${name.padEnd(9)} extracted=${c.extracted} checked=${c.checked} findings=${c.findings}`);
      }
    }
    for (const f of report.findings) console.log(`  DRIFT [${f.kind}] ${f.detail} (${f.source})`);
    for (const v of report.vacuous) console.log(`  VACUOUS ${v}`);
    if (report.findings.length === 0 && report.vacuous.length === 0) console.log("  no drift detected");
  }

  // A vacuous check is a failure, not a pass: it means the checker examined
  // nothing and cannot have failed for the reason it exists.
  if (opts.check && (report.findings.length > 0 || report.vacuous.length > 0)) {
    process.exitCode = 1;
  }
}
