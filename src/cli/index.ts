import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { initCommand } from "./init.js";
import { statusCommand } from "./status.js";
import { scanCommand } from "./scan.js";
import { dashboardCommand } from "./dashboard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("openwolf")
    .description("Token-conscious AI brain for Claude Code projects")
    .version(getVersion());

  program
    .command("init")
    .description("Initialize .wolf/ in current project")
    .option("--profile <name>", "Reviewer recommendation profile: gov, open, or budget")
    .action(initCommand);

  program
    .command("status")
    .description("Show daemon health, last session stats, file integrity")
    .action(statusCommand);

  program
    .command("scan")
    .description("Force full anatomy rescan")
    .option("--check", "Verify anatomy.md matches filesystem (no changes)")
    .action(scanCommand);

  program
    .command("dashboard")
    .description("Open browser to dashboard")
    .action(dashboardCommand);

  const daemon = program
    .command("daemon")
    .description("Daemon management");

  daemon
    .command("start")
    .description("Start daemon via pm2")
    .action(async () => {
      const { daemonStart } = await import("./daemon-cmd.js");
      await daemonStart();
    });

  daemon
    .command("stop")
    .description("Stop daemon")
    .action(async () => {
      const { daemonStop } = await import("./daemon-cmd.js");
      daemonStop();
    });

  daemon
    .command("restart")
    .description("Restart daemon")
    .action(async () => {
      const { daemonRestart } = await import("./daemon-cmd.js");
      await daemonRestart();
    });

  daemon
    .command("logs")
    .description("Show last 50 lines of daemon log")
    .action(async () => {
      const { daemonLogs } = await import("./daemon-cmd.js");
      daemonLogs();
    });

  const cron = program
    .command("cron")
    .description("Cron task management");

  cron
    .command("list")
    .description("Show all cron tasks with next run times")
    .action(async () => {
      const { cronList } = await import("./cron-cmd.js");
      cronList();
    });

  cron
    .command("run <id>")
    .description("Manually trigger a cron task")
    .action(async (id: string) => {
      const { cronRun } = await import("./cron-cmd.js");
      await cronRun(id);
    });

  cron
    .command("retry <id>")
    .description("Retry a dead-lettered task")
    .action(async (id: string) => {
      const { cronRetry } = await import("./cron-cmd.js");
      cronRetry(id);
    });

  // --- Update command ---
  program
    .command("update")
    .description("Update all registered OpenWolf projects to latest version")
    .option("--dry-run", "Show what would be updated without making changes")
    .option("--project <name>", "Update only a specific project (partial name match)")
    .option("--profile <name>", "Reviewer recommendation profile: gov, open, or budget")
    .option("--list", "List all registered projects")
    .action(async (opts: { dryRun?: boolean; project?: string; profile?: string; list?: boolean }) => {
      const { updateCommand, listProjects } = await import("./update.js");
      if (opts.list) {
        listProjects();
      } else {
        await updateCommand(opts);
      }
    });

  // --- Restore command ---
  program
    .command("restore [backup]")
    .description("Restore .wolf from a backup (run in project dir). Without args, lists available backups.")
    .action(async (backup?: string) => {
      const { restoreCommand } = await import("./update.js");
      restoreCommand(backup);
    });

  // --- Design QC command ---
  program
    .command("designqc [target]")
    .description("Capture full-page screenshots for design evaluation by Claude Code")
    .option("--url <url>", "Dev server URL (auto-starts server if omitted)")
    .option("--routes <routes...>", "Specific routes to check")
    .option("--quality <n>", "JPEG quality 1-100 (lower = fewer tokens)", "70")
    .option("--max-width <n>", "Max capture width in px", "1200")
    .option("--desktop-only", "Skip mobile viewport captures")
    .action(async (target: string | undefined, opts: { url?: string; routes?: string[]; quality?: string; maxWidth?: string; desktopOnly?: boolean }) => {
      const { designqcCommand } = await import("./designqc-cmd.js");
      await designqcCommand(target, opts);
    });


  const review = program
    .command("review")
    .description("Review receipt management");

  review
    .command("list")
    .description("List review receipts")
    .action(async () => {
      const { reviewList } = await import("./review-cmd.js");
      reviewList();
    });

  review
    .command("show <id>")
    .description("Show one review receipt and current hash state")
    .action(async (id: string) => {
      const { reviewShow } = await import("./review-cmd.js");
      reviewShow(id);
    });

  review
    .command("hash <files...>")
    .description("Compute the reviewed-hash manifest for file(s)")
    .action(async (files: string[]) => {
      const { reviewHash } = await import("./review-cmd.js");
      reviewHash(files);
    });

  review
    .command("complete <id>")
    .description("Complete a review receipt with optional reviewed-hash provenance")
    .option("--reviewer <name>", "Reviewer label", "manual")
    .option("--summary <text>", "Review summary", "")
    .option("--reviewed-hash <hash>", "Manifest hash the reviewer saw")
    .option("--reviewed-current", "Legacy manual assertion that current bytes were reviewed")
    .action(async (id: string, opts: { reviewer?: string; summary?: string; reviewedHash?: string; reviewedCurrent?: boolean }) => {
      const { reviewComplete } = await import("./review-cmd.js");
      reviewComplete(id, opts);
    });

  const qa = program
    .command("qa")
    .description("Quality gate management");

  qa
    .command("status")
    .description("Show QA reduction current/stale/orphan/broken status")
    .option("--check", "Exit nonzero when stale, orphan, or broken reductions exist")
    .option("--json", "Output JSON")
    .action(async (opts: { check?: boolean; json?: boolean }) => {
      const { qaStatus } = await import("./qa-cmd.js");
      qaStatus(opts);
    });

  program
    .command("trace <target>")
    .description("Trace bug/review/path links across Wolfpack memory")
    .option("--json", "Output JSON")
    .action(async (target: string, opts: { json?: boolean }) => {
      const { traceCommand } = await import("./trace-cmd.js");
      traceCommand(target, opts);
    });

  const cerebrum = program
    .command("cerebrum")
    .description("Cerebrum memory management");

  cerebrum
    .command("lint")
    .description("Validate .wolf/cerebrum.md structure")
    .option("--check", "Exit nonzero on structural errors")
    .option("--json", "Output JSON")
    .action(async (opts: { check?: boolean; json?: boolean }) => {
      const { cerebrumLint } = await import("./cerebrum-cmd.js");
      cerebrumLint(opts);
    });

  // --- Bug command ---
  const bug = program
    .command("bug")
    .description("Bug memory management");

  bug
    .command("search <term>")
    .description("Search buglog for matching entries")
    .action(async (term: string) => {
      const { bugSearch } = await import("./bug-cmd.js");
      bugSearch(term);
    });

  return program;
}
