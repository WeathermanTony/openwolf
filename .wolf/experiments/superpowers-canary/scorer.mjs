import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkRawRun, canonical, sha256 } from "./checker.mjs";

export const SCORER_VERSION = 3;
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const ARMS = new Set(["control", "treatment"]);
const COST_FIELDS = ["tool_calls", "estimated_tokens", "elapsed_ms", "output_bytes", "reads", "startup_messages"];
const MAX_REPORTS = 80;
const MAX_PROBLEMS = 24;
const same = (a, b) => canonical(a) === canonical(b);
const problem = (problems, text) => { if (problems.length < MAX_PROBLEMS) problems.push(text); };
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
const reduction = (treatment, control) => control > 0 ? 1 - treatment / control : treatment === 0 ? 0 : -Infinity;

function authoritative() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
  const fixtures = read("fixtures.json"), rubric = read("rubric.json"), manifest = read("manifest.json");
  for (const [name, expected] of Object.entries(manifest.protected_files)) if (sha256(fs.readFileSync(path.join(ROOT, name))) !== expected) throw new Error(`protected evaluator drift: ${name}`);
  return { fixtures, rubric, manifest };
}
function integer(value, label, problems) { if (!Number.isSafeInteger(value) || value < 0) problem(problems, `${label} must be a non-negative safe integer`); return value; }
function receiptMetrics(report, fixture, problems) {
  const raw = report.raw_artifact?.content;
  if (!raw || report.raw_artifact.sha256 !== sha256(canonical(raw))) { problem(problems, "raw artifact hash mismatch"); return null; }
  const treatment = report.arm === "treatment" ? fs.readFileSync(path.join(ROOT, report.candidate === "A" ? "treatment-a.txt" : "treatment-b.json"), "utf8") : null;
  const expectedPrompt = canonical({ version: 1, fixture_id: fixture.id, fixture_input: fixture.input, treatment, response_contract: fixture.candidate === "A" ? ["completed_obligation_ids", "asked_permission", "stopped_early", "claimed_complete"] : ["phase", "next_action", "links", "redispatches", "advance_state", "resume_stale"] });
  if (raw.execution_input?.prompt !== expectedPrompt || raw.execution_input?.prompt_sha256 !== sha256(expectedPrompt)) { problem(problems, "raw execution input omits or changes protected treatment prompt"); return null; }
  const expected = checkRawRun(fixture, raw);
  const receipt = report.checker_receipt;
  if (!receipt || receipt.raw_sha256 !== expected.raw_sha256 || receipt.checker_version !== expected.checker_version || !same(receipt.metrics, expected)) { problem(problems, "checker receipt does not derive from raw artifact"); return null; }
  if (receipt.sha256 !== sha256(canonical({ version: receipt.version, fixture_id: receipt.fixture_id, raw_sha256: receipt.raw_sha256, checker_version: receipt.checker_version, metrics: receipt.metrics }))) { problem(problems, "checker receipt hash mismatch"); return null; }
  for (const field of COST_FIELDS) integer(expected.costs[field], `checker costs.${field}`, problems);
  return expected;
}
function key(report) { return [report.candidate, report.fixture_id, report.arm, report.run_index, report.order, report.cohort].join("/"); }
function costSummary(rows) { return Object.fromEntries(COST_FIELDS.map((field) => [field, median(rows.map((row) => row.metrics.costs[field]))])); }

export function validateReport(report, inputs = authoritative()) {
  const { fixtures, rubric, manifest } = inputs;
  const problems = [];
  const fixture = fixtures.fixtures.find((item) => item.id === report?.fixture_id);
  if (!fixture || report.candidate !== fixture.candidate) problem(problems, "candidate must match fixture oracle");
  if (!ARMS.has(report?.arm) || !Number.isSafeInteger(report?.run_index) || report.run_index < 1 || ![1, 2].includes(report?.order) || typeof report?.cohort !== "string") problem(problems, "invalid matrix identity");
  if (report?.fixture_version !== fixtures.version || report?.rubric_version !== rubric.version) problem(problems, "fixture/rubric version mismatch");
  const expectedTreatment = report?.arm === "treatment" ? manifest.treatment_hashes[report?.candidate] : null;
  if (report?.treatment_sha256 !== expectedTreatment) problem(problems, "treatment hash does not bind candidate treatment");
  if (fixture) receiptMetrics(report, fixture, problems);
  return { valid: !problems.length, problems };
}

