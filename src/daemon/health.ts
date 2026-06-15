import * as path from "node:path";
import { readJSON } from "../utils/fs-safe.js";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime_seconds: number;
  last_heartbeat: string | null;
  tasks: number;
  dead_letters: number;
}

export function getHealth(wolfDir: string, startTime: number): HealthStatus {
  const cronState = readJSON<{
    last_heartbeat: string | null;
    dead_letter_queue: unknown[];
  }>(path.join(wolfDir, "cron-state.json"), {
    last_heartbeat: null,
    dead_letter_queue: [],
  });

  const manifest = readJSON<{ tasks: unknown[] }>(
    path.join(wolfDir, "cron-manifest.json"),
    { tasks: [] }
  );

  const deadLetterCount = cronState.dead_letter_queue.length;
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (deadLetterCount > 0) status = "degraded";
  if (deadLetterCount > 3) status = "unhealthy";

  return {
    status,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    last_heartbeat: cronState.last_heartbeat,
    tasks: manifest.tasks.length,
    dead_letters: deadLetterCount,
  };
}
