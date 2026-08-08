import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, readText } from "../utils/fs-safe.js";
import { normalizeFilePath } from "../hooks/shared.js";

function wolfDir(projectRoot = findProjectRoot()): string {
  return path.join(projectRoot, ".wolf");
}

function includesText(value: unknown, needle: string): boolean {
  return JSON.stringify(value ?? "").toLowerCase().includes(needle.toLowerCase());
}

export function traceCommand(target: string, opts: { json?: boolean } = {}): void {
  const projectRoot = findProjectRoot();
  const dir = wolfDir(projectRoot);
  const buglog = readJSON<{ bugs?: any[] }>(path.join(dir, "buglog.json"), { bugs: [] });
  const reviewlog = readJSON<{ reviews?: any[] }>(path.join(dir, "reviewlog.json"), { reviews: [] });
  const qaDir = path.join(dir, "qa");
  const cerebrum = readText(path.join(dir, "cerebrum.md"));
  const experimentsDir = path.join(dir, "experiments");
  const experiments = fs.existsSync(experimentsDir)
    ? fs.readdirSync(experimentsDir).filter((file) => file.endsWith(".json")).flatMap((file) => {
        try { return [JSON.parse(fs.readFileSync(path.join(experimentsDir, file), "utf8"))]; }
        catch { return [{ id: file.slice(0, -5), malformed: true }]; }
      })
    : [];
  const bugs = Array.isArray(buglog.bugs) ? buglog.bugs : [];
  const reviews = Array.isArray(reviewlog.reviews) ? reviewlog.reviews : [];
  const qaFiles = fs.existsSync(qaDir) ? fs.readdirSync(qaDir).filter((f) => f.endsWith(".md") && !f.startsWith("_")) : [];
  const normalizedTarget = normalizeFilePath(path.resolve(target));
  const basename = path.basename(target);
  const isBug = /^bug-\d+$/i.test(target);
  const isReview = /^review-\d+$/i.test(target);

  const matchingBugs = bugs.filter((b) => isBug ? b.id === target : includesText(b, target) || includesText(b, normalizedTarget) || includesText(b, basename));
  const matchingReviews = reviews.filter((r) => isReview ? r.id === target : includesText(r, target) || includesText(r, normalizedTarget) || includesText(r, basename));
  const result = {
    target,
    ambiguous: {
      bug_id: isBug && matchingBugs.length > 1,
      review_id: isReview && matchingReviews.length > 1,
    },
    bugs: matchingBugs.map((bug, index) => ({ ...bug, trace_match_index: index, ambiguous_id: isBug && matchingBugs.length > 1 })),
    reviews: matchingReviews.map((review, index) => ({ ...review, trace_match_index: index, ambiguous_id: isReview && matchingReviews.length > 1 })),
    experiments: experiments.filter((e) => e.id === target || includesText(e, target) || includesText(e, normalizedTarget) || includesText(e, basename)),
    qa: [] as Array<{ path: string; matches: string[] }>,
    cerebrum: [] as string[],
  };

  for (const file of qaFiles) {
    const rel = path.join(".wolf", "qa", file).replace(/\\/g, "/");
    const text = readText(path.join(qaDir, file));
    const matches = [];
    if (text.includes(target)) matches.push("target");
    if (basename && text.includes(basename)) matches.push("basename");
    if (matches.length > 0) result.qa.push({ path: rel, matches });
  }

  result.cerebrum = cerebrum.split(/\r?\n/).filter((line) => line.includes(target) || (basename && line.includes(basename))).slice(0, 20);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Wolfpack trace: ${target}`);
  if (result.ambiguous.bug_id || result.ambiguous.review_id) {
    console.log("  Ambiguous durable ID: all matching records are shown; repair before mutation.");
  }
  console.log(`  Bugs: ${result.bugs.length}`);
  for (const bug of result.bugs.slice(0, 10)) console.log(`    ${bug.id}: ${String(bug.error_message ?? "").slice(0, 100)}`);
  console.log(`  Reviews: ${result.reviews.length}`);
  for (const review of result.reviews.slice(0, 10)) console.log(`    ${review.id}: ${review.status ?? "unknown"}`);
  console.log(`  Experiments: ${result.experiments.length}`);
  for (const experiment of result.experiments.slice(0, 10)) console.log(`    ${experiment.id}: ${experiment.status ?? "malformed"}`);
  console.log(`  QA reductions: ${result.qa.length}`);
  for (const qa of result.qa.slice(0, 10)) console.log(`    ${qa.path}`);
  console.log(`  Cerebrum lines: ${result.cerebrum.length}`);
  for (const line of result.cerebrum.slice(0, 10)) console.log(`    ${line}`);
}
