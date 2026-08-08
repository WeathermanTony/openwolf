import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { acquireFileLock, atomicWriteJson, atomicWriteText } from "../utils/size-discipline.js";

export type LedgerKind = "bug" | "review";
export type LedgerClassification = "clean" | "repairable" | "malformed" | "unreadable" | "lock-blocked";

interface LedgerSpec {
  kind: LedgerKind;
  file: string;
  arrayKey: string;
  prefix: string;
  width: number;
}

export interface LedgerRecord {
  index: number;
  id: string;
  digest: string;
  record: Record<string, unknown>;
}

export interface LedgerAudit {
  kind: LedgerKind;
  file: string;
  classification: LedgerClassification;
  recordCount: number;
  duplicateIds: Array<{ id: string; indices: number[]; exact: boolean }>;
  invalidIndices: number[];
  ambiguousReferences: Array<{ file: string; id: string; count: number }>;
  error?: string;
}

export interface RekeyMapping {
  index: number;
  digest: string;
  from: string;
  to: string;
}

export interface RepairPlan {
  kind: LedgerKind;
  file: string;
  classification: LedgerClassification;
  mappings: RekeyMapping[];
  recordCount: number;
  ambiguousReferences: LedgerAudit["ambiguousReferences"];
}

export interface RepairResult {
  kind: LedgerKind;
  classification: LedgerClassification;
  applied: boolean;
  verified: boolean;
  incompleteReceipt: boolean;
  recordCount: number;
  mappings: RekeyMapping[];
  ambiguousReferences: LedgerAudit["ambiguousReferences"];
  backupPath?: string;
  receiptPath?: string;
  error?: string;
}

function specFor(projectRoot: string, kind: LedgerKind): LedgerSpec {
  const base = kind === "bug"
    ? { file: "buglog.json", arrayKey: "bugs", prefix: "bug", width: 3 }
    : { file: "reviewlog.json", arrayKey: "reviews", prefix: "review", width: 4 };
  return { kind, ...base, file: path.join(projectRoot, ".wolf", base.file) };
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseId(id: unknown, spec: LedgerSpec): number | null {
  if (typeof id !== "string") return null;
  const match = new RegExp(`^${spec.prefix}-(\\d+)$`).exec(id);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function formatId(n: number, spec: LedgerSpec): string {
  return `${spec.prefix}-${String(n).padStart(spec.width, "0")}`;
}

function load(spec: LedgerSpec): { raw: string; document: Record<string, unknown>; records: LedgerRecord[] } | { error: string; unreadable: boolean } {
  let raw: string;
  try {
    raw = fs.readFileSync(spec.file, "utf8");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), unreadable: true };
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), unreadable: false };
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray((document as Record<string, unknown>)[spec.arrayKey])) {
    return { error: `expected object with ${spec.arrayKey} array`, unreadable: false };
  }
  const array = (document as Record<string, unknown>)[spec.arrayKey] as unknown[];
  const records: LedgerRecord[] = [];
  for (let index = 0; index < array.length; index++) {
    const record = array[index];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { error: `record ${index} is not an object`, unreadable: false };
    }
    records.push({ index, id: String((record as Record<string, unknown>).id ?? ""), digest: digest(record), record: record as Record<string, unknown> });
  }
  return { raw, document: document as Record<string, unknown>, records };
}

export function resolveLedgerRecords(records: LedgerRecord[], id: string): LedgerRecord[] {
  return records.filter((record) => record.id === id);
}

