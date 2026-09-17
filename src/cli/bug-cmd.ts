import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { searchBugs, closeBug } from "../buglog/bug-tracker.js";

export function bugSearch(term: string): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  const results = searchBugs(wolfDir, term);

  if (results.length === 0) {
    console.log(`No bugs found matching "${term}".`);
    return;
  }

  console.log(`Found ${results.length} matching bug(s):\n`);

  for (const bug of results) {
    console.log(`  [${bug.id}] ${bug.error_message.slice(0, 80)}`);
    console.log(`    File: ${bug.file}${bug.line ? `:${bug.line}` : ""}`);
    console.log(`    Root cause: ${bug.root_cause}`);
    console.log(`    Fix: ${bug.fix}`);
    console.log(`    Tags: ${bug.tags.join(", ")}`);
    console.log(`    Occurrences: ${bug.occurrences} | Last seen: ${bug.last_seen}`);
    console.log("");
  }
}

export function bugClose(
  id: string,
  opts: { commit?: string; reduction?: string; force?: boolean },
): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    process.exitCode = 1;
    return;
  }

  const res = closeBug(wolfDir, id, opts);

  if (res.ok) {
    const e = res.entry!;
    console.log(`Closed ${e.id}: ${e.error_message.slice(0, 70)}`);
    console.log(`  commit:    ${e.commit ?? "(none)"}`);
    console.log(`  reduction: ${e.reduction ?? "(none)"}`);
    if (res.missing) {
      console.log(`  WARNING: forced close with no ${res.missing.join(" or ")}.`);
    }
    return;
  }

  process.exitCode = 1;
  switch (res.reason) {
    case "not-found":
      console.log(`No bug with id "${id}".`);
      break;
    case "missing-proof":
      console.log(`Refusing to close ${id}: missing ${res.missing!.join(" and ")}.`);
      console.log(`  A resolved bug must link to the evidence the fix was real.`);
      console.log(`  Supply it:  openwolf bug close ${id} --commit <sha> --reduction <path>`);
      console.log(`  Or override: openwolf bug close ${id} --force`);
      break;
    case "lock-failed":
      console.log(`Could not lock buglog.json (another process holds it). Retry.`);
      break;
    default:
      console.log(`Failed to write buglog.json.`);
  }
}
