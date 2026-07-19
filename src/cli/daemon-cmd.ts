import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
import { isWindows } from "../utils/platform.js";
import { allocateProjectPorts, isPortFree } from "../utils/port-allocator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDashboardPort(): number {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");
  const config = readJSON<{ openwolf: { dashboard: { port: number } } }>(
    path.join(wolfDir, "config.json"),
    { openwolf: { dashboard: { port: 18791 } } }
  );
  return config.openwolf.dashboard.port;
}

function normalizeProjectRoot(projectRoot: string): string {
  const resolved = (() => {
    try { return fs.realpathSync.native(projectRoot); } catch { return path.resolve(projectRoot); }
  })();
  return isWindows() ? resolved.toLowerCase() : resolved;
}

export function getPm2NameForRoot(projectRoot: string): string {
  const normalized = normalizeProjectRoot(projectRoot);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `openwolf-${path.basename(normalized)}-${hash}`;
}

function getLegacyPm2Name(projectRoot: string): string {
  return `openwolf-${path.basename(normalizeProjectRoot(projectRoot))}`;
}

function getPm2Name(): string {
  return getPm2NameForRoot(findProjectRoot());
}

export function hasPm2(): boolean {
  try {
    const cmd = isWindows() ? "where pm2" : "which pm2";
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface Pm2ProcessInfo {
  name?: string;
  pm2_env?: {
    status?: string;
    pm_id?: number;
    restart_time?: number;
    pm_cwd?: string;
    pm_exec_path?: string;
    OPENWOLF_PROJECT_ROOT?: string;
    OPENWOLF_DASHBOARD_ENABLED?: string;
    stop_exit_codes?: number | number[];
  };
  pid?: number;
}

interface Pm2EnsureResult {
  status: "started" | "already-running" | "restarted";
  name: string;
}

function shellQuote(value: string): string {
  if (isWindows()) return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function listPm2Processes(): Pm2ProcessInfo[] {
  try {
    const output = execSync("pm2 jlist", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(output) as Pm2ProcessInfo[];
  } catch {
    return [];
  }
}

function sameProjectRoot(proc: Pm2ProcessInfo, projectRoot: string): boolean {
  const root = recordedProjectRoot(proc);
  return root !== null && normalizeProjectRoot(root) === normalizeProjectRoot(projectRoot);
}

function getPm2Process(processes: Pm2ProcessInfo[], name: string, projectRoot: string): Pm2ProcessInfo | null {
  return processes.find((proc) => proc.name === name && sameProjectRoot(proc, projectRoot)) ?? null;
}

export function isActivePm2Process(proc: Pm2ProcessInfo | null): proc is Pm2ProcessInfo & { pid: number } {
  if (proc === null || proc.pm2_env?.status !== "online") return false;
  const pid = proc.pid;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0;
}

export function isDashboardPm2Process(proc: Pm2ProcessInfo | null): boolean {
  return proc?.pm2_env?.OPENWOLF_DASHBOARD_ENABLED === "1";
}

export function getOpenWolfPm2Process(projectRoot: string, processes = listPm2Processes()): Pm2ProcessInfo | null {
  const hash = getPm2Process(processes, getPm2NameForRoot(projectRoot), projectRoot);
  const legacy = getPm2Process(processes, getLegacyPm2Name(projectRoot), projectRoot);
  if (isActivePm2Process(legacy) && !isActivePm2Process(hash)) return legacy;
  return hash ?? legacy;
}

function pm2Target(proc: Pm2ProcessInfo | null, fallbackName: string): string {
  const pmId = proc?.pm2_env?.pm_id;
  return Number.isInteger(pmId) ? String(pmId) : shellQuote(fallbackName);
}

function recordedProjectRoot(proc: Pm2ProcessInfo): string | null {
  const script = proc.pm2_env?.pm_exec_path;
  const wolfProcess = typeof script === "string" && /(?:^|[\\/])wolf-daemon\.js$/.test(script)
    && typeof proc.name === "string" && proc.name.startsWith("openwolf-");
  if (!wolfProcess) return null;
  const envRoot = proc.pm2_env?.OPENWOLF_PROJECT_ROOT;
  if (typeof envRoot === "string" && path.isAbsolute(envRoot)) return envRoot;
  const cwd = proc.pm2_env?.pm_cwd;
  return typeof cwd === "string" && path.isAbsolute(cwd) ? cwd : null;
}

export function ownedPm2ProcessesForRoot(processes: Pm2ProcessInfo[], projectRoot: string): Pm2ProcessInfo[] {
  const expected = normalizeProjectRoot(projectRoot);
  return processes.filter((proc) => {
    const root = recordedProjectRoot(proc);
    return root !== null && normalizeProjectRoot(root) === expected;
  });
}

export function ownedPm2ProcessForRoot(processes: Pm2ProcessInfo[], projectRoot: string): Pm2ProcessInfo | null {
  return ownedPm2ProcessesForRoot(processes, projectRoot)[0] ?? null;
}

export function staleOpenWolfPm2Processes(processes: Pm2ProcessInfo[]): Pm2ProcessInfo[] {
  return processes.filter((proc) => {
    const root = recordedProjectRoot(proc);
    return root !== null && !fs.existsSync(path.join(root, ".wolf"));
  });
}

export interface Pm2CleanupResult {
  removed: string[];
  notFound: string[];
  staleFound: number;
}

export function cleanupOpenWolfPm2(options: {
  projectRoots?: string[];
  pruneStale?: boolean;
  dryRun?: boolean;
  processes?: Pm2ProcessInfo[];
} = {}): Pm2CleanupResult {
  if (!options.processes && !hasPm2()) {
    return { removed: [], notFound: options.projectRoots ?? [], staleFound: 0 };
  }
  const processes = options.processes ?? listPm2Processes();
  const candidates = new Map<number | string, Pm2ProcessInfo>();
  const notFound: string[] = [];

  for (const root of options.projectRoots ?? []) {
    const owned = ownedPm2ProcessesForRoot(processes, root);
    if (owned.length === 0) {
      notFound.push(root);
      continue;
    }
    for (const proc of owned) {
      const key = Number.isInteger(proc.pm2_env?.pm_id) ? proc.pm2_env!.pm_id! : proc.name ?? root;
      candidates.set(key, proc);
    }
  }
  const stale = options.pruneStale ? staleOpenWolfPm2Processes(processes) : [];
  for (const proc of stale) {
    const key = Number.isInteger(proc.pm2_env?.pm_id) ? proc.pm2_env!.pm_id! : proc.name ?? recordedProjectRoot(proc)!;
    candidates.set(key, proc);
  }

  const removed: string[] = [];
  let changed = false;
  for (const proc of candidates.values()) {
    const label = proc.name ?? recordedProjectRoot(proc)!;
    if (options.dryRun) {
      removed.push(label);
      continue;
    }
    try {
      execSync(`pm2 delete ${pm2Target(proc, label)}`, { stdio: "ignore" });
      removed.push(label);
      changed = true;
    } catch {
      // Process may have disappeared after the snapshot; continue cleaning others.
    }
  }
  if (!options.dryRun && changed) {
    try { execSync("pm2 save", { stdio: "ignore" }); } catch {}
  }
  return { removed, notFound, staleFound: stale.length };
}

function hasStopExitCodeZero(proc: Pm2ProcessInfo): boolean {
  const codes = proc.pm2_env?.stop_exit_codes;
  return Array.isArray(codes) ? codes.includes(0) : codes === 0;
}

export function hasOpenWolfPm2Daemon(projectRoot: string): boolean {
  return isActivePm2Process(getOpenWolfPm2Process(projectRoot));
}

export function ensurePm2Daemon(projectRoot: string, options: { silent?: boolean; dashboard?: boolean; forceRestart?: boolean } = {}): Pm2EnsureResult {
  const name = getPm2NameForRoot(projectRoot);
  const daemonScript = path.resolve(__dirname, "..", "daemon", "wolf-daemon.js");
  const existing = getOpenWolfPm2Process(projectRoot);
  const existingName = existing?.name ?? name;
  const existingStatus = existing?.pm2_env?.status;

  const dashboardModeMatches = isDashboardPm2Process(existing) === Boolean(options.dashboard);
  if (!options.forceRestart && isActivePm2Process(existing) && existingName === name && hasStopExitCodeZero(existing) && dashboardModeMatches) {
    if (!options.silent) {
      console.log(`  ✓ Daemon already registered: ${existingName} (status ${existingStatus ?? "unknown"}, pid ${existing.pid ?? "unknown"})`);
    }
    return { status: "already-running", name: existingName };
  }

  const env = {
    ...process.env,
    OPENWOLF_PROJECT_ROOT: projectRoot,
    OPENWOLF_DASHBOARD_ENABLED: options.dashboard ? "1" : "0",
  };
  if (existing) {
    execSync(`pm2 delete ${pm2Target(existing, existingName)}`, { stdio: "ignore" });
    execSync(`pm2 start ${shellQuote(daemonScript)} --name ${shellQuote(name)} --cwd ${shellQuote(projectRoot)} --stop-exit-codes 0`, {
      stdio: options.silent ? "ignore" : "inherit",
      env,
    });
    execSync("pm2 save", { stdio: "ignore" });
    if (!options.silent) console.log(`\n  ✓ Daemon restarted: ${existingName}`);
    return { status: "restarted", name: existingName };
  }

  execSync(`pm2 start ${shellQuote(daemonScript)} --name ${shellQuote(name)} --cwd ${shellQuote(projectRoot)} --stop-exit-codes 0`, {
    stdio: options.silent ? "ignore" : "inherit",
    env,
  });
  execSync("pm2 save", { stdio: "ignore" });
  if (!options.silent) console.log(`\n  ✓ Daemon started: ${name}`);
  return { status: "started", name };
}

function findPidOnPort(port: number): number | null {
  try {
    if (isWindows()) {
      const output = execSync(`netstat -ano -p tcp`, { encoding: "utf-8" });
      for (const line of output.split("\n")) {
        if (line.includes(`:${port}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid > 0) return pid;
        }
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, { encoding: "utf-8" });
      const pid = parseInt(output.trim(), 10);
      if (pid > 0) return pid;
    }
  } catch {}
  return null;
}

function killPid(pid: number): boolean {
  try {
    if (isWindows()) {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

export async function prepareDaemonPorts(wolfDir: string, projectRoot: string): Promise<void> {
  const configPath = path.join(wolfDir, "config.json");
  if (!fs.existsSync(configPath)) return;
  const cfg = readJSON<{ openwolf: { daemon: { port: number }; dashboard: { port: number } } }>(
    configPath,
    { openwolf: { daemon: { port: 18790 }, dashboard: { port: 18791 } } }
  );
  const dashboardFree = await isPortFree(cfg.openwolf.dashboard.port);
  const daemonFree = await isPortFree(cfg.openwolf.daemon.port);
  if (dashboardFree && daemonFree) return;
  try {
    const { daemon, dashboard } = await allocateProjectPorts(projectRoot);
    cfg.openwolf.daemon.port = daemon;
    cfg.openwolf.dashboard.port = dashboard;
    writeJSON(configPath, cfg);
    console.log(`  ℹ Configured ports are in use; allocated daemon=${daemon}, dashboard=${dashboard}`);
  } catch (e) {
    console.warn(`  ⚠ Port allocation failed (${(e as Error).message}); daemon start will likely fail with EADDRINUSE`);
  }
}

export async function daemonStart(): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  if (!hasPm2()) {
    console.log("pm2 not found. Install with: pnpm add -g pm2");
    return;
  }

  if (!hasOpenWolfPm2Daemon(projectRoot)) {
    await prepareDaemonPorts(wolfDir, projectRoot);
  }

  try {
    ensurePm2Daemon(projectRoot);
    if (isWindows()) {
      console.log("  Tip: Run 'pm2-windows-startup' for boot persistence.");
    }
  } catch (err) {
    console.error(`Failed to start daemon: ${(err as Error).message}`);
  }
}

export function daemonStop(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  // First try PM2
  if (hasPm2()) {
    const proc = getOpenWolfPm2Process(projectRoot);
    const name = proc?.name ?? getPm2NameForRoot(projectRoot);
    if (proc) {
      try {
        execSync(`pm2 delete ${pm2Target(proc, name)}`, { stdio: "ignore" });
        execSync("pm2 save", { stdio: "ignore" });
        console.log(`  ✓ Daemon removed from PM2: ${name}`);
        return;
      } catch {
        // PM2 process delete failed — fall through to port-based stop
      }
    }
  }

  const port = getDashboardPort();
  const pid = findPidOnPort(port);
  if (pid) {
    console.log(`  No matching OpenWolf PM2 daemon found for this project. Refusing to kill PID ${pid} on port ${port} without ownership proof.`);
  } else {
    console.log(`  No daemon running on port ${port}.`);
  }
}

export async function daemonRestart(): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  if (!hasOpenWolfPm2Daemon(projectRoot)) {
    await prepareDaemonPorts(wolfDir, projectRoot);
  }

  // Preserve the existing runtime mode when restarting through PM2.
  if (hasPm2()) {
    const proc = getOpenWolfPm2Process(projectRoot);
    if (proc) {
      try {
        const dashboard = isDashboardPm2Process(proc);
        const result = ensurePm2Daemon(projectRoot, { silent: true, dashboard, forceRestart: true });
        console.log(`  ✓ Daemon restarted (PM2): ${result.name}`);
        return;
      } catch {
        // PM2 process restart failed — fall through
      }
    }
  }

  const port = getDashboardPort();
  const pid = findPidOnPort(port);
  if (pid) {
    console.log(`  No matching OpenWolf PM2 daemon found for this project. Refusing to restart PID ${pid} on port ${port} without ownership proof.`);
  } else {
    console.log("  No matching PM2 daemon found. Use 'openwolf daemon start' to start a daemon.");
  }
}

export function daemonLogs(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  if (!hasPm2()) {
    console.log("pm2 not found.");
    return;
  }

  const proc = getOpenWolfPm2Process(projectRoot);
  const name = proc?.name ?? getPm2NameForRoot(projectRoot);
  try {
    execSync(`pm2 logs ${pm2Target(proc, name)} --lines 50 --nostream`, { stdio: "inherit" });
  } catch {
    console.error("Failed to get daemon logs.");
  }
}
