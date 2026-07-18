import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import {
  ensurePm2Daemon,
  hasOpenWolfPm2Daemon,
  hasPm2,
  prepareDaemonPorts,
} from "./daemon-cmd.js";

interface WolfConfig {
  openwolf: {
    dashboard: { port: number };
  };
}

function normalizeRoot(root: string): string {
  try { return fs.realpathSync.native(root); } catch { return path.resolve(root); }
}

function isExpectedDashboard(port: number, projectRoot: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { if (body.length < 8192) body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { status?: string; project_root?: string };
          resolve(res.statusCode === 200 && parsed.status === "healthy"
            && typeof parsed.project_root === "string"
            && normalizeRoot(parsed.project_root) === normalizeRoot(projectRoot));
        } catch {
          resolve(false);
        }
      });
    });
    req.once("timeout", () => { req.destroy(); resolve(false); });
    req.once("error", () => resolve(false));
  });
}

async function waitForDashboard(port: number, projectRoot: string): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    if (await isExpectedDashboard(port, projectRoot)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

export async function dashboardCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  let config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {
    openwolf: { dashboard: { port: 18791 } },
  });
  let port = config.openwolf.dashboard.port;

  if (await isExpectedDashboard(port, projectRoot)) {
    return openDashboard(port);
  }

  if (!hasPm2()) {
    console.log("PM2 is only required for the optional dashboard/background service.");
    console.log("Install it with: pnpm add -g pm2");
    return;
  }

  if (hasOpenWolfPm2Daemon(projectRoot)) {
    console.log("  Managed daemon is not serving the configured dashboard port; enabling its dashboard...");
  } else {
    console.log("  Starting the optional dashboard service through PM2...");
    await prepareDaemonPorts(wolfDir, projectRoot);
  }
  ensurePm2Daemon(projectRoot, { silent: true, dashboard: true });

  config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), config);
  port = config.openwolf.dashboard.port;
  if (!(await waitForDashboard(port, projectRoot))) {
    console.log("  Dashboard service did not become ready in time.");
    console.log("  Inspect it with: openwolf daemon logs");
    return;
  }

  console.log(`  ✓ Dashboard service running on port ${port}`);
  console.log("  It remains active until: openwolf daemon stop");
  await openDashboard(port);
}

async function openDashboard(port: number): Promise<void> {
  const url = `http://localhost:${port}`;
  console.log(`  Opening ${url}...`);
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    console.log(`  Could not open browser. Visit: ${url}`);
  }
}
