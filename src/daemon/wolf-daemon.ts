import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { Logger } from "../utils/logger.js";
import { isWindows } from "../utils/platform.js";
import { CronEngine, hasDeadLetterEntry, normalizeCronState, removeDeadLetterEntry, updateCronState } from "./cron-engine.js";
import type { TaskRunResult } from "./cron-engine.js";
import { startFileWatcher } from "./file-watcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer explicit OPENWOLF_PROJECT_ROOT env (set by CLI commands) over cwd detection
const projectRoot = process.env.OPENWOLF_PROJECT_ROOT || findProjectRoot();
const wolfDir = path.join(projectRoot, ".wolf");

interface WolfConfig {
  openwolf: {
    daemon: {
      port: number;
      log_level: string;
      log_max_bytes?: number;       // rotate when daemon.log exceeds this (0 = disabled)
      log_keep_rotations?: number;  // how many .N files to retain (older are dropped)
    };
    dashboard: { enabled: boolean; port: number };
    cron: { enabled: boolean; heartbeat_interval_minutes: number };
  };
}

const config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {
  openwolf: {
    daemon: { port: 18790, log_level: "info" },
    dashboard: { enabled: true, port: 18791 },
    cron: { enabled: true, heartbeat_interval_minutes: 30 },
  },
});

const logger = new Logger(
  path.join(wolfDir, "daemon.log"),
  config.openwolf.daemon.log_level as "debug" | "info" | "warn" | "error",
  {
    maxBytes: config.openwolf.daemon.log_max_bytes,
    keepRotations: config.openwolf.daemon.log_keep_rotations,
  },
);

interface DaemonLock {
  pid: number;
  projectRoot: string;
  startedAt: string;
}

function normalizeProjectRoot(root: string): string {
  const resolved = (() => {
    try { return fs.realpathSync.native(root); } catch { return path.resolve(root); }
  })();
  return isWindows() ? resolved.toLowerCase() : resolved;
}

const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
const daemonLockPath = path.join(wolfDir, "daemon.pid");

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === "EPERM";
  }
}

function readDaemonLock(): DaemonLock | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(daemonLockPath, "utf-8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (!Number.isInteger(candidate.pid) || (candidate.pid as number) <= 0) return null;
    if (typeof candidate.projectRoot !== "string" || candidate.projectRoot.length === 0) return null;
    if (typeof candidate.startedAt !== "string") return null;
    return candidate as unknown as DaemonLock;
  } catch {
    return null;
  }
}

