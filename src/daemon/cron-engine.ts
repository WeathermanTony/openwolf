import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import cron from "node-cron";
import { readJSON, writeJSON, readText, writeText, appendText } from "../utils/fs-safe.js";
import { scanProject } from "../scanner/anatomy-scanner.js";
import { detectWaste } from "../tracker/waste-detector.js";
import type { Logger } from "../utils/logger.js";

interface CronAction {
  type: string;
  params?: Record<string, unknown>;
}

interface CronTask {
  id: string;
  name: string;
  schedule: string;
  description: string;
  action: CronAction;
  retry: { max_attempts: number; backoff: string; base_delay_seconds: number };
  failsafe: { on_failure: string; dead_letter?: boolean; alert_after_consecutive_failures?: number };
  enabled: boolean;
}

interface CronManifest {
  version: number;
  tasks: CronTask[];
}

export type TaskRunResult = "not_found" | "stopped" | "skipped_active" | "skipped_pending_retry" | "retry_scheduled" | "completed" | "dead_lettered";

interface ExecutionEntry {
  task_id: string;
  status: "success" | "failed";
  timestamp: string;
  duration_ms: number;
  error?: string;
  attempts?: number;
}

interface CronState {
  last_heartbeat: string | null;
  engine_status: string;
  execution_log: ExecutionEntry[];
  dead_letter_queue: Array<{ task_id: string; error: string; timestamp: string; attempts: number }>;
  upcoming: unknown[];
}

let cronStateWriteLock = Promise.resolve();

export function enqueueCronStateWrite<T>(write: () => T | Promise<T>): Promise<T> {
  const run = cronStateWriteLock.then(write, write);
  cronStateWriteLock = run.then(() => undefined, () => undefined);
  return run;
}

export function normalizeCronState(parsed: unknown, fallback: Partial<CronState> = {}): CronState {
  const defaults = { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] };
  const state = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Partial<CronState> : { ...defaults, ...fallback };
  if (!Array.isArray(state.execution_log)) state.execution_log = [];
  if (!Array.isArray(state.dead_letter_queue)) state.dead_letter_queue = [];
  if (!Array.isArray(state.upcoming)) state.upcoming = [];
  state.execution_log = state.execution_log.filter((entry): entry is CronState["execution_log"][number] => {
    if (typeof entry !== "object" || entry === null) return false;
    const candidate = entry as Partial<CronState["execution_log"][number]>;
    return typeof candidate.task_id === "string"
      && (candidate.status === "success" || candidate.status === "failed")
      && typeof candidate.timestamp === "string"
      && typeof candidate.duration_ms === "number";
  });
  state.dead_letter_queue = state.dead_letter_queue.filter((entry): entry is CronState["dead_letter_queue"][number] => {
    if (typeof entry !== "object" || entry === null) return false;
    const candidate = entry as Partial<CronState["dead_letter_queue"][number]>;
    return typeof candidate.task_id === "string"
      && typeof candidate.error === "string"
      && typeof candidate.timestamp === "string"
      && typeof candidate.attempts === "number";
  });
  if (typeof state.last_heartbeat !== "string" && state.last_heartbeat !== null) state.last_heartbeat = null;
  if (typeof state.engine_status !== "string") state.engine_status = "running";
  return state as CronState;
}

export function updateCronState(wolfDir: string, updater: (state: CronState) => void): Promise<void> {
  return enqueueCronStateWrite(() => {
    const state = normalizeCronState(readJSON<unknown>(
      path.join(wolfDir, "cron-state.json"),
      { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] }
    ));
    updater(state);
    writeJSON(path.join(wolfDir, "cron-state.json"), state);
  });
}

export function countDeadLetterEntries(wolfDir: string, taskId: string): Promise<number> {
  return enqueueCronStateWrite(async () => {
    const state = normalizeCronState(readJSON<unknown>(
      path.join(wolfDir, "cron-state.json"),
      { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] }
    ));
    return state.dead_letter_queue.filter((entry) => entry.task_id === taskId).length;
  });
}

