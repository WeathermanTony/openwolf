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

interface Pm2ProcessInfo {
  name?: string;
  pm2_env?: {
    status?: string;
    pm_id?: number;
    restart_time?: number;
    pm_cwd?: string;
    OPENWOLF_PROJECT_ROOT?: string;
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

function listPm2Processes(): Pm2ProcessInfo[] {
  try {
    const output = execSync("pm2 jlist", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(output) as Pm2ProcessInfo[];
  } catch {
    return [];
  }
}

function sameProjectRoot(proc: Pm2ProcessInfo, projectRoot: string): boolean {
  const expected = normalizeProjectRoot(projectRoot);
  const envRoot = proc.pm2_env?.OPENWOLF_PROJECT_ROOT;
  const cwd = proc.pm2_env?.pm_cwd;
  return (envRoot !== undefined && normalizeProjectRoot(envRoot) === expected)
    || (cwd !== undefined && normalizeProjectRoot(cwd) === expected);
}

function getPm2Process(name: string, projectRoot: string): Pm2ProcessInfo | null {
  return listPm2Processes().find((proc) => proc.name === name && sameProjectRoot(proc, projectRoot)) ?? null;
}

function isActivePm2Process(proc: Pm2ProcessInfo | null): boolean {
  const status = proc?.pm2_env?.status;
  return proc !== null && status !== "stopped" && status !== "errored";
}

function getOpenWolfPm2Process(projectRoot: string): Pm2ProcessInfo | null {
  const hash = getPm2Process(getPm2NameForRoot(projectRoot), projectRoot);
  const legacy = getPm2Process(getLegacyPm2Name(projectRoot), projectRoot);
  if (isActivePm2Process(legacy) && !isActivePm2Process(hash)) return legacy;
  return hash ?? legacy;
}

function pm2Target(proc: Pm2ProcessInfo | null, fallbackName: string): string {
  const pmId = proc?.pm2_env?.pm_id;
  return Number.isInteger(pmId) ? String(pmId) : shellQuote(fallbackName);
}

function hasStopExitCodeZero(proc: Pm2ProcessInfo): boolean {
  const codes = proc.pm2_env?.stop_exit_codes;
  return Array.isArray(codes) ? codes.includes(0) : codes === 0;
}

export function hasOpenWolfPm2Daemon(projectRoot: string): boolean {
  return isActivePm2Process(getOpenWolfPm2Process(projectRoot));
}

export function ensurePm2Daemon(projectRoot: string, options: { silent?: boolean } = {}): Pm2EnsureResult {
  const name = getPm2NameForRoot(projectRoot);
  const daemonScript = path.resolve(__dirname, "..", "daemon", "wolf-daemon.js");
  const existing = getOpenWolfPm2Process(projectRoot);
  const existingName = existing?.name ?? name;
  const existingStatus = existing?.pm2_env?.status;

  if (existing && existingStatus !== "stopped" && existingStatus !== "errored" && existingName === name && hasStopExitCodeZero(existing)) {
    if (!options.silent) {
      console.log(`  ✓ Daemon already registered: ${existingName} (status ${existingStatus ?? "unknown"}, pid ${existing.pid ?? "unknown"})`);
    }
    return { status: "already-running", name: existingName };
  }

  const env = { ...process.env, OPENWOLF_PROJECT_ROOT: projectRoot };
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

async function autoMigrateLegacyPorts(wolfDir: string, projectRoot: string): Promise<void> {
  const configPath = path.join(wolfDir, "config.json");
  if (!fs.existsSync(configPath)) return;
  const cfg = readJSON<{ openwolf: { daemon: { port: number }; dashboard: { port: number } } }>(
    configPath,
    { openwolf: { daemon: { port: 18790 }, dashboard: { port: 18791 } } }
  );
  const legacy =
    cfg.openwolf.dashboard.port === 18791 && cfg.openwolf.daemon.port === 18790;
  if (!legacy) return;
  // Only migrate if the legacy port is actually taken by some other process.
  // First-mover on 18791 keeps backward-compat behavior.
  const free = await isPortFree(18791);
  if (free) return;
  try {
    const { daemon, dashboard } = await allocateProjectPorts(projectRoot);
    cfg.openwolf.daemon.port = daemon;
    cfg.openwolf.dashboard.port = dashboard;
    writeJSON(configPath, cfg);
    console.log(`  ℹ Port 18791 is in use by another project; migrated this project to daemon=${daemon}, dashboard=${dashboard}`);
  } catch (e) {
    console.warn(`  ⚠ Port migration failed (${(e as Error).message}); daemon start will likely fail with EADDRINUSE`);
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
    await autoMigrateLegacyPorts(wolfDir, projectRoot);
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
        execSync(`pm2 stop ${pm2Target(proc, name)}`, { stdio: "ignore" });
        console.log(`  ✓ Daemon stopped (PM2): ${name}`);
        return;
      } catch {
        // PM2 process stop failed — fall through to port-based stop
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
    await autoMigrateLegacyPorts(wolfDir, projectRoot);
  }

  // First try PM2
  if (hasPm2()) {
    const proc = getOpenWolfPm2Process(projectRoot);
    const name = proc?.name ?? getPm2NameForRoot(projectRoot);
    if (proc) {
      try {
        execSync(`pm2 delete ${pm2Target(proc, name)}`, { stdio: "ignore" });
        execSync(`pm2 start ${shellQuote(path.resolve(__dirname, "..", "daemon", "wolf-daemon.js"))} --name ${shellQuote(getPm2NameForRoot(projectRoot))} --cwd ${shellQuote(projectRoot)} --stop-exit-codes 0`, {
          stdio: "ignore",
          env: { ...process.env, OPENWOLF_PROJECT_ROOT: projectRoot },
        });
        execSync("pm2 save", { stdio: "ignore" });
        console.log(`  ✓ Daemon restarted (PM2): ${name}`);
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
