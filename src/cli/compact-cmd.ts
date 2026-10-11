import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFleetProjects, readRegistry } from "./registry.js";
import { acquireFileLock, atomicWriteBytes, atomicWriteJson } from "../utils/size-discipline.js";
import { ClaudeCliSummarizer, type Summarizer } from "../ai/claude-cli-summarizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(__dirname, "../../..");
const POLICY_VERSION = "compact-v1";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DAY = 24 * 60 * 60 * 1000;

type SurfaceKind = "memory" | "buglog" | "reviewlog" | "token-ledger" | "nudge-state";

export interface CompactProtection {
  surface: string;
  path: string;
  reason: string;
  bytes: number;
}

export interface CompactSurfacePlan {
  kind: SurfaceKind;
  livePath: string;
  archivePath: string;
  before: string;
  after: string;
  archiveBefore: string | null;
  archiveAfter: string;
  bytesBefore: number;
  bytesAfter: number;
  bytesArchived: number;
  records: number;
  reason: string;
}

export interface CompactProjectPlan {
  root: string;
  realRoot: string;
  eligible: boolean;
  reason?: string;
  blocked?: string[];
  actions: CompactSurfacePlan[];
  protections: CompactProtection[];
}

export interface CompactManifest {
  version: 1;
  policyVersion: string;
  generatedAt: string;
  target: { mode: "fleet" | "root"; root?: string };
  ai: { enabled: boolean; model: string | null; adapter: "claude-cli" | null; promptSchemaVersion: number | null };
  projects: CompactProjectPlan[];
  totals: {
    projectsEligible: number;
    projectsExcluded: number;
    projectsBlocked: number;
    actions: number;
    bytesBefore: number;
    bytesAfterEstimated: number;
    bytesReclaimable: number;
    bytesArchived: number;
  };
}

export interface CompactOptions {
  root?: string;
  apply?: boolean;
  manifestHash?: string;
  json?: boolean;
  rollback?: string;
  ai?: boolean;
  model?: string;
  now?: number;
  summarizer?: Summarizer;
  faultInjection?: { afterArchiveKind?: SurfaceKind };
}

interface TransformResult {
  live: Buffer;
  archive: Buffer;
  records: number;
}

function sha(bytes: Buffer | undefined): string | null {
  return bytes === undefined ? null : crypto.createHash("sha256").update(bytes).digest("hex");
}

