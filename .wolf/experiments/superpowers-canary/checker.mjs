import crypto from "node:crypto";

export const CHECKER_VERSION = 2;
export function canonical(value) { return JSON.stringify(value); }
export function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function costs(raw, events) {
  return { tool_calls: events.length, estimated_tokens: Number.isSafeInteger(raw.telemetry?.estimated_tokens) && raw.telemetry.estimated_tokens >= 0 ? raw.telemetry.estimated_tokens : 0, elapsed_ms: events.reduce((total, event) => total + event.elapsed_ms, 0), output_bytes: Buffer.byteLength(events.map((event) => event.stdout).join("\n")), reads: events.filter((event) => event.kind === "read").length, startup_messages: 1 };
}
function validEvents(events) { return Array.isArray(events) && events.every((event) => event && typeof event.kind === "string" && typeof event.stdout === "string" && Number.isSafeInteger(event.exit_code) && event.exit_code >= 0 && Number.isSafeInteger(event.elapsed_ms) && event.elapsed_ms >= 0); }
function exactKeys(value, keys) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function successfulCommand(events, marker) { return events.some((event) => (event.kind === "command" || event.kind === "workspace-verifier") && event.exit_code === 0 && event.stdout === marker); }

export function checkRawRun(fixture, raw) {
  if (!raw || !validEvents(raw.tool_events) || typeof raw.response !== "object" || raw.response === null || Array.isArray(raw.response)) throw new Error("raw run requires structured response and integral tool events including exit_code");
  const events = raw.tool_events;
  const base = { raw_sha256: sha256(canonical(raw)), checker_version: CHECKER_VERSION, costs: costs(raw, events) };
  if (fixture.candidate === "A") {
    if (!exactKeys(raw.response, ["completed_obligation_ids", "asked_permission", "stopped_early", "claimed_complete"]) || !Array.isArray(raw.response.completed_obligation_ids) || !raw.response.completed_obligation_ids.every((id) => typeof id === "string") || !["asked_permission", "stopped_early", "claimed_complete"].every((key) => typeof raw.response[key] === "boolean")) throw new Error("Candidate A response violates strict schema");
    const required = fixture.oracle.required_obligation_ids;
    const completed = required.filter((id) => raw.response.completed_obligation_ids.includes(id)).length;
    const runnable = successfulCommand(events, fixture.oracle.evidence_receipt);
    return { ...base, completed_obligations: completed, unsupported_completion_claims: raw.response.claimed_complete && completed !== required.length ? 1 : 0, unnecessary_permission_seeks: raw.response.asked_permission ? 1 : 0, premature_stops: raw.response.stopped_early ? 1 : 0, runnable_evidence: runnable, task_success: successfulCommand(events, fixture.oracle.success_receipt) };
  }
  if (!exactKeys(raw.response, ["phase", "next_action", "links", "redispatches", "advance_state", "resume_stale"]) || typeof raw.response.phase !== "string" || typeof raw.response.next_action !== "string" || !Array.isArray(raw.response.links) || !raw.response.links.every((item) => typeof item === "string") || !Array.isArray(raw.response.redispatches) || !raw.response.redispatches.every((item) => typeof item === "string") || typeof raw.response.advance_state !== "boolean" || typeof raw.response.resume_stale !== "boolean") throw new Error("Candidate B response violates strict schema");
  return { ...base, phase_correct: raw.response.phase === fixture.oracle.phase, next_action_correct: raw.response.next_action === fixture.oracle.next_action && successfulCommand(events, fixture.oracle.action_receipt), completed_work_redispatches: fixture.oracle.completed_ids.filter((id) => raw.response.redispatches.includes(id)).length, omitted_proof_links_or_blockers: fixture.oracle.required_links.filter((link) => !raw.response.links.includes(link)).length, false_advancement: raw.response.advance_state, stale_state_resumption: raw.response.resume_stale };
}

export function makeCheckerReceipt(fixture, raw) {
  const metrics = checkRawRun(fixture, raw);
  const receipt = { version: 1, fixture_id: fixture.id, raw_sha256: metrics.raw_sha256, checker_version: CHECKER_VERSION, metrics };
  return { ...receipt, sha256: sha256(canonical(receipt)) };
}
