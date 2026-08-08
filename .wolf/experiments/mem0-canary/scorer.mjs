import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractCandidate } from "./extractor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED_CASE = new Set(["id", "source", "text", "oracle", "kind", "section", "reason", "safety_critical"]);
const ALLOWED_PROPOSAL = new Set(["fixture_id", "source_hash", "source", "trust", "kind", "target_section", "text", "topic_key"]);
const ALLOWED_REJECTION = new Set(["fixture_id", "accepted", "reason"]);

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateBundle(fixtures, rubric, manifest = null, baseDir = HERE) {
  const problems = [];
  if (fixtures?.version !== 1 || fixtures?.kind !== "mem0-add-only-fixtures" || !Array.isArray(fixtures?.cases)) problems.push("invalid fixtures envelope");
  if (rubric?.version !== 1 || rubric?.kind !== "mem0-add-only-rubric") problems.push("invalid rubric envelope");
  const ids = new Set();
  for (const item of fixtures?.cases || []) {
    const unknown = Object.keys(item).filter((key) => !ALLOWED_CASE.has(key));
    if (unknown.length) problems.push(`${item.id || "<missing>"}: unknown fields ${unknown.join(",")}`);
    if (!/^[a-z0-9-]+$/.test(String(item.id || ""))) problems.push("invalid fixture id");
    if (ids.has(item.id)) problems.push(`duplicate fixture id ${item.id}`);
    ids.add(item.id);
    if (!new Set(["user", "assistant", "control", "quoted"]).has(item.source)) problems.push(`${item.id}: invalid source`);
    if (!new Set(["accept", "reject"]).has(item.oracle)) problems.push(`${item.id}: invalid oracle`);
    if (typeof item.text !== "string" || !item.text) problems.push(`${item.id}: missing text`);
  }
  const positives = (fixtures?.cases || []).filter((item) => item.oracle === "accept").length;
  const negatives = (fixtures?.cases || []).filter((item) => item.oracle === "reject").length;
  if (positives !== rubric?.thresholds?.positive_total) problems.push(`positive count ${positives} != ${rubric?.thresholds?.positive_total}`);
  if (negatives !== rubric?.thresholds?.negative_total) problems.push(`negative count ${negatives} != ${rubric?.thresholds?.negative_total}`);
  if (manifest) {
    if (manifest.version !== 1 || manifest.kind !== "mem0-canary-manifest") problems.push("invalid manifest envelope");
    for (const [name, expected] of Object.entries(manifest.hashes || {})) {
      const file = path.join(baseDir, name);
      if (!fs.existsSync(file) || sha(file) !== expected) problems.push(`protected bytes changed: ${name}`);
    }
  }
  return { valid: problems.length === 0, problems };
}

function normalizeControl(result) {
  return result ? { accepted: true, kind: result.kind, target_section: result.section } : { accepted: false };
}

function validateTreatmentOutput(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "output must be an object";
  const allowed = output.accepted === false ? ALLOWED_REJECTION : ALLOWED_PROPOSAL;
  const unknown = Object.keys(output).filter((key) => !allowed.has(key));
  if (unknown.length) return `unknown output fields ${unknown.join(",")}`;
  if (output.accepted === false) return typeof output.reason === "string" ? null : "rejection requires reason";
  if (output.trust !== "unreviewed" || output.source !== "user") return "accepted proposal violates trust/source boundary";
  if (!/^[a-f0-9]{64}$/.test(String(output.source_hash || ""))) return "accepted proposal requires source hash";
  return null;
}

export function scoreCanary({ fixtures, rubric, classifyControl, treatment = extractCandidate, manifest = null, baseDir = HERE } = {}) {
  const bundle = validateBundle(fixtures, rubric, manifest, baseDir);
  if (!bundle.valid) return { valid: false, verdict: "inconclusive", scope: "offline fixture conformance only", problems: bundle.problems, cases: [] };
  if (typeof classifyControl !== "function" || typeof treatment !== "function") return { valid: false, verdict: "inconclusive", scope: "offline fixture conformance only", problems: ["control and treatment functions are required"], cases: [] };

  const cases = [];
  const problems = [];
  for (const fixture of fixtures.cases) {
    let control;
    let treatmentOutput;
    try {
      control = normalizeControl(fixture.source === "user" ? classifyControl(fixture.text) : null);
      treatmentOutput = treatment(fixture);
    } catch (error) {
      problems.push(`${fixture.id}: extractor exception: ${error?.message || error}`);
      continue;
    }
    const invalid = validateTreatmentOutput(treatmentOutput);
    if (invalid) problems.push(`${fixture.id}: ${invalid}`);
    const treatmentAccepted = treatmentOutput.accepted !== false;
    const treatmentCorrect = fixture.oracle === "accept"
      ? treatmentAccepted && treatmentOutput.kind === fixture.kind && treatmentOutput.target_section === fixture.section && treatmentOutput.text === fixture.text.replace(/\s+/g, " ").trim()
      : !treatmentAccepted;
    const controlCorrect = fixture.oracle === "accept"
      ? control.accepted && control.kind === fixture.kind && control.target_section === fixture.section
      : !control.accepted;
    cases.push({ id: fixture.id, oracle: fixture.oracle, safety_critical: Boolean(fixture.safety_critical), control, treatment: treatmentOutput, control_correct: controlCorrect, treatment_correct: treatmentCorrect });
  }
  if (problems.length || cases.length !== fixtures.cases.length) return { valid: false, verdict: "inconclusive", scope: "offline fixture conformance only", problems, cases };

  const positives = cases.filter((item) => item.oracle === "accept");
  const negatives = cases.filter((item) => item.oracle === "reject");
  const metrics = {
    positive_total: positives.length,
    negative_total: negatives.length,
    control_positive_correct: positives.filter((item) => item.control_correct).length,
    treatment_positive_correct: positives.filter((item) => item.treatment_correct).length,
    control_false_positives: negatives.filter((item) => item.control.accepted).length,
    treatment_false_positives: negatives.filter((item) => item.treatment.accepted !== false).length,
    safety_false_positives: negatives.filter((item) => item.safety_critical && item.treatment.accepted !== false).length,
    recovered_baseline_false_negatives: positives.filter((item) => !item.control_correct && item.treatment_correct).length,
    baseline_regressions: cases.filter((item) => item.control_correct && !item.treatment_correct).length,
    cases_reported: cases.length,
  };
  const t = rubric.thresholds;
  const safetyFailure = metrics.treatment_false_positives > t.negative_false_positives_allowed || metrics.safety_false_positives > t.safety_false_positives_allowed;
  const survived = !safetyFailure
    && metrics.treatment_positive_correct === t.positive_correct_required
    && metrics.baseline_regressions <= t.baseline_regressions_allowed
    && metrics.recovered_baseline_false_negatives >= t.minimum_recovered_baseline_false_negatives
    && metrics.cases_reported === fixtures.cases.length;
  return {
    valid: true,
    verdict: safetyFailure ? "falsified" : survived ? "survived-for-follow-up-design" : "inconclusive",
    scope: "offline fixture conformance only",
    problems: [],
    metrics,
    cases,
    limitations: rubric.limitations,
  };
}

export function loadOfficialBundle(baseDir = HERE) {
  return {
    fixtures: JSON.parse(fs.readFileSync(path.join(baseDir, "fixtures.json"), "utf8")),
    rubric: JSON.parse(fs.readFileSync(path.join(baseDir, "rubric.json"), "utf8")),
    manifest: JSON.parse(fs.readFileSync(path.join(baseDir, "manifest.json"), "utf8")),
  };
}
