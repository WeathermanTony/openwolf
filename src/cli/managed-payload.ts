import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { HOOK_PAYLOAD_FILES, HOOK_UTILITY_FILES } from "./hook-manifest.js";

export const MANAGED_TEMPLATE_FILES = ["OPENWOLF.md", "reframe-frameworks.md", ".gitignore"] as const;
export const CREATE_IF_MISSING_FILES = [
  "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
  "token-ledger.json", "buglog.json", "reviewlog.json", "cron-manifest.json", "cron-state.json",
  "suggestions.json", "designqc-report.json",
] as const;
// Hook and runtime-utility payloads are owned by hook-manifest.ts; re-exported
// here so cleanup code and init/update cannot drift onto separate lists.
export const MANAGED_HOOK_FILES = HOOK_PAYLOAD_FILES;
export const MANAGED_RUNTIME_UTILITIES = HOOK_UTILITY_FILES;

export interface ObsoletePayloadEntry {
  destination: string;
  knownPreimages: readonly string[];
  reason: string;
}

export const OBSOLETE_PAYLOAD: readonly ObsoletePayloadEntry[] = [
  {
    destination: ".wolf/PROTOCOL-UPGRADE-2026-06.md",
    knownPreimages: ["ca9ab949831dcc8b07653f720339d9fed61bcaee321476649fb14ec20e708c72"],
    reason: "historical protocol migration document",
  },
  {
    destination: ".wolf/utils/fs-safe.js",
    knownPreimages: [
      "cf8cacf92f2adf2857fc4b67e0f5b48526ce8639f417bf2bd341d86052ef359a",
      "eda8c6b199c4ff4c82ad148a16a51bf1e1fa307e5a0b1592ac1b4aad066167f0",
      "ef074480737159a72755ca70396acd9fade5a0e8475a29f5d1ed84f617d2c5de",
    ],
    reason: "CLI utility not imported by installed hooks",
  },
  {
    destination: ".wolf/utils/logger.js",
    knownPreimages: ["9ca95b5d1769e3e2354079f5e445d7ff5702b466713ef5ecb1710a09a516aead"],
    reason: "CLI utility not imported by installed hooks",
  },
  {
    destination: ".wolf/utils/paths.js",
    knownPreimages: ["fbc2877cc4526dd7a5f6e560e6b618ebd1d0704d6f90d4a57a22537bc70e640f"],
    reason: "CLI utility not imported by installed hooks",
  },
  {
    destination: ".wolf/utils/platform.js",
    knownPreimages: ["1c35f213494aca74f6ac3bc173128bd5429f51f3bbdc136b9edbe0d3a2e94826"],
    reason: "CLI utility not imported by installed hooks",
  },
  {
    destination: ".wolf/utils/port-allocator.js",
    knownPreimages: [
      "005b9611663913234c2aa8e6c76e07ad8e0e4080ec84dd83c1f5938c28fdae93",
      "33b13eb12cc935dcf5532ba9a64e2fb1715a9982d233e9beec1dcbfa0ca1f903",
      "fbe91c662a095e871f313328e959f82e4354872f9fde9737dceab22ca9cd4d94",
    ],
    reason: "CLI utility not imported by installed hooks",
  },
] as const;

export type CleanupDisposition = "absent" | "delete-owned" | "preserve-modified" | "preserve-symlink" | "preserve-unknown" | "error";
export interface CleanupItem {
  path: string;
  destination: string;
  disposition: CleanupDisposition;
  sha256: string | null;
  matchedPreimage: string | null;
  reason: string;
  error?: string;
}
export interface ProjectCleanupPlan { root: string; items: CleanupItem[]; }
export interface ManagedPayloadCleanupManifest { version: 1; projects: ProjectCleanupPlan[]; }

function sha(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function classifyObsoletePath(root: string, entry: ObsoletePayloadEntry): CleanupItem {
  const target = path.join(root, ...entry.destination.split("/"));
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return { path: target, destination: entry.destination, disposition: "preserve-symlink", sha256: null, matchedPreimage: null, reason: entry.reason };
    if (!stat.isFile()) return { path: target, destination: entry.destination, disposition: "preserve-unknown", sha256: null, matchedPreimage: null, reason: entry.reason };
    const digest = sha(fs.readFileSync(target));
    const matched = entry.knownPreimages.includes(digest) ? digest : null;
    return { path: target, destination: entry.destination, disposition: matched ? "delete-owned" : "preserve-modified", sha256: digest, matchedPreimage: matched, reason: entry.reason };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: target, destination: entry.destination, disposition: "absent", sha256: null, matchedPreimage: null, reason: entry.reason };
    return { path: target, destination: entry.destination, disposition: "error", sha256: null, matchedPreimage: null, reason: entry.reason, error: error instanceof Error ? error.message : String(error) };
  }
}

