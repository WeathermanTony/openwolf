import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, readText } from "../utils/fs-safe.js";
import { hasOpenWolfPm2Daemon } from "./daemon-cmd.js";
import { shouldAutoStartDaemon } from "./init.js";
import { HOOK_MANIFEST_FILE, HOOK_PACKAGE_JSON, HOOK_PAYLOAD_FILES, HOOK_UTILITY_FILES, missingHookRegistrations } from "./hook-manifest.js";
import { resolveBehavior } from "../hooks/shared.js";

export async function statusCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  console.log("OpenWolf Status");
  console.log("===============\n");

  // File integrity check
  const requiredFiles = [
    "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md",
    "anatomy.md", "config.json", "token-ledger.json", "buglog.json",
    "cron-manifest.json", "cron-state.json",
  ];

  let missingCount = 0;
  for (const file of requiredFiles) {
    const exists = fs.existsSync(path.join(wolfDir, file));
    if (!exists) {
      console.log(`  ✗ Missing: .wolf/${file}`);
      missingCount++;
    }
  }
  if (missingCount === 0) {
    console.log(`  ✓ All ${requiredFiles.length} core files present`);
  }

  // Hook payload and package-marker check
  const hooksDir = path.join(wolfDir, "hooks");
  const requiredHookPaths = [
    ...HOOK_PAYLOAD_FILES.map(file => path.join(hooksDir, file)),
    ...HOOK_UTILITY_FILES.map(file => path.join(wolfDir, "utils", file)),
    path.join(hooksDir, "package.json"),
    path.join(hooksDir, HOOK_MANIFEST_FILE),
    path.join(wolfDir, "utils", "package.json"),
  ];
  const missingHookPaths = requiredHookPaths.filter(file => !fs.existsSync(file));
  let hooksMissing = missingHookPaths.length;
  if (hooksMissing === 0) {
    const packageFiles = [path.join(hooksDir, "package.json"), path.join(wolfDir, "utils", "package.json")];
    const invalidPackages = packageFiles.filter(file => readJSON<{ type?: unknown }>(file, {}).type !== HOOK_PACKAGE_JSON.type);
    hooksMissing += invalidPackages.length;
  }
  if (hooksMissing === 0) {
    console.log(`  ✓ Complete hook runtime payload present (${requiredHookPaths.length} files)`);
  } else {
    console.log(`  ✗ Hook runtime incomplete (${hooksMissing} missing or invalid files)`);
  }
  const runtimeRequirements = [
    path.join(hooksDir, "complete-review.js"),
    path.join(hooksDir, "package.json"),
    path.join(hooksDir, "nudges", "engine.js"),
    path.join(hooksDir, "nudges", "state.js"),
    path.join(wolfDir, "utils", "size-discipline.js"),
    path.join(wolfDir, "utils", "package.json"),
  ];
  const runtimeMissing = runtimeRequirements.filter(file => !fs.existsSync(file));
  console.log(runtimeMissing.length === 0
    ? "  ✓ Nested nudge/utils runtime complete"
    : `  ✗ Missing ${runtimeMissing.length} nested runtime file(s)`);

  // Claude settings check
  const settingsPath = path.join(projectRoot, ".claude", "settings.json");
  if (fs.existsSync(settingsPath)) {
    const settings = readJSON<Record<string, unknown>>(settingsPath, {});
    const missingRegistrations = missingHookRegistrations(settings);
    if (missingRegistrations.length === 0) {
      console.log("  ✓ Claude Code hook registrations match the current manifest");
    } else {
      console.log(`  ✗ ${missingRegistrations.length} Claude Code hook registrations are missing or stale`);
      hooksMissing += missingRegistrations.length;
    }
  } else {
    console.log("  ✗ .claude/settings.json not found");
    hooksMissing++;
  }

  const health = readJSON<{ hooks?: Record<string, { consecutive_failures?: number; last_error?: string }> }>(
    path.join(hooksDir, "_health.json"),
    {}
  );
  const degradedHooks = Object.entries(health.hooks ?? {}).filter(([, entry]) => (entry.consecutive_failures ?? 0) > 0);
  if (degradedHooks.length > 0) {
    console.log(`  ✗ Hook health degraded: ${degradedHooks.map(([name]) => name).join(", ")}`);
    hooksMissing += degradedHooks.length;
  }

  // Token ledger stats
  const ledger = readJSON<{
    lifetime: {
      total_sessions: number;
      total_reads: number;
      total_writes: number;
      total_tokens_estimated: number;
      estimated_savings_vs_bare_cli: number;
    };
  }>(path.join(wolfDir, "token-ledger.json"), {
    lifetime: { total_sessions: 0, total_reads: 0, total_writes: 0, total_tokens_estimated: 0, estimated_savings_vs_bare_cli: 0 },
  });

  console.log(`\nToken Stats:`);
  console.log(`  Sessions: ${ledger.lifetime.total_sessions}`);
  console.log(`  Total reads: ${ledger.lifetime.total_reads}`);
  console.log(`  Total writes: ${ledger.lifetime.total_writes}`);
  console.log(`  Tokens tracked: ~${ledger.lifetime.total_tokens_estimated.toLocaleString()}`);
  console.log(`  Estimated savings: ~${ledger.lifetime.estimated_savings_vs_bare_cli.toLocaleString()} tokens`);

  // Anatomy stats
  const anatomyContent = readText(path.join(wolfDir, "anatomy.md"));
  const entryCount = (anatomyContent.match(/^- `/gm) || []).length;
  console.log(`\nAnatomy: ${entryCount} files tracked`);

  const config = readJSON<any>(path.join(wolfDir, "config.json"), {});
  const behavior = resolveBehavior(config, { installationKind: "existing" });
  const reviewerProfile = config?.openwolf?.hook_messages?.reviewer_profile ?? "us-only";
  const reviewLog = readJSON<any>(path.join(wolfDir, "reviewlog.json"), { reviews: [] });
  const pendingReviews = Array.isArray(reviewLog?.reviews)
    ? reviewLog.reviews.filter((review: any) => !["completed", "resolved", "dismissed", "superseded"].includes(String(review?.status ?? "pending").toLowerCase())).length
    : 0;
  const backupsDir = path.join(wolfDir, "backups");
  const backupDirs = fs.existsSync(backupsDir)
    ? fs.readdirSync(backupsDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
    : [];
  const directoryBytes = (dir: string): number => fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const target = path.join(dir, entry.name);
    try { return sum + (entry.isDirectory() ? directoryBytes(target) : fs.statSync(target).size); } catch { return sum; }
  }, 0);
  const backupBytes = backupDirs.reduce((sum, entry) => sum + directoryBytes(path.join(backupsDir, entry.name)), 0);
  console.log("\nPolicy:");
  console.log(`  Behavior: ${behavior.mode} (${behavior.source})`);
  console.log(`  Reviewer profile: ${reviewerProfile === "us-only" ? "gov/us-only" : reviewerProfile}`);
  console.log(`  Automatic coaching: ${behavior.mode === "quiet" ? "suppressed; explicit commands remain available" : "enabled"}`);
  console.log(`  Pending reviews: ${pendingReviews}`);
  console.log(`  Backups: ${backupDirs.length} (${backupBytes.toLocaleString()} bytes)`);
  console.log(`  Backup policy: ${config?.openwolf?.backups?.retention_days ?? 30} days, keep last ${config?.openwolf?.backups?.keep_last ?? 3}, pending protection ${config?.openwolf?.backups?.protect_pending_reviews !== false ? "on" : "off"}`);
  const autoStart = shouldAutoStartDaemon(config);
  const daemonRunning = hasOpenWolfPm2Daemon(projectRoot);
  console.log("\nBackground Services:");
  console.log(`  Quality hooks: ${hooksMissing === 0 ? "active" : "incomplete"}`);
  console.log(`  Daemon policy: automatic startup ${autoStart ? "enabled" : "disabled"}`);
  console.log(`  Daemon runtime: ${daemonRunning ? "running through PM2" : "not running"}`);
  console.log("  Dashboard: open on demand with `openwolf dashboard`");
  console.log(`  Scheduled cron: ${daemonRunning ? "active when enabled in config" : "inactive while daemon is stopped"}`);
  console.log("  Manual maintenance: `openwolf scan` and `openwolf cron run <id>`");

  const cronState = readJSON<{ last_heartbeat: string | null }>(
    path.join(wolfDir, "cron-state.json"),
    { last_heartbeat: null }
  );
  if (cronState.last_heartbeat) {
    const elapsed = Date.now() - new Date(cronState.last_heartbeat).getTime();
    const mins = Math.floor(elapsed / 60000);
    console.log(`  ${daemonRunning ? "Last heartbeat" : "Historical heartbeat"}: ${mins} minutes ago`);
  }

  console.log("");
}
