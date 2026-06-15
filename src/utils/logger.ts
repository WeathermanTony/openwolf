import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerRotation {
  maxBytes: number;     // rotate when current log exceeds this size (0 = disabled)
  keepRotations: number; // how many .N rotated files to retain (oldest pruned)
}

const DEFAULT_ROTATION: LoggerRotation = {
  maxBytes: 10 * 1024 * 1024, // 10 MB per file
  keepRotations: 3,            // .1, .2, .3 (≤40 MB total per project)
};

export class Logger {
  private logFile: string | null;
  private level: LogLevel;
  private rotation: LoggerRotation;
  // Counter starts at the threshold so the FIRST write triggers a size check.
  // Critical for handling existing bloated logs at daemon startup — without
  // this, a daemon attached to a 200 MB stale log would append 100 more lines
  // before noticing it should rotate.
  private rotateChecksSinceWrite = 100;

  constructor(
    logFile: string | null,
    level: LogLevel = "info",
    rotation: Partial<LoggerRotation> = {},
  ) {
    this.logFile = logFile;
    this.level = level;
    this.rotation = { ...DEFAULT_ROTATION, ...rotation };
    if (logFile) {
      const dir = path.dirname(logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private format(level: LogLevel, message: string): string {
    const ts = new Date().toISOString();
    return `[${ts}] [${level.toUpperCase()}] ${message}`;
  }

  // Rotate: foo.log → foo.log.1 → foo.log.2 → ... → drop oldest beyond keepRotations.
  // Called from write() when log size exceeds maxBytes. Best-effort: on any error
  // we silently continue appending to the original file (logging must never throw
  // and crash the daemon — that's how the May 18-21 metatrader crashloop started).
  private rotateIfNeeded(): void {
    if (!this.logFile) return;
    if (this.rotation.maxBytes <= 0) return;
    // Amortize: only stat every 100 writes (or when the previous rotate failed
    // and we don't know the current size).
    if (this.rotateChecksSinceWrite++ < 100) return;
    this.rotateChecksSinceWrite = 0;
    try {
      const st = fs.statSync(this.logFile);
      if (st.size < this.rotation.maxBytes) return;
      // Shift .N → .(N+1), oldest gets dropped.
      for (let i = this.rotation.keepRotations; i >= 1; i--) {
        const src = i === 1 ? this.logFile : `${this.logFile}.${i - 1}`;
        const dst = `${this.logFile}.${i}`;
        if (!fs.existsSync(src)) continue;
        if (i === this.rotation.keepRotations && fs.existsSync(dst)) {
          fs.unlinkSync(dst);
        }
        try { fs.renameSync(src, dst); } catch { /* keep going */ }
      }
      // After the shift, this.logFile no longer exists; the next appendFileSync
      // will recreate it.
    } catch {
      // stat failed (file missing, perm error) — nothing to rotate. Next write
      // recreates the file or appends to whatever survived.
    }
  }

  private write(level: LogLevel, message: string): void {
    if (!this.shouldLog(level)) return;
    const line = this.format(level, message);
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
    if (this.logFile) {
      this.rotateIfNeeded();
      try {
        fs.appendFileSync(this.logFile, line + "\n", "utf-8");
      } catch {
        // Disk full / perm error / file vanished mid-rotate — drop the line
        // rather than crash. Logging must not be a daemon crash vector.
      }
    }
  }

  debug(msg: string): void { this.write("debug", msg); }
  info(msg: string): void { this.write("info", msg); }
  warn(msg: string): void { this.write("warn", msg); }
  error(msg: string): void { this.write("error", msg); }
}