export function removeDeadLetterEntry(wolfDir: string, taskId: string): Promise<number> {
  return enqueueCronStateWrite(async () => {
    const state = normalizeCronState(readJSON<unknown>(
      path.join(wolfDir, "cron-state.json"),
      { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] }
    ));
    const idx = state.dead_letter_queue.findIndex((entry) => entry.task_id === taskId);
    if (idx === -1) return 0;
    state.dead_letter_queue.splice(idx, 1);
    writeJSON(path.join(wolfDir, "cron-state.json"), state);
    return 1;
  });
}

export function hasDeadLetterEntry(wolfDir: string, taskId: string): Promise<boolean> {
  return countDeadLetterEntries(wolfDir, taskId).then((count) => count > 0);
}

export class CronEngine {
  private wolfDir: string;
  private projectRoot: string;
  private logger: Logger;
  private broadcast: (msg: unknown) => void;
  private scheduledTasks: cron.ScheduledTask[] = [];
  private retryTimers = new Set<NodeJS.Timeout>();
  private retryTimersByTask = new Map<string, NodeJS.Timeout>();
  private pendingRetries = new Set<string>();
  private failureCounts = new Map<string, number>();
  private activeRuns = new Map<string, string>();
  private runCounter = 0;
  private stopped = false;

  constructor(
    wolfDir: string,
    projectRoot: string,
    logger: Logger,
    broadcast: (msg: unknown) => void
  ) {
    this.wolfDir = wolfDir;
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.broadcast = broadcast;
  }

  start(): void {
    this.stopped = false;
    const manifest = this.readManifest();
    for (const task of manifest.tasks) {
      if (!task.enabled) continue;
      if (!cron.validate(task.schedule)) {
        this.logger.warn(`Invalid cron schedule for ${task.id}: ${task.schedule}`);
        continue;
      }
      const scheduled = cron.schedule(task.schedule, () => {
        this.executeTask(task).catch((err) => {
          this.logger.error(`Task ${task.id} failed: ${err}`);
        });
      });
      this.scheduledTasks.push(scheduled);
      this.logger.info(`Scheduled task: ${task.name} (${task.schedule})`);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const task of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks = [];
    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryTimersByTask.clear();
    this.pendingRetries.clear();
  }

  private clearRetryTimer(taskId: string): void {
    const timer = this.retryTimersByTask.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(timer);
      this.retryTimersByTask.delete(taskId);
    }
  }

