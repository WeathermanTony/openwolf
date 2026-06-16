import * as fs from "node:fs";
import * as path from "node:path";
import { watch } from "chokidar";
import type { FSWatcher } from "chokidar";
import { readJSON } from "../utils/fs-safe.js";
import type { Logger } from "../utils/logger.js";

export function startFileWatcher(
  wolfDir: string,
  logger: Logger,
  broadcast: (msg: unknown) => void
): FSWatcher {
  const watcher = watch(wolfDir, {
    ignoreInitial: true,
    ignored: [
      "**/hooks/_session.json",
      "**/*.tmp",
      "**/*.lock",
      "**/*.pid",
      "**/daemon.log",
      "**/cron-state.json",
      "**/qa/_gate-log.json",
      "**/archive/**",
    ],
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("change", (filePath) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    const fileName = path.basename(filePath as string);
    logger.debug(`File changed: ${relativePath}`);

    try {
      const stat = fs.statSync(filePath as string);
      const timestamp = new Date().toISOString();
      if (stat.size > 256 * 1024) {
        broadcast({
          type: "file_changed",
          file: relativePath,
          size: stat.size,
          content_truncated: true,
          timestamp,
        });
        return;
      }
      const content = fs.readFileSync(filePath as string, "utf-8");
      broadcast({
        type: "file_changed",
        file: relativePath,
        content,
        timestamp,
      });
    } catch {
      // File might be in process of being written
    }

    // Hot-reload config
    if (fileName === "config.json") {
      logger.info("Config changed — hot-reload not fully implemented yet");
    }

    // Hot-reload cron manifest
    if (fileName === "cron-manifest.json") {
      logger.info("Cron manifest changed — restart daemon to apply");
    }
  });

  watcher.on("add", (filePath) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    logger.debug(`File added: ${relativePath}`);
  });

  watcher.on("unlink", (filePath) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    logger.debug(`File removed: ${relativePath}`);
  });

  watcher.on("error", (err) => {
    logger.error(`File watcher error: ${err}`);
  });

  logger.info("File watcher started on .wolf/");
  return watcher;
}