function acquireDaemonSingleton(): void {
  const lock: DaemonLock = {
    pid: process.pid,
    projectRoot,
    startedAt: new Date().toISOString(),
  };
  const content = JSON.stringify(lock, null, 2);

  try {
    const fd = fs.openSync(daemonLockPath, "wx");
    try {
      fs.writeFileSync(fd, content, "utf-8");
    } finally {
      fs.closeSync(fd);
    }
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "EEXIST") throw err;
  }

  const existingRaw = (() => {
    try { return fs.readFileSync(daemonLockPath, "utf-8"); } catch { return null; }
  })();
  const existing = existingRaw ? readDaemonLock() : null;
  if (existing !== null && normalizeProjectRoot(existing.projectRoot) === normalizedProjectRoot && isPidAlive(existing.pid)) {
    const message = `OpenWolf daemon already running for ${projectRoot} as pid ${existing.pid}; exiting duplicate pid ${process.pid}`;
    logger.warn(message);
    console.warn(message);
    process.exit(0);
  }

  const malformedLockIsOld = (() => {
    if (existingRaw === null || existing !== null) return false;
    try { return Date.now() - fs.statSync(daemonLockPath).mtimeMs > 5000; } catch { return false; }
  })();

  if (existingRaw !== null
    && ((existing !== null && normalizeProjectRoot(existing.projectRoot) === normalizedProjectRoot && !isPidAlive(existing.pid)) || malformedLockIsOld)) {
    logger.warn(existing !== null
      ? `Reclaiming stale daemon lock from pid ${existing.pid}`
      : "Reclaiming malformed stale daemon lock");
    try {
      if (fs.readFileSync(daemonLockPath, "utf-8") === existingRaw) {
        fs.unlinkSync(daemonLockPath);
      }
    } catch (err) {
      logger.error(`Could not reclaim stale daemon lock ${daemonLockPath}: ${(err as Error).message}`);
      process.exit(0);
    }
  } else if (existingRaw !== null && existing === null) {
    logger.error(`Malformed daemon lock ${daemonLockPath}; leaving it in place to avoid racing another startup`);
    process.exit(0);
  }

  try {
    const fd = fs.openSync(daemonLockPath, "wx");
    try {
      fs.writeFileSync(fd, content, "utf-8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    logger.error(`Could not acquire daemon lock ${daemonLockPath}: ${(err as Error).message}`);
    process.exit(0);
  }
}

function releaseDaemonSingleton(): void {
  const current = readDaemonLock();
  if (current?.pid === process.pid && normalizeProjectRoot(current.projectRoot) === normalizedProjectRoot) {
    try { fs.unlinkSync(daemonLockPath); } catch {}
  }
}

acquireDaemonSingleton();

const startTime = Date.now();
const wsClients = new Set<WebSocket>();

// Express server
const app = express();
app.use(express.json());

// Serve dashboard static files
// In dist: dist/src/daemon/wolf-daemon.js → ../../../dist/dashboard/
const dashboardDir = path.resolve(__dirname, "..", "..", "..", "dist", "dashboard");
if (fs.existsSync(dashboardDir)) {
  app.use(express.static(dashboardDir));
}

// Detect project metadata
function detectProjectMeta(): { name: string; description: string } {
  let name = path.basename(projectRoot);
  let description = "";

  // Try package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    if (pkg.name) name = pkg.name;
    if (pkg.description) description = pkg.description;
  } catch {}

  // Try Cargo.toml for name if not found
  if (name === path.basename(projectRoot)) {
    try {
      const cargo = fs.readFileSync(path.join(projectRoot, "Cargo.toml"), "utf-8");
      const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) name = nameMatch[1];
    } catch {}
  }

  // If no description, try cerebrum.md project description
  if (!description) {
    try {
      const cerebrum = fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8");
      const descMatch = cerebrum.match(/\*\*Project:\*\*\s*(.+)/);
      if (descMatch) description = descMatch[1].trim();
    } catch {}
  }

  // If still no description, try README first paragraph
  if (!description) {
    for (const readme of ["README.md", "readme.md", "README.rst"]) {
      try {
        const content = fs.readFileSync(path.join(projectRoot, readme), "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("!") && !trimmed.startsWith("=") && !trimmed.startsWith("-") && !trimmed.startsWith("<") && !trimmed.startsWith("[") && !trimmed.startsWith("```") && trimmed.length > 10) {
            description = trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
            break;
          }
        }
        if (description) break;
      } catch {}
    }
  }

  return { name, description };
}

const projectMeta = detectProjectMeta();

// API routes
app.get("/api/health", (_req, res) => {
  const cronState = normalizeCronState(readJSON<unknown>(
    path.join(wolfDir, "cron-state.json"),
    { engine_status: "unknown", last_heartbeat: null, dead_letter_queue: [] }
  ));
  const cronManifest = readJSON<{ tasks?: unknown[] }>(
    path.join(wolfDir, "cron-manifest.json"),
    { tasks: [] }
  );
  const taskCount = Array.isArray(cronManifest.tasks) ? cronManifest.tasks.length : 0;
  res.json({
    status: "healthy",
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    last_heartbeat: cronState.last_heartbeat ?? null,
    tasks: taskCount,
    dead_letters: cronState.dead_letter_queue.length,
  });
});

app.get("/api/project", (_req, res) => {
  res.json({
    name: projectMeta.name,
    description: projectMeta.description,
    root: projectRoot,
  });
});

app.get("/api/files", (_req, res) => {
  const files: Record<string, string> = {};
  const wolfFiles = [
    "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
    "config.json", "token-ledger.json", "buglog.json",
    "cron-manifest.json", "cron-state.json",
    "designqc-report.json",
  ];
  for (const file of wolfFiles) {
    try {
      files[file] = fs.readFileSync(path.join(wolfDir, file), "utf-8");
    } catch {
      files[file] = "";
    }
  }
  // Also try suggestions.json
  try {
    files["suggestions.json"] = fs.readFileSync(path.join(wolfDir, "suggestions.json"), "utf-8");
  } catch {
    files["suggestions.json"] = "";
  }
  res.json(files);
});

app.get("/api/designqc-report", (_req, res) => {
  const report = readJSON(path.join(wolfDir, "designqc-report.json"), null);
  res.json(report);
});

// Trigger a cron task by ID
app.post("/api/cron/run/:taskId", (req, res) => {
  const { taskId } = req.params;
  if (!cronEngine) {
    res.status(503).json({ error: "Cron engine not running" });
    return;
  }
  cronEngine.runTask(taskId).then(() => {
    res.json({ status: "ok", task_id: taskId });
  }).catch((err) => {
    res.status(500).json({ error: String(err) });
  });
});

// SPA fallback
app.get("/{*path}", (_req, res) => {
  const indexPath = path.join(dashboardDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: "Dashboard not built. Run: pnpm build:dashboard" });
  }
});

// Start HTTP server
const port = config.openwolf.dashboard.port;
const server = app.listen(port, "127.0.0.1", () => {
  logger.info(`Dashboard server listening on 127.0.0.1:${port}`);
});

server.on("error", (err) => {
  logger.error(`Dashboard server failed on port ${port}: ${(err as Error).message}`);
  releaseDaemonSingleton();
  process.exit(0);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  wsClients.add(ws);
  logger.info("WebSocket client connected");

  ws.on("message", (data) => {
    void (async () => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; task_id?: string };
        await handleDashboardCommand(msg);
      } catch (err) {
        logger.error(`Dashboard command failed: ${err}`);
      }
    })();
  });

  ws.on("close", () => {
    wsClients.delete(ws);
  });

  // Send initial state
  broadcast({ type: "daemon_started", timestamp: new Date().toISOString() });
});

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

async function handleDashboardCommand(msg: { type: string; task_id?: string }): Promise<void> {
  switch (msg.type) {
    case "trigger_task":
      if (msg.task_id && cronEngine) {
        cronEngine.runTask(msg.task_id).catch((err) => {
          logger.error(`Manual task trigger failed: ${err}`);
        });
      }
      break;
    case "retry_dead_letter":
      if (msg.task_id) {
        const taskId = msg.task_id;
        await updateCronState(wolfDir, (state) => {
          const taskIdsBefore = state.dead_letter_queue.length;
          state.dead_letter_queue = state.dead_letter_queue.filter((d) => d.task_id !== taskId);
          if (state.dead_letter_queue.length === taskIdsBefore) {
            logger.warn(`Retry requested for missing dead-letter task: ${taskId}`);
            return;
          }
        });
        if (cronEngine) {
          await cronEngine.runTask(taskId).catch((err) => {
            logger.error(`Dead-letter retry failed: ${err}`);
          });
        } else {
          logger.warn(`Dead-letter retry requested while cron engine is stopped: ${taskId}`);
        }
      }
      break;
    case "force_scan":
      if (cronEngine) {
        cronEngine.runTask("anatomy-rescan").catch((err) => {
          logger.error(`Force scan failed: ${err}`);
        });
      }
      break;
    case "request_full_state":
      // Send all files
      try {
        const files: Record<string, string> = {};
        const wolfFiles = [
          "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
          "config.json", "token-ledger.json", "buglog.json",
          "cron-manifest.json", "cron-state.json",
          "designqc-report.json",
        ];
        for (const file of wolfFiles) {
          try {
            files[file] = fs.readFileSync(path.join(wolfDir, file), "utf-8");
          } catch {
            files[file] = "";
          }
        }
        broadcast({ type: "full_state", files, timestamp: new Date().toISOString() });
      } catch (err) {
        logger.error(`Full state request failed: ${err}`);
      }
      break;
  }
}

// Cron engine
let cronEngine: CronEngine | null = null;
if (config.openwolf.cron.enabled) {
  cronEngine = new CronEngine(wolfDir, projectRoot, logger, broadcast);
  cronEngine.start();
}

// File watcher
startFileWatcher(wolfDir, logger, broadcast);

// Health heartbeat
const configuredHeartbeatMinutes = Number(config.openwolf.cron.heartbeat_interval_minutes);
const validHeartbeatMinutes = Number.isInteger(configuredHeartbeatMinutes)
  && configuredHeartbeatMinutes >= 1
  && configuredHeartbeatMinutes <= 1440;
const heartbeatInterval = validHeartbeatMinutes
  ? configuredHeartbeatMinutes * 60 * 1000
  : 30 * 60 * 1000;
if (!validHeartbeatMinutes) {
  logger.warn(`Invalid cron heartbeat interval ${config.openwolf.cron.heartbeat_interval_minutes}; using 30 minutes`);
}
const heartbeatTimer = setInterval(() => {
  updateCronState(wolfDir, (state) => {
    state.last_heartbeat = new Date().toISOString();
  }).catch((err) => {
    logger.error(`Cron heartbeat failed: ${err}`);
  });
  broadcast({ type: "health", status: "healthy", uptime: Math.floor((Date.now() - startTime) / 1000) });
}, heartbeatInterval);

// Update cron-state to running
updateCronState(wolfDir, (state) => {
  state.engine_status = "running";
  state.last_heartbeat = new Date().toISOString();
}).catch((err) => {
  logger.error(`Could not initialize cron state: ${err}`);
});

logger.info(`OpenWolf daemon started pid=${process.pid} project=${projectRoot} dashboard_port=${port}`);

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info("Daemon shutting down...");
  broadcast({ type: "daemon_stopping", timestamp: new Date().toISOString() });

  clearInterval(heartbeatTimer);
  if (cronEngine) cronEngine.stop();

  try {
    await updateCronState(wolfDir, (state) => {
      state.engine_status = "stopped";
    });
  } catch (err) {
    logger.error(`Could not write stopped cron state: ${err}`);
  } finally {
    releaseDaemonSingleton();
  }

  for (const client of wsClients) {
    client.close();
  }
  wsClients.clear();

  server.close(() => {
    logger.info("Daemon stopped");
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => {
    releaseDaemonSingleton();
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
