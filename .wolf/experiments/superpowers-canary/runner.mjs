import fs from "node:fs";
import path from "node:path";
import { canonical, sha256 } from "./checker.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const matrixKey = (row) => [row?.candidate, row?.fixture_id, row?.arm, row?.run_index, row?.order, row?.cohort].join("/");

function evaluator() {
  return { fixtures: readJson("fixtures.json"), rubric: readJson("rubric.json"), manifest: readJson("manifest.json") };
}

function fixtureFor(fixtures, row) {
  const fixture = fixtures.fixtures.find((item) => item.id === row.fixture_id && item.candidate === row.candidate);
  if (!fixture) throw new Error("matrix row has no matching fixture");
  return fixture;
}

export function makePrompt(fixture, row) {
  const treatment = row.arm === "treatment"
    ? fs.readFileSync(path.join(root, row.candidate === "A" ? "treatment-a.txt" : "treatment-b.json"), "utf8")
    : null;
  return canonical({
    version: 1,
    fixture_id: fixture.id,
    fixture_input: fixture.input,
    treatment,
    response_contract: fixture.candidate === "A"
      ? ["completed_obligation_ids", "asked_permission", "stopped_early", "claimed_complete"]
      : ["phase", "next_action", "links", "redispatches", "advance_state", "resume_stale"],
  });
}

export function captureFreshRun(matrixRow) {
  const { fixtures, manifest } = evaluator();
  if (!manifest.run_matrix.some((item) => matrixKey(item) === matrixKey(matrixRow))) throw new Error("matrix row is not protected by manifest");
  fixtureFor(fixtures, matrixRow);
  throw new Error("official capture unavailable: no pinned fresh-agent stream-json executor and pre-run signing-key lifecycle are configured; evaluator is inconclusive");
}

export function captureRequest(matrixRow) {
  const { fixtures, manifest } = evaluator();
  if (!manifest.run_matrix.some((item) => matrixKey(item) === matrixKey(matrixRow))) throw new Error("matrix row is not protected by manifest");
  const fixture = fixtureFor(fixtures, matrixRow);
  const prompt = makePrompt(fixture, matrixRow);
  return { matrix_key: matrixKey(matrixRow), prompt_sha256: sha256(prompt), prompt };
}
