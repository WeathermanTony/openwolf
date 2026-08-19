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
    .description("Show quality hooks, optional services, stats, and file integrity")
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

  const skills = program
    .command("skills")
    .description("Manage user-scope SkillsBench standard skills");

  skills
    .command("init")
    .description("Fetch and activate the configured SkillsBench skills")
    .option("--dry-run", "Show the planned operation without writing state")
    .option("--quiet", "Suppress normal output")
    .action(async (opts: { dryRun?: boolean; quiet?: boolean }) => {
      const { skillsInit } = await import("./skillsbench.js");
      await skillsInit(opts);
    });

  skills
    .command("status")
    .description("Show SkillsBench release and prerequisite status")
    .action(async () => {
      const { skillsStatus } = await import("./skillsbench.js");
      skillsStatus();
    });

  skills
    .command("update")
    .description("Fetch, validate, and atomically activate an updated release")
    .option("--dry-run", "Show the planned operation without writing state")
    .option("--quiet", "Suppress normal output and preserve active release on failure")
    .action(async (opts: { dryRun?: boolean; quiet?: boolean }) => {
      const { skillsUpdate } = await import("./skillsbench.js");
      await skillsUpdate(opts);
    });

  skills
    .command("doctor")
    .description("Verify active SkillsBench release integrity")
    .action(async () => {
      const { skillsDoctor } = await import("./skillsbench.js");
      skillsDoctor();
    });

  skills
    .command("rollback [revision]")
    .description("Reactivate the previous or named SkillsBench release")
    .action(async (revision?: string) => {
      const { skillsRollback } = await import("./skillsbench.js");
      skillsRollback(revision);
    });

  const skillsSchedule = skills
    .command("schedule")
    .description("Manage the manager-owned weekly update schedule");

  skillsSchedule
    .command("remove")
    .description("Remove only the manager-owned weekly update crontab entry")
    .action(async () => {
      const { skillsRemoveSchedule } = await import("./skillsbench.js");
      skillsRemoveSchedule();
    });

  const scientificSkills = skills
    .command("scientific")
    .description("Manage user-scope K-Dense scientific skills");

  scientificSkills
    .command("init")
    .description("Fetch and activate the configured K-Dense scientific skills")
    .option("--dry-run", "Show the planned operation without writing state")
    .option("--quiet", "Suppress normal output")
    .action(async (opts: { dryRun?: boolean; quiet?: boolean }) => {
      const { scientificSkillsInit } = await import("./scientific-skills.js");
      await scientificSkillsInit(opts);
    });

  scientificSkills
    .command("status")
    .description("Show scientific skill release and prerequisite status")
    .action(async () => {
      const { scientificSkillsStatus } = await import("./scientific-skills.js");
      scientificSkillsStatus();
    });

  scientificSkills
    .command("update")
    .description("Fetch, validate, and atomically activate scientific skills")
    .option("--dry-run", "Show the planned operation without writing state")
    .option("--quiet", "Suppress normal output and preserve active release on failure")
    .action(async (opts: { dryRun?: boolean; quiet?: boolean }) => {
      const { scientificSkillsUpdate } = await import("./scientific-skills.js");
      await scientificSkillsUpdate(opts);
    });

  scientificSkills
    .command("doctor")
    .description("Verify active K-Dense scientific skill release integrity")
    .action(async () => {
      const { scientificSkillsDoctor } = await import("./scientific-skills.js");
      scientificSkillsDoctor();
    });

  scientificSkills
    .command("rollback [revision]")
    .description("Reactivate the previous or named scientific skill release")
    .action(async (revision?: string) => {
      const { scientificSkillsRollback } = await import("./scientific-skills.js");
      scientificSkillsRollback(revision);
    });

  const scientificSchedule = scientificSkills
    .command("schedule")
    .description("Manage the scientific manager-owned weekly update schedule");

  scientificSchedule
    .command("remove")
    .description("Remove only the scientific weekly update crontab entry")
    .action(async () => {
      const { scientificSkillsRemoveSchedule } = await import("./scientific-skills.js");
      scientificSkillsRemoveSchedule();
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

  const nudge = program
    .command("nudge")
    .description("Inspect and dispose of Stop-hook nudges");

  nudge
    .command("list")
    .description("List recorded nudges and their dispositions")
    .action(async () => {
      const { nudgeList } = await import("./nudge-cmd.js");
      nudgeList();
    });

  nudge
    .command("show <id>")
    .description("Show one nudge's full evidence and history")
    .action(async (id: string) => {
      const { nudgeShow } = await import("./nudge-cmd.js");
      nudgeShow(id);
    });

  nudge
    .command("resolve <id>")
    .description("Mark a nudge resolved (suppresses this exact evidence)")
    .action(async (id: string) => {
      const { nudgeResolve } = await import("./nudge-cmd.js");
      nudgeResolve(id);
    });

  nudge
    .command("dismiss <id>")
    .description("Dismiss a nudge as a false positive")
    .option("--reason <text>", "Short reason", "")
    .action(async (id: string, opts: { reason?: string }) => {
      const { nudgeDismiss } = await import("./nudge-cmd.js");
      nudgeDismiss(id, opts);
    });

  nudge
    .command("snooze <id>")
    .description("Suppress a nudge temporarily")
    .option("--hours <n>", "Snooze for N hours")
    .option("--until <when>", "Use 'session-end' for session-scoped snooze")
    .action(async (id: string, opts: { hours?: string; until?: string }) => {
      const { nudgeSnooze } = await import("./nudge-cmd.js");
      nudgeSnooze(id, opts);
    });

  nudge
    .command("stats")
    .description("Report whether the nudge system is helping")
    .action(async () => {
      const { nudgeStats } = await import("./nudge-cmd.js");
      nudgeStats();
    });

  const ledger = program
    .command("ledger")
    .description("Audit and conservatively repair durable ledgers");

  ledger
    .command("audit")
    .description("Audit bug and review ledger integrity")
    .option("--project <path>", "Audit one project root")
    .option("--fleet", "Audit every registered project")
    .option("--json", "Output JSON")
    .action(async (opts: { project?: string; fleet?: boolean; json?: boolean }) => {
      const { ledgerAudit } = await import("./ledger-cmd.js");
      ledgerAudit(opts);
    });

  ledger
    .command("repair")
    .description("Plan or explicitly apply ledger collision repairs")
    .option("--project <path>", "Repair one project root")
    .option("--fleet", "Repair every registered project")
    .option("--apply", "Apply the deterministic repair (default is dry-run)")
    .option("--json", "Output JSON")
    .action(async (opts: { project?: string; fleet?: boolean; apply?: boolean; json?: boolean }) => {
      const { ledgerRepair } = await import("./ledger-cmd.js");
      ledgerRepair(opts);
    });

  ledger
    .command("normalize")
    .description("Plan or explicitly normalize one governed ledger; references are inventoried, never rewritten")
    .requiredOption("--kind <kind>", "Ledger kind: bug or review")
    .option("--project <path>", "Normalize one project root")
    .option("--fleet", "Dry-run registered projects only (apply is refused)")
    .option("--apply", "Apply normalization after explicit acknowledgement")
    .option("--acknowledge-structural-normalization", "Acknowledge root-shape, ID, and provenance changes")
    .option("--json", "Output JSON")
    .action(async (opts: { project?: string; fleet?: boolean; kind?: "bug" | "review"; apply?: boolean; acknowledgeStructuralNormalization?: boolean; json?: boolean }) => {
      if (opts.kind !== "bug" && opts.kind !== "review") throw new Error("ledger normalize --kind must be bug or review");
      const { ledgerNormalize } = await import("./ledger-cmd.js");
      ledgerNormalize(opts);
    });

  ledger
    .command("recover <receipt>")
    .description("Restore one receipt-targeted normalized ledger from its exact-byte backup")
    .requiredOption("--kind <kind>", "Ledger kind: bug or review")
    .option("--project <path>", "Project root containing the ledger")
    .requiredOption("--apply", "Apply the hash-guarded recovery")
    .requiredOption("--acknowledge-structural-normalization", "Acknowledge recovery overwrites the receipt-matched live ledger")
    .option("--json", "Output JSON")
    .action(async (receipt: string, opts: { project?: string; kind?: "bug" | "review"; apply?: boolean; acknowledgeStructuralNormalization?: boolean; json?: boolean }) => {
      if (opts.kind !== "bug" && opts.kind !== "review") throw new Error("ledger recover --kind must be bug or review");
      const { ledgerRecover } = await import("./ledger-cmd.js");
      ledgerRecover({ ...opts, receipt });
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
    .command("driftcheck")
    .description("Detect rot between docs/ledgers and the code they describe")
    .option("--check", "Exit nonzero when drift or a vacuous check is found")
    .option("--json", "Output JSON")
    .action(async (opts: { check?: boolean; json?: boolean }) => {
      const { driftCheck } = await import("./drift-cmd.js");
      driftCheck(opts);
    });

  const experiment = program
    .command("experiment")
    .description("Manage opt-in evidence-bound experiments");

  experiment
    .command("start <slug>")
    .description("Create an experiment and capture protected evaluator bytes")
    .requiredOption("--objective <text>", "Measurable objective or decision criterion")
    .requiredOption("--hypothesis <text>", "Strategy hypothesis to test")
    .requiredOption("--protect <paths...>", "Project-relative evaluator files to protect")
    .option("--strategy <id>", "Logical strategy family")
    .option("--parent <id>", "Parent experiment id")
    .option("--branch <name>", "Branch metadata")
    .option("--worktree <path>", "Worktree metadata")
    .option("--max-attempts <n>", "Attempt cap for this strategy", "3")
    .action(async (slug: string, opts: any) => {
      const { experimentStart } = await import("./experiment-cmd.js");
      experimentStart(slug, opts);
    });

  experiment
    .command("evidence <id>")
    .description("Record actual command evidence without executing it")
    .requiredOption("--command <text>", "Command that produced the evidence")
    .requiredOption("--cwd <path>", "Receiving working directory")
    .requiredOption("--exit-code <n>", "Observed integer exit code")
    .option("--output-file <path>", "Read bounded output from a project file")
    .option("--output <text>", "Record bounded inline output")
    .option("--metric <name=value>", "Optional quantitative reading for this attempt")
    .action(async (id: string, opts: any) => {
      const { experimentEvidence } = await import("./experiment-cmd.js");
      experimentEvidence(id, opts);
    });

  experiment
    .command("conclude <id>")
    .description("Record a terminal evidence-bound disposition")
    .requiredOption("--status <status>", "survived, falsified, inconclusive, exhausted, or abandoned")
    .requiredOption("--conclusion <text>", "Evidence-supported conclusion")
    .requiredOption("--limit <text>", "Known limitation")
    .requiredOption("--falsifier <text>", "Evidence that would overturn the conclusion")
    .option("--lesson <text>", "Unreviewed candidate lesson; not promoted to Cerebrum")
    .option("--qa <path>", "Linked QA reduction")
    .option("--review <id>", "Linked review id")
    .option("--bug <id>", "Linked bug id")
    .action(async (id: string, opts: any) => {
      const { experimentConclude } = await import("./experiment-cmd.js");
      experimentConclude(id, opts);
    });

  experiment.command("show <id>").option("--json", "Output JSON").action(async (id: string, opts: any) => {
    const { experimentShow } = await import("./experiment-cmd.js"); experimentShow(id, opts);
  });
  experiment
    .command("journal")
    .description("Quantitative attempt journal projected from experiment records")
    .option("--json", "Output JSON")
    .action(async (opts: any) => {
      const { experimentJournal } = await import("./experiment-cmd.js");
      experimentJournal(opts);
    });

  experiment.command("list").option("--json", "Output JSON").action(async (opts: any) => {
    const { experimentList } = await import("./experiment-cmd.js"); experimentList(opts);
  });
  experiment.command("verify <id>").option("--json", "Output JSON").action(async (id: string, opts: any) => {
    const { experimentVerify } = await import("./experiment-cmd.js"); experimentVerify(id, opts);
  });
  experiment.command("status [id]").option("--check", "Exit nonzero on lifecycle or integrity problems").option("--json", "Output JSON").action(async (id: string | undefined, opts: any) => {
    const { experimentStatus } = await import("./experiment-cmd.js"); experimentStatus(id, opts);
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
    .command("record <id>")
    .description("Record an explicit learning candidate into governed Cerebrum")
    .requiredOption("--text <entry>", "Sanitized durable entry to record")
    .action(async (id: string, opts: { text: string }) => {
      const { cerebrumRecord } = await import("./cerebrum-record.js");
      cerebrumRecord(id, opts);
    });

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