function duplicateGroups(records: LedgerRecord[]): LedgerAudit["duplicateIds"] {
  const groups = new Map<string, LedgerRecord[]>();
  for (const record of records) groups.set(record.id, [...(groups.get(record.id) ?? []), record]);
  return [...groups.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([id, matches]) => ({ id, indices: matches.map((record) => record.index), exact: new Set(matches.map((record) => record.digest)).size === 1 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function structuredReferenceCounts(text: string, wanted: Set<string>): Map<string, number> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  const counts = new Map<string, number>();
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === "string") {
      // A ledger record's primary ID identifies that record; it is not a
      // historical reference to an ambiguous occurrence. Other id-like fields
      // remain evidence and are intentionally counted.
      if (key !== "id" && wanted.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
    } else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(parsed);
  return counts;
}

function referenceInventory(projectRoot: string, duplicates: LedgerAudit["duplicateIds"]): LedgerAudit["ambiguousReferences"] {
  if (duplicates.length === 0) return [];
  const wanted = new Set(duplicates.map((group) => group.id));
  const root = path.join(projectRoot, ".wolf");
  const found: LedgerAudit["ambiguousReferences"] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === "backups" || entry.name === "archive" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || entry.name.endsWith(".lock")) continue;
      let text: string;
      try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
      const structured = entry.name === "buglog.json" || entry.name === "reviewlog.json" ? structuredReferenceCounts(text, wanted) : null;
      for (const id of wanted) {
        const count = structured ? (structured.get(id) ?? 0) : text.split(id).length - 1;
        if (count > 0) found.push({ file: path.relative(projectRoot, full).replace(/\\/g, "/"), id, count });
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
}

export function auditLedger(projectRoot: string, kind: LedgerKind): LedgerAudit {
  const spec = specFor(projectRoot, kind);
  const loaded = load(spec);
  if ("error" in loaded) return { kind, file: spec.file, classification: loaded.unreadable ? "unreadable" : "malformed", recordCount: 0, duplicateIds: [], invalidIndices: [], ambiguousReferences: [], error: loaded.error };
  const invalidIndices = loaded.records.filter((record) => parseId(record.id, spec) === null).map((record) => record.index);
  const duplicateIds = duplicateGroups(loaded.records);
  const classification: LedgerClassification = invalidIndices.length > 0 ? "malformed" : duplicateIds.length > 0 ? "repairable" : "clean";
  return { kind, file: spec.file, classification, recordCount: loaded.records.length, duplicateIds, invalidIndices, ambiguousReferences: referenceInventory(projectRoot, duplicateIds) };
}

export function planLedgerRepair(projectRoot: string, kind: LedgerKind): RepairPlan {
  const spec = specFor(projectRoot, kind);
  const audit = auditLedger(projectRoot, kind);
  if (audit.classification !== "repairable") return { kind, file: spec.file, classification: audit.classification, mappings: [], recordCount: audit.recordCount, ambiguousReferences: audit.ambiguousReferences };
  const loaded = load(spec);
  if ("error" in loaded) return { kind, file: spec.file, classification: "unreadable", mappings: [], recordCount: 0, ambiguousReferences: [] };
  const used = new Set(loaded.records.map((record) => parseId(record.id, spec)).filter((id): id is number => id !== null));
  let maxId = -1;
  for (const id of used) if (id > maxId) maxId = id;
  let next = maxId + 1;
  const seen = new Set<string>();
  const mappings: RekeyMapping[] = [];
  for (const record of loaded.records) {
    if (seen.has(record.id)) {
      while (used.has(next)) next++;
      const to = formatId(next++, spec);
      used.add(parseId(to, spec)!);
      mappings.push({ index: record.index, digest: record.digest, from: record.id, to });
    } else {
      seen.add(record.id);
    }
  }
  return { kind, file: spec.file, classification: "repairable", mappings, recordCount: loaded.records.length, ambiguousReferences: audit.ambiguousReferences };
}

export function repairLedger(projectRoot: string, kind: LedgerKind, apply = false): RepairResult {
  const spec = specFor(projectRoot, kind);
  const initial = planLedgerRepair(projectRoot, kind);
  if (!apply || initial.classification !== "repairable") {
    return { kind, classification: initial.classification, applied: false, verified: false, incompleteReceipt: false, recordCount: initial.recordCount, mappings: initial.mappings, ambiguousReferences: initial.ambiguousReferences };
  }
  const release = acquireFileLock(spec.file);
  if (!release) return { kind, classification: "lock-blocked", applied: false, verified: false, incompleteReceipt: false, recordCount: initial.recordCount, mappings: [], ambiguousReferences: initial.ambiguousReferences };
  try {
    const plan = planLedgerRepair(projectRoot, kind);
    if (plan.classification !== "repairable") return { kind, classification: plan.classification, applied: false, verified: false, incompleteReceipt: false, recordCount: plan.recordCount, mappings: plan.mappings, ambiguousReferences: plan.ambiguousReferences };
    const loaded = load(spec);
    if ("error" in loaded) return { kind, classification: loaded.unreadable ? "unreadable" : "malformed", applied: false, verified: false, incompleteReceipt: false, recordCount: 0, mappings: [], ambiguousReferences: plan.ambiguousReferences, error: loaded.error };
    const backupDir = path.join(projectRoot, ".wolf", "backups", `ledger-repair-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    const backupPath = path.join(backupDir, path.basename(spec.file));
    try { fs.mkdirSync(backupDir, { recursive: true }); } catch (error) { return { kind, classification: "repairable", applied: false, verified: false, incompleteReceipt: true, recordCount: plan.recordCount, mappings: plan.mappings, ambiguousReferences: plan.ambiguousReferences, error: error instanceof Error ? error.message : String(error) }; }
    if (!atomicWriteText(backupPath, loaded.raw)) return { kind, classification: "repairable", applied: false, verified: false, incompleteReceipt: true, recordCount: plan.recordCount, mappings: plan.mappings, ambiguousReferences: plan.ambiguousReferences, backupPath, error: "backup write failed" };
    if (sha256(fs.readFileSync(backupPath)) !== sha256(loaded.raw)) return { kind, classification: "repairable", applied: false, verified: false, incompleteReceipt: true, recordCount: plan.recordCount, mappings: plan.mappings, ambiguousReferences: plan.ambiguousReferences, backupPath, error: "backup verification failed" };
    const changed = JSON.parse(JSON.stringify(loaded.document)) as Record<string, unknown>;
    const records = changed[spec.arrayKey] as Array<Record<string, unknown>>;
    for (const mapping of plan.mappings) records[mapping.index].id = mapping.to;
    if (!atomicWriteJson(spec.file, changed)) return { kind, classification: "repairable", applied: false, verified: false, incompleteReceipt: true, recordCount: plan.recordCount, mappings: plan.mappings, ambiguousReferences: plan.ambiguousReferences, backupPath, error: "ledger write failed; backup retained" };
    const after = auditLedger(projectRoot, kind);
    const reloaded = load(spec);
    const expectedIds = new Map(plan.mappings.map((mapping) => [mapping.index, mapping.to]));
    const payloadDigest = (record: Record<string, unknown>) => {
      const { id: _id, ...payload } = record;
      return digest(payload);
    };
    const recordsPreserved = !("error" in reloaded) && reloaded.records.length === loaded.records.length
      && reloaded.records.every((record, index) => payloadDigest(record.record) === payloadDigest(loaded.records[index].record));
    const expectedMapping = !("error" in reloaded) && reloaded.records.every((record) => record.id === (expectedIds.get(record.index) ?? loaded.records[record.index].id));
    const verified = after.classification === "clean" && after.recordCount === plan.recordCount && recordsPreserved && expectedMapping;
    const receiptPath = path.join(backupDir, `${kind}-receipt.json`);
    const receipt = { version: 1, kind, before_hash: sha256(loaded.raw), backup_hash: sha256(fs.readFileSync(backupPath)), after_hash: sha256(fs.readFileSync(spec.file)), before_count: plan.recordCount, after_count: after.recordCount, mappings: plan.mappings, ambiguous_references: plan.ambiguousReferences, verification: { clean: after.classification === "clean", count_preserved: after.recordCount === plan.recordCount, records_preserved: recordsPreserved, expected_mapping: expectedMapping, verified } };
    const receiptOk = atomicWriteJson(receiptPath, receipt);
    return { kind, classification: after.classification, applied: true, verified, incompleteReceipt: !receiptOk, recordCount: after.recordCount, mappings: plan.mappings, ambiguousReferences: plan.ambiguousReferences, backupPath, receiptPath: receiptOk ? receiptPath : undefined, error: verified && receiptOk ? undefined : "post-write verification or receipt failed; backup retained" };
  } finally {
    release();
  }
}

export function auditProjectLedgers(projectRoot: string): LedgerAudit[] {
  return [auditLedger(projectRoot, "bug"), auditLedger(projectRoot, "review")];
}