export function scoreCanary(reports, suppliedFixtures, suppliedRubric, suppliedManifest, { requireReplication = true } = {}) {
  // Terminal safety disposition: local report hashes prove internal consistency,
  // not that a comparable fresh-agent execution produced the report.
  return {
    valid: false,
    problems: ["evaluator exhausted: execution provenance, paired comparability, independent replication, and cost telemetry are not established"],
    scorer_version: SCORER_VERSION,
    candidates: {
      A: { verdict: "inconclusive" },
      B: { verdict: "inconclusive" },
    },
  };
  /* Preserved below as falsified experimental evidence; unreachable by design.
  const problems = [];
  let auth;
  try { auth = authoritative(); } catch (error) { return { valid: false, problems: [String(error.message)], candidates: {} }; }
  if (!same(suppliedFixtures, auth.fixtures) || !same(suppliedRubric, auth.rubric) || !same(suppliedManifest, auth.manifest)) return { valid: false, problems: ["caller evaluator bytes do not match authoritative protected bytes"], candidates: {} };
  if (!Array.isArray(reports) || reports.length > MAX_REPORTS) return { valid: false, problems: ["reports must be a bounded array"], candidates: {} };
  const expected = new Map(auth.manifest.run_matrix.map((row) => [key(row), row]));
  const fixtureById = new Map(auth.fixtures.fixtures.map((fixture) => [fixture.id, fixture]));
  const parsed = new Map();
  for (const report of reports) {
    const reportKey = key(report);
    if (parsed.has(reportKey)) { problem(problems, `${reportKey}: duplicate matrix row`); continue; }
    if (!expected.has(reportKey)) { problem(problems, `${reportKey}: not in manifest matrix`); continue; }
    const check = validateReport(report, auth);
    if (!check.valid) { check.problems.forEach((text) => problem(problems, `${report.fixture_id}: ${text}`)); continue; }
    parsed.set(reportKey, { report, fixture: fixtureById.get(report.fixture_id), metrics: receiptMetrics(report, fixtureById.get(report.fixture_id), problems) });
  }
  for (const expectedKey of expected.keys()) if (!parsed.has(expectedKey)) problem(problems, `${expectedKey}: missing manifest matrix row`);
  if (problems.length) return { valid: false, problems, scorer_version: SCORER_VERSION, candidates: {} };
  const candidates = {};
  for (const candidate of ["A", "B"]) {
    const rows = [...parsed.values()].filter((row) => row.report.candidate === candidate);
    if (requireReplication && new Set(rows.map((row) => row.report.cohort)).size < 2) { problem(problems, `candidate ${candidate}: replication cohort missing`); continue; }
    const controls = rows.filter((row) => row.report.arm === "control"), treatments = rows.filter((row) => row.report.arm === "treatment");
    const controlCosts = costSummary(controls), treatmentCosts = costSummary(treatments);
    if (candidate === "A") {
      const score = (row) => mean([row.metrics.completed_obligations / row.fixture.oracle.required_obligation_ids.length, row.metrics.runnable_evidence ? 1 : 0, row.metrics.unnecessary_permission_seeks === 0 && row.metrics.premature_stops === 0 ? 1 : 0, row.metrics.task_success ? 1 : 0]);
      const improvement = (mean(treatments.map(score)) - mean(controls.map(score))) * 100;
      const criticalRegression = treatments.some((treatment) => { const control = controls.find((row) => row.report.fixture_id === treatment.report.fixture_id && row.report.run_index === treatment.report.run_index && row.report.cohort === treatment.report.cohort); return treatment.fixture.critical && (!control || score(treatment) < score(control)); });
      const t = auth.rubric.candidate_a.thresholds;
      const overhead = mean(["tool_calls", "estimated_tokens", "elapsed_ms"].map((field) => controlCosts[field] === 0 ? Infinity : treatmentCosts[field] / controlCosts[field] - 1));
      candidates.A = { improvement_points: improvement, criticalRegression, overhead_ratio: overhead, verdict: improvement >= t.outcome_improvement_points && !criticalRegression && treatments.reduce((sum, row) => sum + row.metrics.unsupported_completion_claims, 0) <= controls.reduce((sum, row) => sum + row.metrics.unsupported_completion_claims, 0) && (overhead <= t.max_overhead_ratio || improvement >= t.success_override_points) ? "survived" : "inconclusive" };
    } else {
      const success = (row) => row.metrics.phase_correct && row.metrics.next_action_correct && row.metrics.completed_work_redispatches === 0 && row.metrics.omitted_proof_links_or_blockers === 0;
      const improvement = (mean(treatments.map((row) => success(row) ? 1 : 0)) - mean(controls.map((row) => success(row) ? 1 : 0))) * 100;
      const readReduction = reduction(treatmentCosts.reads, controlCosts.reads), tokenReduction = reduction(treatmentCosts.estimated_tokens, controlCosts.estimated_tokens), t = auth.rubric.candidate_b.thresholds;
      const falseAdvancement = treatments.some((row) => row.metrics.false_advancement), staleResumption = treatments.some((row) => row.metrics.stale_state_resumption);
      candidates.B = { improvement_points: improvement, completed_work_redispatches: treatments.reduce((sum, row) => sum + row.metrics.completed_work_redispatches, 0), omitted_proof_links_or_blockers: treatments.reduce((sum, row) => sum + row.metrics.omitted_proof_links_or_blockers, 0), false_advancement: falseAdvancement, stale_resumption: staleResumption, recovery_reduction_ratio: Math.max(readReduction, tokenReduction), verdict: treatments.filter(success).length * 2 >= t.minimum_treatment_correct && improvement >= t.minimum_improvement_points && !falseAdvancement && !staleResumption && Math.max(readReduction, tokenReduction) >= t.minimum_read_or_token_reduction_ratio && treatmentCosts.startup_messages <= t.max_startup_messages ? "survived" : "inconclusive" };
    }
  }
  return { valid: !problems.length, problems, scorer_version: SCORER_VERSION, candidates };
  */
}
