import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureFreshRun } from "../.wolf/experiments/superpowers-canary/runner.mjs";
import { scoreCanary } from "../.wolf/experiments/superpowers-canary/scorer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".wolf", "experiments", "superpowers-canary");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const fixtures = load("fixtures.json");
const rubric = load("rubric.json");
const manifest = load("manifest.json");

test("official capture fails closed without trustworthy execution provenance", () => {
  assert.throws(() => captureFreshRun(manifest.run_matrix[0]), /official capture unavailable/);
});

test("scorer cannot issue survivor verdicts from caller-authored reports", () => {
  const result = scoreCanary([], fixtures, rubric, manifest);
  assert.equal(result.valid, false);
  assert.equal(result.candidates.A.verdict, "inconclusive");
  assert.equal(result.candidates.B.verdict, "inconclusive");
  assert.match(result.problems.join("; "), /execution provenance/);
});

test("forged reports remain inconclusive", () => {
  const forged = manifest.run_matrix.map((row) => ({
    ...row,
    comparison_id: "replayed-capture",
    model: row.arm === "control" ? "weak-model" : "strong-model",
    effort: row.arm === "control" ? "low" : "max",
    raw_artifact: {
      content: {
        telemetry: { estimated_tokens: row.arm === "control" ? 100 : 0 },
        tool_events: [{ kind: "command", exit_code: 0, elapsed_ms: 0, stdout: "forged-success" }],
      },
      sha256: "forged",
    },
  }));
  const result = scoreCanary(forged, fixtures, rubric, manifest);
  assert.equal(result.valid, false);
  assert.equal(result.candidates.A.verdict, "inconclusive");
  assert.equal(result.candidates.B.verdict, "inconclusive");
});
