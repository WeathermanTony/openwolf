import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readText } from "../utils/fs-safe.js";

interface LintIssue {
  level: "error" | "warning";
  message: string;
}

const REQUIRED_HEADINGS = [
  "## User Preferences",
  "## Key Learnings",
  "## Do-Not-Repeat",
  "## Decision Log",
];

export function lintCerebrum(projectRoot = findProjectRoot()): LintIssue[] {
  const text = readText(path.join(projectRoot, ".wolf", "cerebrum.md"));
  const issues: LintIssue[] = [];
  if (!text.trim()) {
    issues.push({ level: "error", message: "missing or empty .wolf/cerebrum.md" });
    return issues;
  }
  for (const heading of REQUIRED_HEADINGS) {
    if (!text.includes(heading)) issues.push({ level: "error", message: `missing heading: ${heading}` });
  }
  const dnrStart = text.indexOf("## Do-Not-Repeat");
  const decisionStart = text.indexOf("## Decision Log");
  const dnr = dnrStart >= 0 ? text.slice(dnrStart, decisionStart >= 0 ? decisionStart : undefined) : "";
  const dnrLines = dnr.split(/\r?\n/).filter((line) => line.trim().startsWith("-"));
  for (const line of dnrLines) {
    if (!/\[?\d{4}-\d{2}-\d{2}\]?/.test(line)) {
      issues.push({ level: "warning", message: `DNR entry missing date marker: ${line.slice(0, 100)}` });
    }
    if (line.length > 500) {
      issues.push({ level: "warning", message: `DNR entry is very long (${line.length} chars): ${line.slice(0, 100)}` });
    }
  }
  const seen = new Map<string, number>();
  for (const line of dnrLines) {
    const key = line.toLowerCase().replace(/\[?\d{4}-\d{2}-\d{2}\]?/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 5).slice(0, 6).join(" ");
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen.entries()) {
    if (count > 1) issues.push({ level: "warning", message: `possible duplicate DNR cluster: ${key}` });
  }
  return issues;
}

export function cerebrumLint(opts: { check?: boolean; json?: boolean } = {}): void {
  const issues = lintCerebrum();
  if (opts.json) {
    console.log(JSON.stringify({ version: 1, issues }, null, 2));
  } else if (issues.length === 0) {
    console.log("Wolfpack cerebrum lint: no issues found.");
  } else {
    console.log(`Wolfpack cerebrum lint: ${issues.length} issue(s)`);
    for (const issue of issues) console.log(`  ${issue.level.toUpperCase()}: ${issue.message}`);
  }
  if (opts.check && issues.some((issue) => issue.level === "error")) process.exitCode = 1;
}
