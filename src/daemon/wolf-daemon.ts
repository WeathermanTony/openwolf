import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
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
      auth_token?: string | null;
    };
    dashboard: { enabled: boolean; port: number };
    cron: { enabled: boolean; heartbeat_interval_minutes: number };
  };
}

const config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {
  openwolf: {
    daemon: { port: 18790, log_level: "info", auth_token: null },
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

const AUTH_TOKEN_BYTES = 32;
const REDACTED = "[redacted]";

function validAuthToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 32;
}

function ensureDaemonAuthToken(): string {
  if (validAuthToken(config.openwolf.daemon.auth_token)) return config.openwolf.daemon.auth_token;
  const token = crypto.randomBytes(AUTH_TOKEN_BYTES).toString("base64url");
  config.openwolf.daemon.auth_token = token;
  const configPath = path.join(wolfDir, "config.json");
  const existing = readJSON<Record<string, any>>(configPath, {});
  existing.openwolf = existing.openwolf && typeof existing.openwolf === "object" ? existing.openwolf : {};
  existing.openwolf.daemon = existing.openwolf.daemon && typeof existing.openwolf.daemon === "object" ? existing.openwolf.daemon : {};
  existing.openwolf.daemon.auth_token = token;
  writeJSON(configPath, existing);
  return token;
}

const daemonAuthToken = ensureDaemonAuthToken();
const allowedHosts = new Set([
  `localhost:${config.openwolf.dashboard.port}`,
  `127.0.0.1:${config.openwolf.dashboard.port}`,
  `[::1]:${config.openwolf.dashboard.port}`,
]);
const allowedOrigins = new Set([...allowedHosts].map((host) => `http://${host}`));

function timingSafeTokenEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractBearerToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const headerToken = req.header("x-openwolf-token");
  return headerToken?.trim() || null;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestHasValidHost(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const host = headerValue(req.headers.host);
  return typeof host === "string" && allowedHosts.has(host.toLowerCase());
}

function requestHasAllowedOrigin(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const origin = headerValue(req.headers.origin);
  return typeof origin !== "string" || allowedOrigins.has(origin.toLowerCase());
}

function tokenIsValid(token: string | null): boolean {
  return token !== null && timingSafeTokenEqual(token, daemonAuthToken);
}

function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  if (!requestHasValidHost(req) || !requestHasAllowedOrigin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!tokenIsValid(extractBearerToken(req))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|api[_-]?key|auth/i.test(key)) out[key] = REDACTED;
      else out[key] = redactSecrets(entry);
    }
    return out;
  }
  return value;
}

function readDashboardFile(file: string): string {
  try {
    const content = fs.readFileSync(path.join(wolfDir, file), "utf-8");
    if (file.endsWith(".json")) {
      try { return JSON.stringify(redactSecrets(JSON.parse(content)), null, 2); } catch {}
    }
    return content;
  } catch {
    return "";
  }
}

function sendDashboardIndex(res: Response): void {
  const indexPath = path.join(dashboardDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    res.status(404).json({ error: "Dashboard not built. Run: pnpm build:dashboard" });
    return;
  }
  const html = fs.readFileSync(indexPath, "utf-8");
  const runtime = `<script>window.__OPENWOLF_DAEMON__=${JSON.stringify({ token: daemonAuthToken })};</script>`;
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(html.includes("</head>") ? html.replace("</head>", `${runtime}</head>`) : `${runtime}${html}`);
}

function authenticateWebSocketRequest(req: { headers: Record<string, string | string[] | undefined>; url?: string }): boolean {
  if (!requestHasValidHost(req) || !requestHasAllowedOrigin(req)) return false;
  const host = headerValue(req.headers.host) ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return tokenIsValid(url.searchParams.get("token"));
}

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
  app.get("/", (_req, res) => sendDashboardIndex(res));
  app.use(express.static(dashboardDir, { index: false }));
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

app.get("/api/project", requireDashboardAuth, (_req, res) => {
  res.json({
    name: projectMeta.name,
    description: projectMeta.description,
    root: projectRoot,
  });
});

app.get("/api/files", requireDashboardAuth, (_req, res) => {
  const files: Record<string, string> = {};
  const wolfFiles = [
    "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
    "config.json", "token-ledger.json", "buglog.json",
    "cron-manifest.json", "cron-state.json",
    "designqc-report.json",
  ];
  for (const file of wolfFiles) {
    try {
      files[file] = readDashboardFile(file);
    } catch {
      files[file] = "";
    }
  }
  // Also try suggestions.json
  try {
    files["suggestions.json"] = readDashboardFile("suggestions.json");
  } catch {
    files["suggestions.json"] = "";
  }
  res.json(files);
});

app.get("/api/designqc-report", requireDashboardAuth, (_req, res) => {
  const report = readJSON(path.join(wolfDir, "designqc-report.json"), null);
  res.json(report);
});

// Trigger a cron task by ID
app.post("/api/cron/run/:taskId", requireDashboardAuth, (req, res) => {
  const taskId = String(req.params.taskId);
  if (!cronEngine) {
    res.status(503).json({ error: "Cron engine not running" });
    return;
  }
  cronEngine.runTask(taskId).then((result) => {
    const status = result === "not_found" ? 404 : result === "stopped" ? 503 : result.startsWith("skipped") ? 409 : 200;
    res.status(status).json({ status: result, task_id: taskId });
  }).catch((err) => {
    res.status(500).json({ error: String(err) });
  });
});

// SPA fallback
app.get("/{*path}", (_req, res) => {
  const indexPath = path.join(dashboardDir, "index.html");
  if (fs.existsSync(indexPath)) {
    sendDashboardIndex(res);
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
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  if (!authenticateWebSocketRequest(req)) {
    ws.close(1008, "Unauthorized");
    return;
  }
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
  ws.send(JSON.stringify({ type: "daemon_started", timestamp: new Date().toISOString() }));
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
        if (!cronEngine) {
          logger.warn(`Dead-letter retry requested while cron engine is stopped: ${taskId}`);
          return;
        }
        const hadEntry = await hasDeadLetterEntry(wolfDir, taskId);
        if (!hadEntry) {
          logger.warn(`Retry requested for missing dead-letter task: ${taskId}`);
          return;
        }
        const result = await cronEngine.runTask(taskId).catch((err): TaskRunResult => {
          logger.error(`Dead-letter retry failed: ${err}`);
          return "failed";
        });
        if (["completed", "retry_scheduled", "dead_lettered"].includes(result)) {
          await removeDeadLetterEntry(wolfDir, taskId);
        } else {
          logger.warn(`Keeping dead-letter entry for ${taskId}; retry outcome was ${result}`);
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
            files[file] = readDashboardFile(file);
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
const fileWatcher = startFileWatcher(wolfDir, logger, broadcast);

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
  await fileWatcher.close().catch((err) => logger.error(`File watcher close failed: ${err}`));

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