export function buildManagedPayloadCleanupManifest(roots: readonly string[]): { manifest: ManagedPayloadCleanupManifest; hash: string } {
  const projects = [...roots].map(root => path.resolve(root)).sort().map(root => ({
    root,
    items: OBSOLETE_PAYLOAD.map(entry => classifyObsoletePath(root, entry)),
  }));
  const manifest: ManagedPayloadCleanupManifest = { version: 1, projects };
  return { manifest, hash: sha(Buffer.from(stable(manifest))) };
}

function cleanupBackupPath(item: CleanupItem, root: string, backupDir: string): string {
  const relativeToWolf = path.relative(path.join(root, ".wolf"), item.path);
  if (relativeToWolf.startsWith("..") || path.isAbsolute(relativeToWolf)) throw new Error(`Cleanup path escaped .wolf: ${item.path}`);
  return path.join(backupDir, relativeToWolf);
}

function verifyBackup(item: CleanupItem, root: string, backupDir: string): string {
  const backupPath = cleanupBackupPath(item, root, backupDir);
  if (!fs.existsSync(backupPath)) throw new Error(`Cleanup backup missing: ${backupPath}`);
  const digest = sha(fs.readFileSync(backupPath));
  if (digest !== item.sha256) throw new Error(`Cleanup backup hash mismatch: ${backupPath}`);
  return backupPath;
}

export function applyManagedPayloadCleanup(expectedHash: string, roots: readonly string[], backupDirs: ReadonlyMap<string, string>, io: { unlink?: (file: string) => void } = {}): { removed: string[]; preserved: CleanupItem[] } {
  const { manifest, hash } = buildManagedPayloadCleanupManifest(roots);
  if (hash !== expectedHash) throw new Error(`Cleanup manifest hash mismatch: expected ${expectedHash}, current ${hash}`);
  const errors = manifest.projects.flatMap(project => project.items.filter(item => item.disposition === "error"));
  if (errors.length > 0) throw new Error(`Cleanup could not inspect ${errors[0].path}: ${errors[0].error ?? "unknown error"}`);
  const pendingDeletes: Array<{ item: CleanupItem; backupPath: string }> = [];
  const preserved: CleanupItem[] = [];
  for (const project of manifest.projects) {
    const backupDir = backupDirs.get(project.root);
    if (!backupDir) throw new Error(`Cleanup backup unavailable for ${project.root}`);
    for (const item of project.items) {
      if (item.disposition !== "delete-owned") {
        if (item.disposition !== "absent") preserved.push(item);
        continue;
      }
      const entry = OBSOLETE_PAYLOAD.find(candidate => candidate.destination === item.destination);
      if (!entry) throw new Error(`Cleanup payload entry unavailable: ${item.destination}`);
      const current = classifyObsoletePath(project.root, entry);
      if (current.disposition !== "delete-owned" || current.sha256 !== item.sha256) throw new Error(`Cleanup preimage changed: ${item.path}`);
      const backupPath = verifyBackup(item, project.root, backupDir);
      pendingDeletes.push({ item, backupPath });
    }
  }

  const unlink = io.unlink ?? fs.unlinkSync;
  const removed: Array<{ item: CleanupItem; backupPath: string }> = [];
  try {
    for (const pending of pendingDeletes) {
      unlink(pending.item.path);
      removed.push(pending);
    }
  } catch (error) {
    const restoreErrors: string[] = [];
    for (const deleted of [...removed].reverse()) {
      try {
        fs.copyFileSync(deleted.backupPath, deleted.item.path);
        const restored = sha(fs.readFileSync(deleted.item.path));
        if (restored !== deleted.item.sha256) throw new Error(`restored hash ${restored} did not match ${deleted.item.sha256}`);
      } catch (restoreError) {
        restoreErrors.push(`${deleted.item.path}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    const cause = error instanceof Error ? error.message : String(error);
    const recovery = restoreErrors.length > 0 ? `; rollback failures: ${restoreErrors.join("; ")}` : "; prior deletions restored";
    throw new Error(`Cleanup deletion failed: ${cause}${recovery}`);
  }
  return { removed: removed.map(({ item }) => item.path), preserved };
}