  private scheduleRetry(task: CronTask, failures: number, delay: number): TaskRunResult {
    this.pendingRetries.add(task.id);
    this.clearRetryTimer(task.id);
    this.broadcast({
      type: "cron_retrying",
      task_id: task.id,
      status: "retrying",
      attempts: failures,
      next_attempt: failures + 1,
    });
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      this.retryTimersByTask.delete(task.id);
      if (this.stopped) return;
      if (this.pendingRetries.has(task.id) && this.activeRuns.has(task.id)) {
        this.scheduleRetry(task, failures, delay);
        return;
      }
      this.executeTask(task).catch(() => {});
    }, delay);
    this.retryTimers.add(timer);
    this.retryTimersByTask.set(task.id, timer);
    return "retry_scheduled";
  }

  async runTask(taskId: string): Promise<TaskRunResult> {
    const manifest = this.readManifest();
    const task = manifest.tasks.find((t) => t.id === taskId);
    if (!task) {
      this.logger.warn(`Task not found: ${taskId}`);
      return "not_found";
    }
    return this.executeTask(task);
  }

  private readManifest(): CronManifest {
    return readJSON<CronManifest>(
      path.join(this.wolfDir, "cron-manifest.json"),
      { version: 1, tasks: [] }
    );
  }

  private readState(): CronState {
    return normalizeCronState(readJSON<unknown>(
      path.join(this.wolfDir, "cron-state.json"),
      { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] }
    ));
  }

  async updateState(updater: (state: CronState) => void): Promise<void> {
    await enqueueCronStateWrite(async () => {
      const state = this.readState();
      updater(state);
      writeJSON(path.join(this.wolfDir, "cron-state.json"), state);
    });
  }

  private async executeTask(task: CronTask): Promise<TaskRunResult> {
    if (this.stopped) {
      this.logger.warn(`Skipping task ${task.name}; engine is stopped`);
      return "stopped";
    }

    const runId = `${task.id}:${Date.now()}:${++this.runCounter}`;
    if (this.activeRuns.has(task.id)) {
      this.logger.warn(`Task ${task.name} already running; skipping overlapping execution`);
      return "skipped_active";
    }
    if (this.pendingRetries.has(task.id) && this.retryTimersByTask.has(task.id)) {
      this.logger.warn(`Task ${task.name} has a pending retry; skipping overlapping execution`);
      return "skipped_pending_retry";
    }

    this.activeRuns.set(task.id, runId);
    const startTime = Date.now();
    this.logger.info(`Executing task: ${task.name}`);

    try {
      await this.runAction(task.action);
      const duration = Date.now() - startTime;

      // Log success
      await this.updateState((state) => {
        state.execution_log.push({
          task_id: task.id,
          status: "success",
          timestamp: new Date().toISOString(),
          duration_ms: duration,
        });
        // Keep last 100 entries
        if (state.execution_log.length > 100) {
          state.execution_log = state.execution_log.slice(-100);
        }
      });

      this.failureCounts.set(task.id, 0);
      this.clearRetryTimer(task.id);
      this.pendingRetries.delete(task.id);
      this.broadcast({
        type: "cron_executed",
        task_id: task.id,
        status: "success",
        duration_ms: duration,
      });
      this.logger.info(`Task ${task.name} completed in ${duration}ms`);
      return "completed";
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      const failures = (this.failureCounts.get(task.id) ?? 0) + 1;
      this.failureCounts.set(task.id, failures);

      this.logger.error(`Task ${task.name} failed (attempt ${failures}): ${errorMsg}`);

      if (failures < task.retry.max_attempts && !this.stopped) {
        // Retry with backoff
        const delay = this.calculateDelay(task.retry.backoff, task.retry.base_delay_seconds, failures);
        this.logger.info(`Retrying ${task.name} in ${delay}ms`);
        return this.scheduleRetry(task, failures, delay);
      } else {
        // Dead letter or skip
        await this.updateState((state) => {
          state.execution_log.push({
            task_id: task.id,
            status: "failed",
            timestamp: new Date().toISOString(),
            duration_ms: duration,
            error: errorMsg,
            attempts: failures,
          });
          if (state.execution_log.length > 100) {
            state.execution_log = state.execution_log.slice(-100);
          }

          if (task.failsafe.dead_letter) {
            state.dead_letter_queue.push({
              task_id: task.id,
              error: errorMsg,
              timestamp: new Date().toISOString(),
              attempts: failures,
            });
          }
        });
        this.failureCounts.set(task.id, 0);
        this.clearRetryTimer(task.id);
        this.pendingRetries.delete(task.id);
        this.broadcast({
          type: "cron_executed",
          task_id: task.id,
          status: "failed",
          duration_ms: duration,
          attempts: failures,
        });
        return "dead_lettered";
      }
    } finally {
      if (this.activeRuns.get(task.id) === runId) {
        this.activeRuns.delete(task.id);
      }
    }
  }

  private calculateDelay(backoff: string, baseSec: number, attempt: number): number {
    const baseMs = baseSec * 1000;
    switch (backoff) {
      case "exponential":
        return baseMs * Math.pow(2, attempt - 1);
      case "linear":
        return baseMs * attempt;
      default:
        return 0;
    }
  }

  private async runAction(action: CronAction): Promise<void> {
    switch (action.type) {
      case "scan_project":
        scanProject(this.wolfDir, this.projectRoot);
        break;

      case "consolidate_memory":
        this.consolidateMemory(action.params?.older_than_days as number ?? 7);
        break;

      case "generate_token_report":
        this.generateTokenReport();
        break;

      case "ai_task":
        await this.runAiTask(action.params as { prompt: string; context_files: string[] });
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private consolidateMemory(olderThanDays: number): void {
    const memoryPath = path.join(this.wolfDir, "memory.md");
    const content = readText(memoryPath);
    if (!content) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const lines = content.split("\n");
    const result: string[] = [];
    let inOldSession = false;
    let oldSessionLines: string[] = [];
    let currentSessionDate: Date | null = null;

    for (const line of lines) {
      const sessionMatch = line.match(/^## Session: (\d{4}-\d{2}-\d{2})/);
      if (sessionMatch) {
        // Flush previous old session
        if (inOldSession && oldSessionLines.length > 0) {
          const actionCount = oldSessionLines.filter((l) => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time")).length;
          result.push(`> Consolidated session (${actionCount} actions)`);
          result.push("");
        }

        currentSessionDate = new Date(sessionMatch[1]);
        if (currentSessionDate < cutoff) {
          inOldSession = true;
          oldSessionLines = [];
          result.push(line); // Keep the header
        } else {
          inOldSession = false;
          result.push(line);
        }
        continue;
      }

      if (inOldSession) {
        oldSessionLines.push(line);
      } else {
        result.push(line);
      }
    }

    // Flush last old session
    if (inOldSession && oldSessionLines.length > 0) {
      const actionCount = oldSessionLines.filter((l) => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time")).length;
      result.push(`> Consolidated session (${actionCount} actions)`);
      result.push("");
    }

    writeText(memoryPath, result.join("\n"));
  }

  private generateTokenReport(): void {
    const flags = detectWaste(this.wolfDir);
    const ledgerPath = path.join(this.wolfDir, "token-ledger.json");
    const ledger = readJSON<Record<string, unknown>>(ledgerPath, {});
    (ledger as { waste_flags: unknown[] }).waste_flags = flags;
    (ledger as { optimization_report: { last_generated: string; patterns: unknown[] } }).optimization_report = {
      last_generated: new Date().toISOString(),
      patterns: flags.map((f) => f.pattern),
    };
    writeJSON(ledgerPath, ledger);
  }

  private hasClaude(): boolean {
    try {
      const cmd = process.platform === "win32" ? "where claude" : "which claude";
      execSync(cmd, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private async runAiTask(params: { prompt: string; context_files: string[] }): Promise<void> {
    if (!this.hasClaude()) {
      throw new Error("Claude CLI not found. Install it from https://claude.ai/download or add it to PATH.");
    }

    const contextParts: string[] = [];
    for (const file of params.context_files) {
      const filePath = path.join(this.projectRoot, file);
      try {
        contextParts.push(`--- ${file} ---\n${fs.readFileSync(filePath, "utf-8")}`);
      } catch {
        contextParts.push(`--- ${file} --- (not found)`);
      }
    }

    const fullPrompt = `${params.prompt}\n\n---\nContext:\n${contextParts.join("\n\n")}`;

    try {
      // Use spawnSync to pipe prompt via stdin — avoids command-line length limits on Windows
      // claude -p (no argument) reads prompt from stdin
      // Strip ANTHROPIC_API_KEY so claude uses OAuth subscription credentials
      // instead of a potentially depleted API key
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;

      const proc = spawnSync("claude -p --output-format text", {
        input: fullPrompt,
        timeout: 120000,
        encoding: "utf-8",
        cwd: this.projectRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        // shell: true needed on Windows so that claude.cmd is resolved
        shell: true,
        windowsHide: true,
      });

      if (proc.error) {
        throw proc.error;
      }

      if (proc.status !== 0) {
        const stderr = proc.stderr?.trim();
        const stdout = proc.stdout?.trim();
        const errMsg = stderr || stdout || "Unknown error";
        throw new Error(`Exit code ${proc.status}: ${errMsg}`);
      }

      let result = (proc.stdout || "").replace(/\r\n/g, "\n").trim();

      // Strip markdown code fences if present (```markdown ... ``` or ```json ... ```)
      const fenceMatch = result.match(/```[\w]*\n([\s\S]*?)\n```/);
      if (fenceMatch) {
        result = fenceMatch[1].trim();
      }

      // Write result to suggestions.json if it looks like JSON
      try {
        const parsed = JSON.parse(result);
        writeJSON(path.join(this.wolfDir, "suggestions.json"), {
          generated_at: new Date().toISOString(),
          ...parsed,
        });
      } catch {
        // Not JSON, might be a cerebrum update
        if (result.includes("## User Preferences") || result.includes("## Key Learnings") || result.includes("# Cerebrum")) {
          writeText(path.join(this.wolfDir, "cerebrum.md"), result);
        }
      }
    } catch (err) {
      throw new Error(`claude -p failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
