import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { findProjectRoot } from "../scanner/project-root.js";

export type QaStatus = "CURRENT" | "STALE" | "ORPHAN" | "BROKEN" | "UNKNOWN";

interface QaReductionStatus {
  path: string;
  status: QaStatus;
  target?: string;
  hashes: string[];
  problems: string[];
}

interface QaStatusReport {
  version: number;
  counts: Record<QaStatus, number>;
  reductions: QaReductionStatus[];
}

function sha256File(file: string): string | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

function readFrontmatter(file: string): string | null {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (!text.startsWith("---\n")) return null;
    const end = text.indexOf("\n---", 4);
    if (end === -1) return null;
    return text.slice(4, end);
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string | null): { target?: string; hashes: string[]; problems: string[] } {
  const out: { target?: string; hashes: string[]; problems: string[] } = { hashes: [], problems: [] };
  if (!raw) {
    out.problems.push("missing frontmatter");
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const target = line.match(/^target:\s*["']?(.+?)["']?\s*$/);
    if (target) out.target = target[1].trim();
    const hash = line.match(/^target-hash(?:-[a-zA-Z0-9_-]+)?:\s*["']?([a-f0-9]{16,64})["']?\s*$/);
    if (hash) out.hashes.push(hash[1]);
  }
  if (out.hashes.length === 0) out.problems.push("missing target-hash");
  return out;
}

function resolveTarget(projectRoot: string, target?: string): string | undefined {
  if (!target) return undefined;
  return path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
}

export function buildQaStatusReport(projectRoot = findProjectRoot()): QaStatusReport {
  const wolfDir = path.join(projectRoot, ".wolf");
  const qaDir = path.join(wolfDir, "qa");
  const counts: Record<QaStatus, number> = { CURRENT: 0, STALE: 0, ORPHAN: 0, BROKEN: 0, UNKNOWN: 0 };
  const reductions: QaReductionStatus[] = [];

  if (!fs.existsSync(wolfDir) || !fs.existsSync(qaDir)) {
    return { version: 1, counts, reductions };
  }

  const names = fs.readdirSync(qaDir).filter((name) => name.endsWith(".md") && !name.startsWith("_")).sort();
  for (const name of names) {
    const full = path.join(qaDir, name);
    const parsed = parseFrontmatter(readFrontmatter(full));
    const targetPath = resolveTarget(projectRoot, parsed.target);
    const problems = [...parsed.problems];
    let status: QaStatus = "UNKNOWN";

    if (problems.length > 0) {
      status = "BROKEN";
    } else if (!targetPath) {
      status = "BROKEN";
      problems.push("missing target");
    } else if (!fs.existsSync(targetPath)) {
      status = "ORPHAN";
      problems.push("target missing");
    } else {
      const currentHash = sha256File(targetPath);
      if (!currentHash) {
        status = "BROKEN";
        problems.push("target unreadable");
      } else if (parsed.hashes.includes(currentHash)) {
        status = "CURRENT";
      } else {
        status = "STALE";
        problems.push(`current hash ${currentHash} not in target-hash frontmatter`);
      }
    }

    counts[status]++;
    reductions.push({ path: path.relative(projectRoot, full).replace(/\\/g, "/"), status, target: parsed.target, hashes: parsed.hashes, problems });
  }

  return { version: 1, counts, reductions };
}

export function qaStatus(opts: { check?: boolean; json?: boolean } = {}): void {
  const report = buildQaStatusReport();
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Wolfpack QA reductions");
    console.log(`  CURRENT: ${report.counts.CURRENT}`);
    console.log(`  STALE:   ${report.counts.STALE}`);
    console.log(`  ORPHAN:  ${report.counts.ORPHAN}`);
    console.log(`  BROKEN:  ${report.counts.BROKEN}`);
    console.log(`  UNKNOWN: ${report.counts.UNKNOWN}`);
    for (const reduction of report.reductions.filter((r) => r.status !== "CURRENT")) {
      console.log(`  ${reduction.status} ${reduction.path}${reduction.problems.length ? ` — ${reduction.problems.join("; ")}` : ""}`);
    }
  }
  if (opts.check && (report.counts.STALE > 0 || report.counts.ORPHAN > 0 || report.counts.BROKEN > 0)) {
    process.exitCode = 1;
  }
}