function readBytes(file: string): Buffer | undefined {
  try { return fs.readFileSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function authorizationProjection(manifest: CompactManifest): Omit<CompactManifest, "generatedAt"> {
  const { generatedAt: _generatedAt, ...projection } = manifest;
  return projection;
}

export function hashCompactManifest(manifest: CompactManifest): string {
  return sha(Buffer.from(stable(authorizationProjection(manifest))))!;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseConfig(root: string): any {
  try { return JSON.parse(fs.readFileSync(path.join(root, ".wolf", "config.json"), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function archivePathFor(file: string, now: number): string {
  const d = new Date(now);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const ext = path.extname(file);
  return path.join(path.dirname(file), "archive", `${path.basename(file, ext)}-${month}${ext}`);
}

function parseJson(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlainObject(value) ? value : null;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function dateValue(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dedupJson(existing: unknown[], additions: unknown[], idKey = "id"): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const item of [...existing, ...additions]) {
    const id = isPlainObject(item) && typeof item[idKey] === "string" ? `id:${item[idKey]}` : `sha:${sha(Buffer.from(stable(item)))}`;
    if (!seen.has(id)) { seen.add(id); out.push(item); }
  }
  return out;
}

function jsonTransform(file: string, archiveFile: string, arrayKey: string, eligible: (entry: unknown) => boolean): TransformResult | null {
  const doc = parseJson(file);
  if (!doc || !Array.isArray(doc[arrayKey])) return null;
  const source = doc[arrayKey] as unknown[];
  const moving = source.filter(eligible);
  if (moving.length === 0) return null;
  const keeping = source.filter(entry => !eligible(entry));
  let archiveDoc: Record<string, unknown> = {};
  if (fs.existsSync(archiveFile)) {
    const parsed = parseJson(archiveFile);
    if (!parsed || (arrayKey in parsed && !Array.isArray(parsed[arrayKey]))) return null;
    archiveDoc = parsed;
  } else if ("version" in doc) {
    archiveDoc.version = doc.version;
  }
  archiveDoc[arrayKey] = dedupJson(Array.isArray(archiveDoc[arrayKey]) ? archiveDoc[arrayKey] as unknown[] : [], moving);
  const liveDoc = { ...doc, [arrayKey]: keeping };
  return {
    live: Buffer.from(JSON.stringify(liveDoc, null, 2) + "\n"),
    archive: Buffer.from(JSON.stringify(archiveDoc, null, 2) + "\n"),
    records: moving.length,
  };
}

function memoryTransform(file: string, archiveFile: string, cutoff: number): TransformResult | null {
  let content: string;
  try { content = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const lines = content.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (/^## Session: /.test(lines[i])) starts.push(i);
  if (starts.length === 0) return null;
  const preamble = lines.slice(0, starts[0]).join("\n");
  const keep: string[] = [];
  const moving: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const section = lines.slice(starts[i], starts[i + 1] ?? lines.length).join("\n");
    const match = section.match(/^## Session:\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
    const t = match ? Date.parse(match[2] ? `${match[1]}T${match[2]}:00Z` : `${match[1]}T00:00:00Z`) : NaN;
    (Number.isFinite(t) && t < cutoff ? moving : keep).push(section);
  }
  if (moving.length === 0) return null;
  let existing = "";
  try { existing = fs.readFileSync(archiveFile, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing.trim() && !/^## Session: /m.test(existing)) return null;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const section of [...splitMemorySections(existing), ...moving]) {
    const key = sha(Buffer.from(section))!;
    if (!seen.has(key)) { seen.add(key); merged.push(section); }
  }
  return {
    live: Buffer.from(preamble + (keep.length ? `\n${keep.join("\n")}` : "\n")),
    archive: Buffer.from(merged.join("\n")),
    records: moving.length,
  };
}

function splitMemorySections(content: string): string[] {
  if (!content.trim()) return [];
  const lines = content.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (/^## Session: /.test(lines[i])) starts.push(i);
  return starts.map((start, i) => lines.slice(start, starts[i + 1] ?? lines.length).join("\n"));
}

function transformFor(kind: SurfaceKind, livePath: string, archivePath: string, config: any, now: number): TransformResult | null {
  const size = config?.openwolf?.size_discipline ?? {};
  if (kind === "memory") {
    const days = Number(size?.memory?.retention_days ?? 30);
    return days > 0 ? memoryTransform(livePath, archivePath, now - days * DAY) : null;
  }
  if (kind === "buglog") {
    const days = Number(size?.buglog?.retention_days ?? 30);
    const cutoff = now - days * DAY;
    return days > 0 ? jsonTransform(livePath, archivePath, "bugs", entry => isPlainObject(entry) && (dateValue(entry.last_seen) ?? Infinity) < cutoff) : null;
  }
  if (kind === "reviewlog") {
    const days = Number(size?.reviewlog?.retention_days ?? 30);
    const cutoff = now - days * DAY;
    const terminal = new Set(["completed", "resolved", "dismissed", "superseded"]);
    return days > 0 ? jsonTransform(livePath, archivePath, "reviews", entry => {
      if (!isPlainObject(entry) || !terminal.has(String(entry.status ?? "").toLowerCase())) return false;
      if (entry.pending === true || entry.current === true || entry.qa_reduction || entry.reviewed_hashes || entry.current_hashes) return false;
      return (dateValue(entry.ended) ?? Infinity) < cutoff;
    }) : null;
  }
  if (kind === "nudge-state") {
    const doc = parseJson(livePath);
    if (!doc || doc.version !== 4 || !isPlainObject(doc.leases)) return null;
    const leases = doc.leases as Record<string, unknown>;
    const expired = Object.entries(leases).filter(([, lease]) =>
      isPlainObject(lease) && dateValue(lease.expires_at) !== null && dateValue(lease.expires_at)! <= now);
    if (!expired.length) return null;
    const remaining = Object.fromEntries(Object.entries(leases).filter(([fingerprint]) => !expired.some(([key]) => key === fingerprint)));
    let archiveDoc: Record<string, unknown> = { version: 1, expired_leases: [] };
    if (fs.existsSync(archivePath)) {
      const parsed = parseJson(archivePath);
      if (!parsed || ("expired_leases" in parsed && !Array.isArray(parsed.expired_leases))) return null;
      archiveDoc = parsed;
    }
    const additions = expired.map(([fingerprint, lease]) => ({ fingerprint, lease }));
    archiveDoc.expired_leases = dedupJson(Array.isArray(archiveDoc.expired_leases) ? archiveDoc.expired_leases : [], additions, "fingerprint");
    return {
      live: Buffer.from(JSON.stringify({ ...doc, leases: remaining }, null, 2) + "\n"),
      archive: Buffer.from(JSON.stringify(archiveDoc, null, 2) + "\n"),
      records: expired.length,
    };
  }
  const max = Number(size?.token_ledger?.max_inline_sessions ?? 60);
  const doc = parseJson(livePath);
  if (!doc || !Array.isArray(doc.sessions) || max <= 0 || doc.sessions.length <= max) return null;
  const overflow = doc.sessions.length - max;
  const moving = doc.sessions.slice(0, overflow);
  const keeping = doc.sessions.slice(overflow);
  let archiveDoc: Record<string, unknown> = {};
  if (fs.existsSync(archivePath)) {
    const parsed = parseJson(archivePath);
    if (!parsed || ("sessions" in parsed && !Array.isArray(parsed.sessions))) return null;
    archiveDoc = parsed;
  } else if ("version" in doc) archiveDoc.version = doc.version;
  archiveDoc.sessions = dedupJson(Array.isArray(archiveDoc.sessions) ? archiveDoc.sessions : [], moving);
  return {
    live: Buffer.from(JSON.stringify({ ...doc, sessions: keeping }, null, 2) + "\n"),
    archive: Buffer.from(JSON.stringify(archiveDoc, null, 2) + "\n"),
    records: moving.length,
  };
}

function planSurface(root: string, kind: SurfaceKind, relative: string, config: any, now: number): CompactSurfacePlan | null {
  const livePath = path.join(root, ".wolf", relative);
  if (!fs.existsSync(livePath)) return null;
  const archivePath = archivePathFor(livePath, now);
  const transformed = transformFor(kind, livePath, archivePath, config, now);
  if (!transformed) return null;
  const beforeBytes = fs.readFileSync(livePath);
  const archiveBeforeBytes = readBytes(archivePath);
  return {
    kind, livePath, archivePath,
    before: sha(beforeBytes)!, after: sha(transformed.live)!,
    archiveBefore: sha(archiveBeforeBytes), archiveAfter: sha(transformed.archive)!,
    bytesBefore: beforeBytes.length, bytesAfter: transformed.live.length,
    bytesArchived: Math.max(0, transformed.archive.length - (archiveBeforeBytes?.length ?? 0)),
    records: transformed.records,
    reason: `${transformed.records} eligible historical ${transformed.records === 1 ? "record" : "records"}`,
  };
}

function isSourceCheckout(root: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return pkg.name === "customopenwolf" && fs.existsSync(path.join(root, "src", "cli", "index.ts"));
  } catch { return false; }
}

export function buildCompactManifest(options: CompactOptions = {}): { manifest: CompactManifest; hash: string } {
  const now = options.now ?? Date.now();
  let entries = classifyFleetProjects(readRegistry().projects, SOURCE_ROOT).map(entry => isSourceCheckout(entry.realRoot)
    ? { ...entry, eligible: false, reason: "source-checkout" as const }
    : entry);
  if (options.root) {
    if (!path.isAbsolute(options.root)) throw new Error("--root must be absolute");
    let requested: string;
    try { requested = fs.realpathSync.native(options.root); } catch { requested = path.resolve(options.root); }
    entries = entries.filter(entry => entry.realRoot === requested);
    if (entries.length !== 1) throw new Error(`No exact registered root: ${options.root}`);
  }
  const projects: CompactProjectPlan[] = entries.sort((a, b) => a.realRoot.localeCompare(b.realRoot)).map(entry => {
    const project: CompactProjectPlan = { root: entry.project.root, realRoot: entry.realRoot, eligible: entry.eligible, reason: entry.reason, actions: [], protections: [] };
    if (!entry.eligible) return project;
    try {
      const config = parseConfig(entry.realRoot);
      const candidates: Array<[SurfaceKind, string]> = [["memory", "memory.md"], ["buglog", "buglog.json"], ["reviewlog", "reviewlog.json"], ["token-ledger", "token-ledger.json"], ["nudge-state", "nudge-state.json"]];
      for (const [kind, relative] of candidates) {
        const action = planSurface(entry.realRoot, kind, relative, config, now);
        if (action) project.actions.push(action);
      }
      const protectedSurfaces: Array<[string, string, string]> = [
        ["session-state", "hooks/_session.json", "retained: active ownership cannot be proven from session state alone"],
        ["anatomy", "anatomy.md", "retained: rebuild requires a separately validated scanner transaction"],
        ["qa", "qa", "retained: generated evidence references are not fully provable"],
        ["designqc", "designqc-captures", "retained: current report ownership must be proven before deletion"],
        ["backups", "backups", "retained: pruning without an independent exact rollback archive is unsafe"],
      ];
      for (const [surface, relative, reason] of protectedSurfaces) {
        const target = path.join(entry.realRoot, ".wolf", relative);
        if (!fs.existsSync(target)) continue;
        const stat = fs.statSync(target);
        project.protections.push({ surface, path: target, reason, bytes: stat.isFile() ? stat.size : 0 });
      }
    } catch (error) {
      project.blocked = [error instanceof Error ? error.message : String(error)];
      project.actions = [];
    }
    return project;
  });
  const actions = projects.flatMap(project => project.actions);
  const eligible = projects.filter(project => project.eligible);
  const manifest: CompactManifest = {
    version: 1, policyVersion: POLICY_VERSION, generatedAt: new Date(now).toISOString(),
    target: options.root ? { mode: "root", root: path.resolve(options.root) } : { mode: "fleet" },
    ai: { enabled: Boolean(options.ai), model: options.ai ? options.model ?? DEFAULT_MODEL : null, adapter: options.ai ? "claude-cli" : null, promptSchemaVersion: options.ai ? 1 : null },
    projects,
    totals: {
      projectsEligible: eligible.length,
      projectsExcluded: projects.length - eligible.length,
      projectsBlocked: projects.filter(project => project.blocked?.length).length,
      actions: actions.length,
      bytesBefore: actions.reduce((n, action) => n + action.bytesBefore, 0),
      bytesAfterEstimated: actions.reduce((n, action) => n + action.bytesAfter, 0),
      bytesReclaimable: actions.reduce((n, action) => n + Math.max(0, action.bytesBefore - action.bytesAfter), 0),
      bytesArchived: actions.reduce((n, action) => n + action.bytesArchived, 0),
    },
  };
  return { manifest, hash: hashCompactManifest(manifest) };
}

function ensureInsideWolf(root: string, file: string): void {
  const wolf = path.resolve(root, ".wolf") + path.sep;
  const resolved = path.resolve(file);
  if (!resolved.startsWith(wolf)) throw new Error(`Compact path escapes .wolf: ${file}`);
}

function backupFile(file: string, backupDir: string, key: string): { path: string; present: boolean; sha256: string | null } {
  const bytes = readBytes(file);
  fs.mkdirSync(backupDir, { recursive: true });
  const state = { path: file, present: bytes !== undefined, sha256: sha(bytes) };
  const statePath = path.join(backupDir, `${key}.state.json`);
  const bytesPath = path.join(backupDir, `${key}.bytes`);
  if (!atomicWriteJson(statePath, state)) throw new Error(`Cannot write backup state for ${file}`);
  const savedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (stable(savedState) !== stable(state)) throw new Error(`Backup state verification failed for ${file}`);
  if (bytes !== undefined) {
    if (!atomicWriteBytes(bytesPath, bytes)) throw new Error(`Cannot write backup bytes for ${file}`);
    if (sha(fs.readFileSync(bytesPath)) !== state.sha256) throw new Error(`Backup byte verification failed for ${file}`);
  }
  return state;
}

function verify(file: string, expected: string | null): void {
  if (sha(readBytes(file)) !== expected) throw new Error(`Preimage changed: ${file}`);
}

function safeKey(action: CompactSurfacePlan): string { return action.kind.replace(/[^a-z0-9-]/gi, "-"); }

export async function applyCompactManifest(expectedHash: string, options: CompactOptions = {}): Promise<string> {
  const rebuilt = buildCompactManifest(options);
  if (rebuilt.hash !== expectedHash) throw new Error(`Manifest hash mismatch: expected ${expectedHash}, current ${rebuilt.hash}`);
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${expectedHash.slice(0, 10)}`;
  const fleetDir = path.join(os.homedir(), ".openwolf", "compact-transactions", id);
  fs.mkdirSync(fleetDir, { recursive: true });
  const outcomes: unknown[] = [];
  for (const project of rebuilt.manifest.projects.filter(item => item.eligible && item.actions.length)) {
    const wolfDir = path.join(project.realRoot, ".wolf");
    const releaseProject = acquireFileLock(path.join(wolfDir, ".compact"), { timeoutMs: 5000 });
    if (!releaseProject) { outcomes.push({ root: project.realRoot, status: "blocked", error: "compact lock unavailable" }); continue; }
    const releases: Array<() => void> = [];
    const completed: Array<Record<string, unknown>> = [];
    const backupDir = path.join(wolfDir, "backups", `compact-${id}`);
    try {
      for (const action of project.actions) {
        ensureInsideWolf(project.realRoot, action.livePath); ensureInsideWolf(project.realRoot, action.archivePath);
        fs.mkdirSync(path.dirname(action.archivePath), { recursive: true });
      }
      const lockedPaths = [
        ...new Set(project.actions.map(action => action.livePath).sort()),
        ...new Set(project.actions.map(action => action.archivePath).sort()),
      ];
      for (const lockedPath of lockedPaths) {
        const release = acquireFileLock(lockedPath, { timeoutMs: 5000 });
        if (!release) throw new Error(`Surface lock unavailable: ${lockedPath}`);
        releases.push(release);
      }
      for (const action of project.actions) { verify(action.livePath, action.before); verify(action.archivePath, action.archiveBefore); }
      fs.mkdirSync(backupDir, { recursive: true });
      if (!atomicWriteJson(path.join(backupDir, "manifest.json"), { manifestHash: expectedHash, project })) throw new Error("Cannot persist compact manifest backup");
      for (const action of project.actions) {
        const key = safeKey(action);
        backupFile(action.livePath, backupDir, `${key}.live`);
        backupFile(action.archivePath, backupDir, `${key}.archive`);
      }
      const config = parseConfig(project.realRoot);
      for (const action of project.actions) {
        const transformed = transformFor(action.kind, action.livePath, action.archivePath, config, options.now ?? Date.now());
        if (!transformed || sha(transformed.live) !== action.after || sha(transformed.archive) !== action.archiveAfter) throw new Error(`Planned transform changed: ${action.livePath}`);
        fs.mkdirSync(path.dirname(action.archivePath), { recursive: true });
        if (!atomicWriteBytes(action.archivePath, transformed.archive)) throw new Error(`Archive write failed: ${action.archivePath}`);
        verify(action.archivePath, action.archiveAfter);
        const progress: Record<string, unknown> = { kind: action.kind, livePath: action.livePath, archivePath: action.archivePath, before: action.before, after: action.after, archiveBefore: action.archiveBefore, archiveAfter: action.archiveAfter, archiveApplied: true, liveApplied: false };
        completed.push(progress);
        if (options.faultInjection?.afterArchiveKind === action.kind) throw new Error(`Injected failure after ${action.kind} archive write`);
        if (!atomicWriteBytes(action.livePath, transformed.live)) throw new Error(`Live write failed: ${action.livePath}`);
        verify(action.livePath, action.after);
        progress.liveApplied = true;
      }
      for (const release of releases.splice(0).reverse()) release();
      const ai = options.ai ? await summarizeProject(project, options.summarizer ?? new ClaudeCliSummarizer(), options.model ?? DEFAULT_MODEL, backupDir) : { attempted: false };
      const receipt = { version: 1, id, manifestHash: expectedHash, root: project.realRoot, status: "complete", completedAt: new Date().toISOString(), actions: completed, ai, backupDir };
      const receiptPath = path.join(wolfDir, "compact", "receipts", `${id}.json`);
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
      if (!atomicWriteJson(receiptPath, receipt)) throw new Error(`Receipt write failed: ${receiptPath}`);
      outcomes.push(receipt);
    } catch (error) {
      const failure = { version: 1, id, manifestHash: expectedHash, root: project.realRoot, status: "incomplete", failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), actions: completed, backupDir };
      const receiptPath = path.join(wolfDir, "compact", "receipts", `${id}.json`);
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
      atomicWriteJson(receiptPath, failure);
      outcomes.push(failure);
    } finally {
      for (const release of releases.reverse()) release();
      releaseProject();
    }
  }
  if (!atomicWriteJson(path.join(fleetDir, "receipt.json"), { version: 1, id, manifestHash: expectedHash, manifest: rebuilt.manifest, outcomes })) throw new Error("Fleet receipt write failed");
  return id;
}

async function summarizeProject(project: CompactProjectPlan, summarizer: Summarizer, model: string, backupDir: string): Promise<Record<string, unknown>> {
  try {
    const sources: Array<{ path: string; sha256: string; bytes: Buffer }> = [];
    for (const action of project.actions) {
      const releaseSource = acquireFileLock(action.archivePath, { timeoutMs: 5000 });
      if (!releaseSource) throw new Error(`summary source lock unavailable: ${action.archivePath}`);
      try {
        const bytes = fs.readFileSync(action.archivePath);
        if (sha(bytes) !== action.archiveAfter) throw new Error(`summary source changed: ${action.archivePath}`);
        sources.push({ path: action.archivePath, sha256: action.archiveAfter, bytes });
      } finally { releaseSource(); }
    }
    if (!sources.length) return { attempted: false };
    const result = await summarizer.summarize({ model, promptSchemaVersion: 1, sources, maxOutputBytes: 65_536 });
    const destination = path.join(project.realRoot, ".wolf", "summaries", "compact-summary.json");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const release = acquireFileLock(destination, { timeoutMs: 5000 });
    if (!release) throw new Error("summary lock unavailable");
    try {
      const before = sha(readBytes(destination));
      backupFile(destination, backupDir, "ai-summary");
      const envelope = { version: 1, generatedAt: new Date().toISOString(), model: result.model, sourceHashes: sources.map(source => source.sha256), summary: result.text, summaryHash: sha(Buffer.from(result.text)) };
      if (!atomicWriteJson(destination, envelope)) throw new Error("summary write failed");
      return { attempted: true, succeeded: true, destination, before, after: sha(readBytes(destination)), summaryHash: envelope.summaryHash };
    } finally { release(); }
  } catch (error) {
    return { attempted: true, succeeded: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function restoreState(backupDir: string, key: string, expectedPost: string | null): void {
  const statePath = path.join(backupDir, `${key}.state.json`);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as { path: string; present: boolean; sha256: string | null };
  verify(state.path, expectedPost);
  if (!state.present) {
    if (fs.existsSync(state.path)) fs.unlinkSync(state.path);
    return;
  }
  const bytes = fs.readFileSync(path.join(backupDir, `${key}.bytes`));
  if (sha(bytes) !== state.sha256 || !atomicWriteBytes(state.path, bytes)) throw new Error(`Backup restore failed: ${state.path}`);
}

export function rollbackCompactTransaction(id: string): void {
  const fleetPath = path.join(os.homedir(), ".openwolf", "compact-transactions", id, "receipt.json");
  const fleet = JSON.parse(fs.readFileSync(fleetPath, "utf8")) as { outcomes: any[] };
  for (const outcome of fleet.outcomes.filter(item => (item.status === "complete" || item.status === "incomplete") && item.actions?.length).reverse()) {
    const release = acquireFileLock(path.join(outcome.root, ".wolf", ".compact"), { timeoutMs: 5000 });
    if (!release) throw new Error(`Compact lock unavailable: ${outcome.root}`);
    const surfaceReleases: Array<() => void> = [];
    try {
      const files = [
        ...new Set(outcome.actions.map((action: any) => action.livePath).sort()),
        ...new Set(outcome.actions.map((action: any) => action.archivePath).sort()),
      ];
      if (outcome.ai?.succeeded && !files.includes(outcome.ai.destination)) files.push(outcome.ai.destination);
      for (const file of files) {
        const surfaceRelease = acquireFileLock(file, { timeoutMs: 5000 });
        if (!surfaceRelease) throw new Error(`Surface lock unavailable: ${file}`);
        surfaceReleases.push(surfaceRelease);
      }
      for (const action of outcome.actions) {
        verify(action.livePath, action.liveApplied ? action.after : action.before);
        verify(action.archivePath, action.archiveAfter);
      }
      if (outcome.ai?.succeeded) verify(outcome.ai.destination, outcome.ai.after);
      for (const action of [...outcome.actions].reverse()) {
        const key = String(action.kind).replace(/[^a-z0-9-]/gi, "-");
        restoreState(outcome.backupDir, `${key}.archive`, action.archiveAfter);
        restoreState(outcome.backupDir, `${key}.live`, action.liveApplied ? action.after : action.before);
      }
      if (outcome.ai?.succeeded) restoreState(outcome.backupDir, "ai-summary", outcome.ai.after);
      const receiptPath = path.join(outcome.root, ".wolf", "compact", "receipts", `${id}.rollback.json`);
      atomicWriteJson(receiptPath, { version: 1, id, rolledBackAt: new Date().toISOString() });
    } finally {
      for (const surfaceRelease of surfaceReleases.reverse()) surfaceRelease();
      release();
    }
  }
}

export async function compactCommand(options: CompactOptions): Promise<void> {
  if (options.model && !options.ai) throw new Error("--model requires --ai");
  if (options.manifestHash && !options.apply) throw new Error("--manifest-hash requires --apply");
  if (options.rollback) {
    if (options.root || options.apply || options.manifestHash || options.ai || options.model) throw new Error("--rollback cannot be combined with planning or apply options");
    rollbackCompactTransaction(options.rollback);
    console.log(`Rolled back compact transaction ${options.rollback}`);
    return;
  }
  const { manifest, hash } = buildCompactManifest(options);
  if (!options.json) {
    console.log(`Compact manifest: ${hash}`);
    console.log(`Target: ${manifest.target.mode === "fleet" ? "eligible registry fleet" : manifest.target.root}`);
    console.log(`Eligible: ${manifest.totals.projectsEligible}; excluded: ${manifest.totals.projectsExcluded}; blocked: ${manifest.totals.projectsBlocked}; actions: ${manifest.totals.actions}`);
    console.log(`Live bytes: ${manifest.totals.bytesBefore} -> ${manifest.totals.bytesAfterEstimated}; reclaimable: ${manifest.totals.bytesReclaimable}; archived: ${manifest.totals.bytesArchived}`);
    for (const project of manifest.projects.filter(item => !item.eligible)) console.log(`  excluded ${project.root}: ${project.reason}`);
    for (const project of manifest.projects.filter(item => item.actions.length || item.protections.length)) {
      const actions = project.actions.map(action => `${action.kind}(${action.records})`).join(", ") || "no safe mutations";
      console.log(`  ${project.root}: ${actions}; protected=${project.protections.length}`);
    }
  }
  if (!options.apply) {
    if (options.json) console.log(JSON.stringify({ hash, manifest }, null, 2));
    else console.log(`Dry run only. Apply with: wolfpack compact --apply --manifest-hash ${hash}${options.root ? ` --root ${JSON.stringify(options.root)}` : ""}${options.ai ? ` --ai --model ${options.model ?? DEFAULT_MODEL}` : ""}`);
    return;
  }
  if (!options.manifestHash) throw new Error("--apply requires --manifest-hash");
  const id = await applyCompactManifest(options.manifestHash, options);
  if (options.json) console.log(JSON.stringify({ hash, manifest, transactionId: id }, null, 2));
  else console.log(`Applied compact transaction ${id}`);
}
