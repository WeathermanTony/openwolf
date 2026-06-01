import { createHash } from "node:crypto";
import * as net from "node:net";

const DASHBOARD_PORT_BASE = 18000;
const DASHBOARD_PORT_SPAN = 1000;
const MAX_PROBE = 100;

export function deterministicBasePort(projectRoot: string): number {
  const h = createHash("sha256").update(projectRoot).digest();
  return DASHBOARD_PORT_BASE + (h.readUInt16BE(0) % DASHBOARD_PORT_SPAN);
}

export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

export async function allocateProjectPorts(
  projectRoot: string
): Promise<{ daemon: number; dashboard: number }> {
  const base = deterministicBasePort(projectRoot);
  for (let i = 0; i < MAX_PROBE; i++) {
    const dashboard = base + i;
    const daemon = dashboard - 1;
    if (await isPortFree(dashboard) && await isPortFree(daemon)) {
      return { daemon, dashboard };
    }
  }
  throw new Error(
    `Could not find free port pair near ${base} after ${MAX_PROBE} probes`
  );
}
