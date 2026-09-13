import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("live buglog plus rolling archives retain every committed bug ID", () => {
  const result = spawnSync("git", ["show", "HEAD:.wolf/buglog.json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const baseline = JSON.parse(result.stdout).bugs;
  const live = JSON.parse(fs.readFileSync(path.join(repoRoot, ".wolf", "buglog.json"), "utf8")).bugs;
  const retained = [...live];
  const archiveDir = path.join(repoRoot, ".wolf", "archive");
  if (fs.existsSync(archiveDir)) {
    for (const name of fs.readdirSync(archiveDir).filter(name => /^buglog-.*\.json$/.test(name))) {
      const archived = JSON.parse(fs.readFileSync(path.join(archiveDir, name), "utf8"));
      if (Array.isArray(archived.bugs)) retained.push(...archived.bugs);
    }
  }

  const retainedIds = new Set(retained.map(bug => bug.id));
  const missing = baseline.filter(bug => !retainedIds.has(bug.id));

  assert.ok(baseline.length > 0, "committed buglog baseline must be non-empty");
  assert.equal(missing.length, 0, `live and archived buglogs omitted committed IDs: ${missing.map(bug => bug.id).join(", ")}`);
});
