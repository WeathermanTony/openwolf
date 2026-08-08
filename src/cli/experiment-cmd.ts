// @ts-nocheck
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { findProjectRoot } from "../scanner/project-root.js";
import { hashFilesAtRest, makeArtifactManifest, validateArtifactManifest } from "../hooks/shared.js";
import { acquireFileLock, atomicWriteJson } from "../utils/size-discipline.js";

const VERSION = 1;
const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?--\d{8}t\d{6}z(?:-\d+)?$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const TERMINAL = new Set(["survived", "falsified", "inconclusive", "exhausted", "abandoned"]);
const CONCLUDABLE = new Set(TERMINAL);
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|github_pat|xox[baprs])-[_A-Za-z0-9-]{16,}|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S{8,}/i;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|<(?:system-reminder|task-notification|hookSpecificOutput|command-name)\b|ignore (?:all |the )?(?:previous|prior) instructions|system prompt/i;
const MAX_PROSE = 4000;
const DEFAULT_POLICY = {
  enabled: false,
  max_attempts_per_strategy: 3,
  max_evidence_entries: 50,
  max_output_chars: 16 * 1024,
  max_protected_file_bytes: 8 * 1024 * 1024,
};

function root(): string { return findProjectRoot(process.cwd()) || process.cwd(); }
function experimentDir(projectRoot: string): string { return path.join(projectRoot, ".wolf", "experiments"); }
function normalizeRel(value: string): string { return value.replace(/\\/g, "/").replace(/^\.\//, ""); }
function nowIso(): string { return new Date().toISOString(); }

function safeText(value: unknown, label: string, min = 1, max = MAX_PROSE): string {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) throw new Error(`${label} must be ${min}-${max} characters`);
  if (SECRET.test(text) || CONTROL.test(text)) throw new Error(`${label} contains secret-like or control content`);
  return text;
}

function parsePositiveInt(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

function experimentPolicy(projectRoot: string) {
  let config: any = {};
  const file = path.join(projectRoot, ".wolf", "config.json");
  if (fs.existsSync(file)) {
    try { config = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`invalid experiment policy config: ${error?.message || error}`); }
  }
  const supplied = config?.openwolf?.experiments ?? {};
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("experiment policy must be an object");
  if (supplied.enabled !== undefined && typeof supplied.enabled !== "boolean") throw new Error("experiment policy enabled must be boolean");
  const policy = { ...DEFAULT_POLICY, ...supplied };
  for (const key of ["max_attempts_per_strategy", "max_evidence_entries", "max_output_chars", "max_protected_file_bytes"]) {
    policy[key] = parsePositiveInt(policy[key], `experiment policy ${key}`);
  }
  return policy;
}

function requireExperimentMutation(projectRoot: string) {
  const policy = experimentPolicy(projectRoot);
  if (!policy.enabled) throw new Error("Experiment Mode is disabled; set openwolf.experiments.enabled=true to mutate experiment records");
  return policy;
}

function resolveInside(projectRoot: string, supplied: string, label: string, requireFile = false): { abs: string; rel: string } {
  if (!supplied || typeof supplied !== "string") throw new Error(`${label} is required`);
  const abs = path.resolve(projectRoot, supplied);
  const relNative = path.relative(projectRoot, abs);
  if (relNative === "" && requireFile) throw new Error(`${label} must name a file`);
  if (relNative === ".." || relNative.startsWith(`..${path.sep}`) || path.isAbsolute(relNative)) throw new Error(`${label} must stay inside the project root`);
  let cursor = projectRoot;
  for (const part of relNative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} must not contain symlinks`);
  }
  if (requireFile) {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error(`${label} must name a regular file`);
  }
  return { abs, rel: normalizeRel(relNative) };
}

function protectedManifest(projectRoot: string, supplied: string[], maxFileBytes = DEFAULT_POLICY.max_protected_file_bytes) {
  if (!Array.isArray(supplied) || supplied.length === 0) throw new Error("at least one --protect path is required");
  const resolved = supplied.map((item) => resolveInside(projectRoot, item, "protected path", true));
  const oversized = resolved.filter((item) => fs.statSync(item.abs).size > maxFileBytes);
  if (oversized.length) throw new Error(`protected inputs exceed ${maxFileBytes} bytes: ${oversized.map((item) => item.rel).join(", ")}`);
  const rels = [...new Set(resolved.map((item) => item.rel))].sort();
  const absByRel = new Map(resolved.map((item) => [item.rel, item.abs]));
  const absoluteHashes = hashFilesAtRest(rels.map((rel) => absByRel.get(rel)));
  const relativeHashes = {};
  for (const rel of rels) relativeHashes[rel] = absoluteHashes[normalizeRel(absByRel.get(rel))];
  const manifest = makeArtifactManifest(rels, relativeHashes, { portable: true });
  const invalid = Object.entries(manifest.hashes).filter(([, hash]) => !/^[a-f0-9]{64}$/.test(String(hash)));
  if (invalid.length) throw new Error(`protected inputs must be readable existing files: ${invalid.map(([file]) => file).join(", ")}`);
  return manifest;
}

function gitValue(projectRoot: string, args: string[]): string | null {
  try { return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
  catch { return null; }
}

function idStamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").replace("T", "t");
}

function recordPath(projectRoot: string, id: string): string {
  if (!ID_RE.test(id)) throw new Error("invalid experiment id");
  return path.join(experimentDir(projectRoot), `${id}.json`);
}

function readRecord(projectRoot: string, id: string): any {
  const file = recordPath(projectRoot, id);
  let record;
  try { record = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`cannot read experiment ${id}: ${error?.message || error}`); }
  const checked = validateExperiment(record);
  if (!checked.valid) throw new Error(`malformed experiment ${id}: ${checked.problems.join("; ")}`);
  return record;
}

function listRecords(projectRoot: string): any[] {
  const dir = experimentDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith(".json") && !file.startsWith(".")).sort().map((file) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); }
    catch { return { id: file.slice(0, -5), malformed: true }; }
  });
}

export function validateExperiment(record: any): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return { valid: false, problems: ["record must be an object"] };
  if (record.version !== VERSION) problems.push("version must be 1");
  if (record.kind !== "wolfpack-experiment") problems.push("kind must be wolfpack-experiment");
  if (!ID_RE.test(record.id ?? "")) problems.push("invalid id");
  if (!["planned", "running", ...TERMINAL].includes(record.status)) problems.push("invalid status");
  for (const field of ["objective", "hypothesis", "strategy_family"]) if (typeof record[field] !== "string" || !record[field].trim()) problems.push(`${field} is required`);
  if (!Number.isSafeInteger(record.attempt?.number) || record.attempt.number < 1) problems.push("attempt.number must be positive");
  if (!Number.isSafeInteger(record.attempt?.max) || record.attempt.max < 1 || record.attempt.number > record.attempt.max) problems.push("attempt.max is invalid");
  const manifest = validateArtifactManifest(record.protected?.manifest, { portable: true });
  problems.push(...manifest.problems.map((problem) => `protected.manifest: ${problem}`));
  if (!Array.isArray(record.evidence)) problems.push("evidence must be an array");
  if (TERMINAL.has(record.status) && (!record.result || typeof record.result.conclusion !== "string" || !record.result.conclusion.trim())) problems.push("terminal record requires result");
  return { valid: problems.length === 0, problems };
}

export function verifyExperimentRecord(projectRoot: string, record: any) {
  const check = validateExperiment(record);
  if (!check.valid) return { status: "MALFORMED", problems: check.problems };
  try {
    for (const rel of record.protected.manifest.files) resolveInside(projectRoot, rel, "protected path", true);
    const current = protectedManifest(projectRoot, record.protected.manifest.files);
    if (current.manifest_hash !== record.protected.manifest.manifest_hash) return { status: "STALE", problems: ["protected evaluator bytes changed"], current };
    return { status: "CURRENT", problems: [], current };
  } catch (error) {
    return { status: "UNREADABLE", problems: [String(error?.message || error)] };
  }
}

function writeVerified(file: string, record: any): void {
  if (!atomicWriteJson(file, record)) throw new Error("atomic experiment write failed");
  const reread = JSON.parse(fs.readFileSync(file, "utf8"));
  const check = validateExperiment(reread);
  if (!check.valid || JSON.stringify(reread) !== JSON.stringify(record)) throw new Error(`experiment write verification failed: ${check.problems.join("; ")}`);
}

export function startExperiment(slug: string, opts: any = {}) {
  if (!SLUG_RE.test(slug)) throw new Error("slug must be lowercase letters, digits, and single hyphen-separated words");
  const projectRoot = root();
  const policy = requireExperimentMutation(projectRoot);
  const dir = experimentDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const strategy = safeText(opts.strategy || slug, "strategy", 1, 128).toLowerCase();
  if (!SLUG_RE.test(strategy)) throw new Error("strategy must be a lowercase slug");
  const maxAttempts = parsePositiveInt(opts.maxAttempts ?? policy.max_attempts_per_strategy, "max attempts");
  if (maxAttempts > policy.max_attempts_per_strategy) throw new Error(`max attempts cannot exceed configured ceiling ${policy.max_attempts_per_strategy}`);
  const strategyLock = path.join(dir, `.strategy-${crypto.createHash("sha256").update(strategy).digest("hex").slice(0, 16)}`);
  const release = acquireFileLock(strategyLock);
  if (!release) throw new Error("strategy is locked");
  try {
    const family = listRecords(projectRoot).filter((item) => item.strategy_family === strategy && validateExperiment(item).valid);
    const attemptNumber = family.length + 1;
    if (attemptNumber > maxAttempts) throw new Error(`strategy ${strategy} exhausted its ${maxAttempts} attempts; use a new strategy family`);
    let id = `${slug}--${idStamp()}`;
    let sequence = 2;
    while (fs.existsSync(path.join(dir, `${id}.json`))) id = `${slug}--${idStamp()}-${sequence++}`;
    const manifest = protectedManifest(projectRoot, opts.protect, policy.max_protected_file_bytes);
    if (opts.parent) readRecord(projectRoot, opts.parent);
    const created = nowIso();
    const record = {
      version: VERSION,
      kind: "wolfpack-experiment",
      id,
      status: "planned",
      objective: safeText(opts.objective, "objective", 8),
      hypothesis: safeText(opts.hypothesis, "hypothesis", 8),
      strategy_family: strategy,
      parent_id: opts.parent ?? null,
      attempt: { number: attemptNumber, max: maxAttempts },
      source: {
        project_root: ".",
        base_commit: gitValue(projectRoot, ["rev-parse", "HEAD"]),
        branch: opts.branch ? safeText(opts.branch, "branch", 1, 256) : gitValue(projectRoot, ["branch", "--show-current"]),
        worktree: opts.worktree ? resolveInside(projectRoot, opts.worktree, "worktree").rel || "." : null,
      },
      protected: { captured_at: created, manifest },
      evidence: [],
      result: null,
      created_at: created,
      updated_at: created,
    };
    const file = recordPath(projectRoot, id);
    const recordRelease = acquireFileLock(file);
    if (!recordRelease) throw new Error("experiment record is locked");
    try {
      if (fs.existsSync(file)) throw new Error(`experiment ${id} already exists`);
      writeVerified(file, record);
    } finally { recordRelease(); }
    return record;
  } finally { release(); }
}

export function addExperimentEvidence(id: string, opts: any = {}) {
  const projectRoot = root();
  const policy = requireExperimentMutation(projectRoot);
  const file = recordPath(projectRoot, id);
  const release = acquireFileLock(file);
  if (!release) throw new Error("experiment record is locked");
  try {
    const record = readRecord(projectRoot, id);
    if (TERMINAL.has(record.status)) throw new Error("completed experiments are immutable");
    if (record.evidence.length >= policy.max_evidence_entries) throw new Error(`experiment evidence cannot exceed configured ceiling ${policy.max_evidence_entries}`);
    const cwd = resolveInside(projectRoot, opts.cwd, "cwd");
    if (!fs.statSync(cwd.abs).isDirectory()) throw new Error("cwd must be a directory");
    if (opts.output && opts.outputFile) throw new Error("use only one of --output or --output-file");
    let output = opts.output ? String(opts.output) : "";
    if (opts.outputFile) {
      const outputFile = resolveInside(projectRoot, opts.outputFile, "output file", true).abs;
      const outputBytes = fs.statSync(outputFile).size;
      if (outputBytes > policy.max_output_chars) {
        throw new Error(`evidence output file cannot exceed configured ceiling ${policy.max_output_chars} bytes`);
      }
      output = fs.readFileSync(outputFile, "utf8");
    }
    if (SECRET.test(output) || CONTROL.test(output)) throw new Error("evidence output contains secret-like or control content");
    if (output.length > policy.max_output_chars) output = output.slice(0, policy.max_output_chars) + "\n[truncated]";
    const exitCode = Number(opts.exitCode);
    if (!Number.isSafeInteger(exitCode)) throw new Error("exit code must be an integer");
    record.evidence.push({
      recorded_at: nowIso(),
      command: safeText(opts.command, "command", 1, 2000),
      cwd: cwd.rel || ".",
      exit_code: exitCode,
      output,
    });
    record.status = "running";
    record.updated_at = nowIso();
    writeVerified(file, record);
    return record;
  } finally { release(); }
}

export function concludeExperiment(id: string, opts: any = {}) {
  const projectRoot = root();
  requireExperimentMutation(projectRoot);
  const file = recordPath(projectRoot, id);
  const release = acquireFileLock(file);
  if (!release) throw new Error("experiment record is locked");
  try {
    const record = readRecord(projectRoot, id);
    if (TERMINAL.has(record.status)) throw new Error("completed experiments are immutable");
    if (!CONCLUDABLE.has(opts.status)) throw new Error("invalid terminal status");
    if (record.evidence.length === 0 && opts.status !== "abandoned") throw new Error("terminal experiments require actual evidence");
    const integrity = verifyExperimentRecord(projectRoot, record);
    if (opts.status === "survived" && integrity.status !== "CURRENT") throw new Error(`cannot mark survived: evaluator manifest is ${integrity.status}`);
    if (record.attempt.number >= record.attempt.max && ["falsified", "inconclusive"].includes(opts.status)) throw new Error("final strategy attempt must be concluded as exhausted or explicitly re-scoped");
    record.status = opts.status;
    record.result = {
      concluded_at: nowIso(),
      conclusion: safeText(opts.conclusion, "conclusion", 8),
      limitation: safeText(opts.limit, "limit", 4),
      falsifier: safeText(opts.falsifier, "falsifier", 4),
      lesson: opts.lesson ? safeText(opts.lesson, "lesson", 8) : null,
      links: {
        qa: opts.qa ? normalizeRel(resolveInside(projectRoot, opts.qa, "qa", true).rel) : null,
        review: opts.review ? safeText(opts.review, "review", 1, 128) : null,
        bug: opts.bug ? safeText(opts.bug, "bug", 1, 128) : null,
      },
      protected_status: integrity.status,
    };
    record.updated_at = nowIso();
    writeVerified(file, record);
    return record;
  } finally { release(); }
}

function summarize(record: any) {
  return { id: record.id, status: record.status, strategy: record.strategy_family, attempt: record.attempt, objective: record.objective, updated_at: record.updated_at };
}

function printFailure(error: any): void { console.error(`FAILED: ${String(error?.message || error)}`); process.exitCode = 1; }
export function experimentStart(slug: string, opts: any): void { try { const record = startExperiment(slug, opts); console.log(`${record.id} created (${record.strategy_family} attempt ${record.attempt.number}/${record.attempt.max})`); } catch (e) { printFailure(e); } }
export function experimentEvidence(id: string, opts: any): void { try { const record = addExperimentEvidence(id, opts); console.log(`${id}: evidence ${record.evidence.length} recorded`); } catch (e) { printFailure(e); } }
export function experimentConclude(id: string, opts: any): void { try { const record = concludeExperiment(id, opts); console.log(`${id}: ${record.status}`); } catch (e) { printFailure(e); } }
export function experimentShow(id: string, opts: any = {}): void { try { const record = readRecord(root(), id); console.log(opts.json ? JSON.stringify(record, null, 2) : JSON.stringify(summarize(record), null, 2)); } catch (e) { printFailure(e); } }
export function experimentList(opts: any = {}): void { try { const records = listRecords(root()); console.log(opts.json ? JSON.stringify(records, null, 2) : records.map((item) => `${item.id}\t${item.status ?? "MALFORMED"}\t${item.strategy_family ?? "-"}`).join("\n")); } catch (e) { printFailure(e); } }
export function experimentVerify(id: string, opts: any = {}): void { try { const projectRoot = root(); const result = verifyExperimentRecord(projectRoot, readRecord(projectRoot, id)); console.log(opts.json ? JSON.stringify(result, null, 2) : `${id}: ${result.status}${result.problems.length ? ` — ${result.problems.join("; ")}` : ""}`); if (result.status !== "CURRENT") process.exitCode = 1; } catch (e) { printFailure(e); } }
export function experimentStatus(id: string | undefined, opts: any = {}): void {
  try {
    const projectRoot = root();
    const records = id ? [readRecord(projectRoot, id)] : listRecords(projectRoot);
    const results = records.map((record) => {
      const integrity = verifyExperimentRecord(projectRoot, record);
      const problems = [...integrity.problems];
      if (validateExperiment(record).valid && !TERMINAL.has(record.status) && record.attempt.number >= record.attempt.max) problems.push("nonterminal experiment has reached its strategy cap");
      if (validateExperiment(record).valid && TERMINAL.has(record.status) && record.status !== "abandoned" && record.evidence.length === 0) problems.push("terminal experiment has no evidence");
      return { id: record.id, lifecycle: record.status ?? "MALFORMED", integrity: integrity.status, problems };
    });
    console.log(opts.json ? JSON.stringify(results, null, 2) : results.map((item) => `${item.id}\t${item.lifecycle}\t${item.integrity}${item.problems.length ? `\t${item.problems.join("; ")}` : ""}`).join("\n"));
    if (opts.check && results.some((item) => item.integrity !== "CURRENT" || item.problems.length)) process.exitCode = 1;
  } catch (e) { printFailure(e); }
}
