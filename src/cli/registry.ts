/**
 * Central registry of all OpenWolf-managed projects.
 * Stored at ~/.openwolf/registry.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { acquireFileLock, atomicWriteJson } from "../utils/size-discipline.js";

export interface RegisteredProject {
  root: string;
  name: string;
  registered_at: string;
  last_updated: string;
  version: string;
}

export interface Registry {
  version: number;
  projects: RegisteredProject[];
}

export function getRegistryDir(): string {
  return path.join(os.homedir(), ".openwolf");
}

export function getRegistryPath(): string {
  return path.join(getRegistryDir(), "registry.json");
}

export function readRegistry(): Registry {
  const registryPath = getRegistryPath();
  let parsed: Registry;
  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    parsed = JSON.parse(raw) as Registry;
  } catch {
    return { version: 1, projects: [] };
  }
  if (!parsed || !Array.isArray(parsed.projects)) {
    return { version: 1, projects: [] };
  }
  // Structurally malformed entries (missing/renamed root or name) crash every
  // consumer downstream (path.join(undefined), p.root.toLowerCase()). Filter
  // them at the single read point so all commands are protected; the next
  // writeRegistry from any caller persists the cleanup (bug-440).
  const valid = parsed.projects.filter(isWellFormedEntry);
  const dropped = parsed.projects.length - valid.length;
  if (dropped > 0) {
    console.error(`OpenWolf: skipped ${dropped} malformed registry ${dropped === 1 ? "entry" : "entries"} (missing name/root) in ${registryPath}; cleanup persists on the next registry write.`);
  }
  return { ...parsed, projects: valid };
}

function isWellFormedEntry(p: unknown): p is RegisteredProject {
  if (!p || typeof p !== "object") return false;
  const entry = p as RegisteredProject;
  return typeof entry.root === "string" && entry.root.length > 0
    && typeof entry.name === "string" && entry.name.length > 0;
}

export function writeRegistry(registry: Registry): void {
  fs.mkdirSync(getRegistryDir(), { recursive: true });
  if (!atomicWriteJson(getRegistryPath(), registry)) {
    throw new Error(`Could not persist OpenWolf registry at ${getRegistryPath()}`);
  }
}

function mutateRegistry(mutator: (registry: Registry) => void): void {
  fs.mkdirSync(getRegistryDir(), { recursive: true });
  const registryPath = getRegistryPath();
  const release = acquireFileLock(registryPath, { timeoutMs: 5_000 });
  if (!release) throw new Error(`Could not acquire OpenWolf registry lock at ${registryPath}.lock`);
  try {
    let registry: Registry;
    try {
      const raw = fs.readFileSync(registryPath, "utf-8");
      const parsed = JSON.parse(raw) as Registry;
      if (!parsed || !Array.isArray(parsed.projects)) throw new Error("expected a projects array");
      registry = { ...parsed, projects: parsed.projects.filter(isWellFormedEntry) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        registry = { version: 1, projects: [] };
      } else {
        throw new Error(`Refusing to replace malformed or unreadable OpenWolf registry at ${registryPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    mutator(registry);
    writeRegistry(registry);
  } finally {
    release();
  }
}

/**
 * Register a project in the central registry.
 * Updates existing entry if the project root matches.
 */
export function registerProject(projectRoot: string, name: string, version: string): void {
  const normalized = normalizePath(projectRoot);
  const now = new Date().toISOString();
  mutateRegistry((registry) => {
    const existing = registry.projects.find(p => normalizePath(p.root) === normalized);
    if (existing) {
      existing.name = name;
      existing.last_updated = now;
      existing.version = version;
    } else {
      registry.projects.push({
        root: projectRoot,
        name,
        registered_at: now,
        last_updated: now,
        version,
      });
    }
  });
}

/**
 * Remove a project from the registry (e.g., if the directory no longer exists).
 */
export function unregisterProject(projectRoot: string): void {
  const normalized = normalizePath(projectRoot);
  mutateRegistry((registry) => {
    registry.projects = registry.projects.filter(p => normalizePath(p.root) !== normalized);
  });
}

/**
 * Get all registered projects, optionally filtering out ones that no longer exist.
 */
export function getRegisteredProjects(validateExists: boolean = false): RegisteredProject[] {
  const registry = readRegistry();
  if (!validateExists) return registry.projects;

  const valid: RegisteredProject[] = [];
  const removed: string[] = [];

  for (const project of registry.projects) {
    const wolfDir = path.join(project.root, ".wolf");
    if (fs.existsSync(wolfDir)) {
      valid.push(project);
    } else {
      removed.push(project.root);
    }
  }

  // Clean up against a fresh under-lock snapshot so a concurrent registration
  // cannot be erased by this earlier read.
  if (removed.length > 0) {
    mutateRegistry((current) => {
      current.projects = current.projects.filter(project => fs.existsSync(path.join(project.root, ".wolf")));
    });
  }

  return valid;
}

export function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/").toLowerCase();
}

export type FleetExclusionReason =
  | "missing"
  | "missing-wolf-directory"
  | "archive"
  | "worktree"
  | "source-checkout"
  | "duplicate-real-root"
  | "invalid-root";

export interface FleetEligibility {
  project: RegisteredProject;
  eligible: boolean;
  realRoot: string;
  reason?: FleetExclusionReason;
}

function realPath(value: string): string {
  const resolved = path.resolve(value);
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
}

export function classifyFleetProjects(
  projects: RegisteredProject[],
  sourceRoot?: string,
): FleetEligibility[] {
  const source = sourceRoot ? normalizePath(realPath(sourceRoot)) : undefined;
  const seen = new Set<string>();
  return projects.map(project => {
    if (!project.root || !path.isAbsolute(project.root)) {
      return { project, eligible: false, realRoot: project.root ?? "", reason: "invalid-root" };
    }
    const resolved = realPath(project.root);
    const normalized = normalizePath(resolved);
    const segments = normalized.split("/").filter(Boolean);
    let reason: FleetExclusionReason | undefined;
    if (!fs.existsSync(project.root)) reason = "missing";
    else if (!fs.existsSync(path.join(project.root, ".wolf"))) reason = "missing-wolf-directory";
    else if (segments.some(segment => segment === "archive" || segment === "archived" || segment === ".archived")) reason = "archive";
    else if (normalized.includes("/.claude/worktrees/")) reason = "worktree";
    else if (source && normalized === source) reason = "source-checkout";
    else if (seen.has(normalized)) reason = "duplicate-real-root";
    if (!reason) seen.add(normalized);
    return { project, eligible: !reason, realRoot: resolved, reason };
  });
}
