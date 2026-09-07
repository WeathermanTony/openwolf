/**
 * openwolf update — Update all registered OpenWolf projects.
 *
 * For each project:
 * 1. Creates a timestamped backup in .wolf/backups/
 * 2. Updates hooks, templates, protocol files, and claude rules
 * 3. Preserves all user data (cerebrum, memory, anatomy, buglog, ledger)
 * 4. Reports results per project
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { classifyFleetProjects, getRegisteredProjects, registerProject, type RegisteredProject } from "./registry.js";
import { applyBehaviorMode, applyReviewerProfile, findTemplatesDir, generateTemplate, migrateReviewCompanionConfig, normalizeBehaviorMode, normalizeReviewerProfile, shouldAutoStartDaemon } from "./init.js";
import { cleanupOpenWolfPm2, listPm2Processes } from "./daemon-cmd.js";
import { readJSON, writeJSON, readText, writeText, safeCopyFile, safeCopyDir } from "../utils/fs-safe.js";
import { ensureDir } from "../utils/paths.js";
import { findProjectRoot } from "../scanner/project-root.js";
import { backupManagedClaudeSkills, installManagedClaudeSkills, restoreManagedClaudeSkills } from "./managed-skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE_ROOT = path.resolve(__dirname, "../../..");

function normalizedRealPath(value: string): string {
  const resolved = path.resolve(value);
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
}

export function isSourceProject(project: Pick<RegisteredProject, "root" | "name">, sourceRoot = SOURCE_ROOT): boolean {
  if (project.name === "openwolf" || normalizedRealPath(project.root) === normalizedRealPath(sourceRoot)) return true;
  const pkg = readJSON<{ name?: string }>(path.join(project.root, "package.json"), {});
  return pkg.name === "customopenwolf" && fs.existsSync(path.join(project.root, "src", "cli", "update.ts"));
}

function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// Files that are safe to overwrite (protocol/config)
const ALWAYS_OVERWRITE = ["OPENWOLF.md", "PROTOCOL-UPGRADE-2026-06.md", "reframe-frameworks.md", ".gitignore"];
const CREATE_IF_MISSING = ["config.json"];

// Files that contain user data — NEVER overwrite, only create if missing
const USER_DATA_FILES = [
  "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
  "token-ledger.json", "buglog.json", "reviewlog.json", "cron-manifest.json", "cron-state.json",
  "suggestions.json", "designqc-report.json",
];

// Files to include in backup
const BACKUP_FILES = [
  ...ALWAYS_OVERWRITE,
  ...CREATE_IF_MISSING,
  ...USER_DATA_FILES,
];

function hookCommand(file: string): string {
  return `node -e "import('node:url').then(({pathToFileURL})=>import(pathToFileURL(process.env.CLAUDE_PROJECT_DIR+'/.wolf/hooks/${file}').href)).catch(()=>{})"`;
}

const HOOK_SETTINGS = {
  hooks: {
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command: hookCommand("session-start.js"), timeout: 5 }] }],
    PreToolUse: [
      { matcher: "Read", hooks: [{ type: "command", command: hookCommand("pre-read.js"), timeout: 5 }] },
      { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: hookCommand("pre-write.js"), timeout: 5 }] },
    ],
    PostToolUse: [
      { matcher: "Read", hooks: [{ type: "command", command: hookCommand("post-read.js"), timeout: 5 }] },
      { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: hookCommand("post-write.js"), timeout: 10 }] },
    ],
    Stop: [{ matcher: "", hooks: [{ type: "command", command: hookCommand("stop.js"), timeout: 10 }] }],
  },
};

interface UpdateResult {
  project: RegisteredProject;
  status: "updated" | "skipped" | "error";
  backupDir?: string;
  message: string;
}

export async function updateCommand(options: { dryRun?: boolean; force?: boolean; project?: string; root?: string; profile?: string; behavior?: string }): Promise<void> {
  const version = getVersion();
  const dryRun = options.dryRun ?? false;
  // Keep missing projects long enough to correlate and remove their owned PM2
  // registrations before registry validation drops them.
  const allProjects = getRegisteredProjects(false);
  const eligibility = classifyFleetProjects(allProjects, SOURCE_ROOT).map(item =>
    isSourceProject(item.project) ? { ...item, eligible: false, reason: "source-checkout" as const } : item
  );

  if (allProjects.length === 0) {
    console.log("No registered OpenWolf projects found.");
    console.log("Run 'openwolf init' in a project directory to register it.");
    return;
  }

  let selectedEligibility = eligibility;
  if (options.root) {
    const exact = normalizedRealPath(options.root);
    selectedEligibility = eligibility.filter(item => normalizedRealPath(item.project.root) === exact);
    if (selectedEligibility.length !== 1) throw new Error(`No exact registered root: ${options.root}`);
  } else if (options.project) {
    const search = options.project.toLowerCase();
    selectedEligibility = eligibility.filter(item => item.project.name.toLowerCase().includes(search) || item.project.root.toLowerCase().includes(search));
    if (selectedEligibility.length !== 1) throw new Error(`--project must resolve to exactly one project; use --root for mutation (matched ${selectedEligibility.length})`);
  }
  const targets = selectedEligibility.filter(item => item.eligible).map(item => item.project);
  const excluded = selectedEligibility.filter(item => !item.eligible);
  for (const item of excluded) console.log(`  ○ Excluded ${item.project.root}: ${item.reason}`);
  const missingSelectedRoots = excluded.filter(item => item.reason === "missing" || item.reason === "missing-wolf-directory").map(item => item.project.root);

  if (options.profile) normalizeReviewerProfile(options.profile);
  if (options.behavior) normalizeBehaviorMode(options.behavior);

  console.log(`OpenWolf v${version} — updating ${targets.length} project(s)${dryRun ? " (dry run)" : ""}...\n`);

  const results: UpdateResult[] = [];
  const pm2Processes = listPm2Processes();
  const daemonRootsToRemove: string[] = [...missingSelectedRoots];
  let daemonPreserved = 0;
  let daemonNotRunning = 0;

  for (const project of targets) {
    const result = await updateProject(project, version, dryRun, options.profile, options.behavior);
    results.push(result);
    if (result.status !== "updated") continue;
    const config = readJSON<unknown>(path.join(project.root, ".wolf", "config.json"), {});
    if (shouldAutoStartDaemon(config)) {
      daemonPreserved++;
      continue;
    }
    daemonRootsToRemove.push(project.root);
  }

  const cleanup = cleanupOpenWolfPm2({
    projectRoots: daemonRootsToRemove,
    pruneStale: !options.project && !options.root,
    dryRun: dryRun,
    processes: pm2Processes,
  });

  // Trigger normal registry validation only after stale PM2 correlation.
  if (!dryRun) getRegisteredProjects(true);

  // Summary
  console.log("\n─── Update Summary ───");
  const updated = results.filter(r => r.status === "updated");
  const skipped = results.filter(r => r.status === "skipped");
  const errors = results.filter(r => r.status === "error");

  if (updated.length > 0) {
    console.log(`\n  ✓ Updated (${updated.length}):`);
    for (const r of updated) {
      console.log(`    ${r.project.name} — ${r.message}`);
    }
  }
  if (skipped.length > 0) {
    console.log(`\n  ○ Skipped (${skipped.length}):`);
    for (const r of skipped) {
      console.log(`    ${r.project.name} — ${r.message}`);
    }
  }
  if (errors.length > 0) {
    console.log(`\n  ✗ Errors (${errors.length}):`);
    for (const r of errors) {
      console.log(`    ${r.project.name} — ${r.message}`);
    }
  }

  console.log("\n  Daemon migration:");
  console.log(`    ${dryRun ? "Would remove" : "Removed"}: ${cleanup.removed.length}`);
  console.log(`    Preserved by explicit auto_start: ${daemonPreserved}`);
  daemonNotRunning = cleanup.notFound.length;
  console.log(`    Not running: ${daemonNotRunning}`);
  console.log(`    Stale owned entries found: ${cleanup.staleFound}`);
  console.log("");
}

async function updateProject(
  project: RegisteredProject,
  version: string,
  dryRun: boolean,
  profile?: string,
  behavior?: string
): Promise<UpdateResult> {
  const { root, name } = project;
  const wolfDir = path.join(root, ".wolf");

  // Validate project still exists
  if (!fs.existsSync(wolfDir)) {
    return { project, status: "skipped", message: ".wolf/ directory not found" };
  }

  // Never update the source checkout itself, regardless of its registry name.
  if (isSourceProject(project)) {
    return { project, status: "skipped", message: "openwolf source repo — skipped" };
  }

  console.log(`  ${name} (${root})`);

  // Already at this version?
  if (project.version === version) {
    console.log(`    Already at v${version} — updating hooks/templates anyway`);
  }

  if (dryRun) {
    const config = readJSON<any>(path.join(wolfDir, "config.json"), {});
    const configuredBehavior = config?.openwolf?.behavior?.mode;
    const currentBehavior = configuredBehavior === "quiet" || configuredBehavior === "standard" ? configuredBehavior : "standard";
    const resultingBehavior = normalizeBehaviorMode(behavior) ?? currentBehavior;
    const profileText = profile ? `; reviewer profile → ${normalizeReviewerProfile(profile)}` : "";
    console.log(`    [dry run] Behavior: ${currentBehavior} → ${resultingBehavior}${configuredBehavior ? " (explicit)" : " (legacy compatibility)"}`);
    console.log(`    [dry run] Would create a verified backup, preserve pending reviews, update hooks/templates/skills/rules, then apply retention${profileText}`);
    return { project, status: "updated", message: `would update to v${version}; behavior ${currentBehavior} → ${resultingBehavior}${profileText}` };
  }

  let backupDir: string | undefined;
  try {
    const preUpdateConfig = readJSON<any>(path.join(wolfDir, "config.json"), {});
    const preUpdateBehavior = preUpdateConfig?.openwolf?.behavior?.mode;
    const legacyBehaviorAbsent = preUpdateBehavior !== "quiet" && preUpdateBehavior !== "standard";
    // 1. Create backup
    backupDir = createBackup(wolfDir);
    console.log(`    ✓ Backup: ${path.basename(backupDir)}`);

    // 2. Update template files (OPENWOLF.md, config.json)
    const templatesDir = findTemplatesDir();
    for (const file of ALWAYS_OVERWRITE) {
      const srcPath = path.join(templatesDir, file);
      const destPath = path.join(wolfDir, file);
      if (fs.existsSync(srcPath)) {
        safeCopyFile(srcPath, destPath);
      } else if (file === ".gitignore") {
        // Missing-template packaging layout: fall back to the embedded policy
        // (same as init) instead of silently leaving a stale .wolf/.gitignore
        // that may still ignore durable knowledge like buglog.json.
        generateTemplate(destPath, file);
      }
    }
    console.log(`    ✓ Templates updated (${ALWAYS_OVERWRITE.join(", ")})`);

    for (const file of CREATE_IF_MISSING) {
      const srcPath = path.join(templatesDir, file);
      const destPath = path.join(wolfDir, file);
      if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
        safeCopyFile(srcPath, destPath);
      }
    }
    mergeConfigDefaults(path.join(templatesDir, "config.json"), path.join(wolfDir, "config.json"));
    const appliedBehavior = applyBehaviorMode(path.join(wolfDir, "config.json"), behavior ?? (legacyBehaviorAbsent ? "standard" : undefined), "existing");
    console.log(`    ✓ Behavior: ${appliedBehavior}`);
    const appliedProfile = applyReviewerProfile(path.join(wolfDir, "config.json"), profile);
    if (appliedProfile) {
      console.log(`    ✓ Reviewer profile: ${appliedProfile}`);
    }

    updateQaDirectory(templatesDir, wolfDir);
    console.log(`    ✓ QA scaffold updated`);

    // 3. Update hook scripts
    copyHookScripts(wolfDir);
    console.log(`    ✓ Hook scripts updated`);

    // 4. Update .claude/settings.json hooks
    const claudeDir = path.join(root, ".claude");
    ensureDir(claudeDir);
    const settingsPath = path.join(claudeDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      const existing = readJSON<Record<string, unknown>>(settingsPath, {});
      const merged = replaceOpenWolfHooks(existing, HOOK_SETTINGS);
      writeJSON(settingsPath, merged);
    } else {
      writeJSON(settingsPath, HOOK_SETTINGS);
    }
    console.log(`    ✓ Claude settings updated`);

    installManagedClaudeSkills(templatesDir, root);
    console.log(`    ✓ Managed Claude skills updated`);

    // 5. Consolidate instructions into the global contract without guessing at user-authored content.
    const { planClaudeMd, mergeGlobalContract, isOwnedOpenWolfRule } = await import("./instruction-consolidation.js");
    const claudeMdPath = path.join(root, "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      const plan = planClaudeMd(readText(claudeMdPath));
      if (plan.action === "delete") fs.unlinkSync(claudeMdPath);
      else if (plan.action === "remove-bootstrap" && plan.output !== undefined) writeText(claudeMdPath, plan.output);
      else if (plan.action === "manual-review") console.log(`    ⚠ CLAUDE.md contains an ambiguous WolfPack reference; preserved`);
    }
    const rulePath = path.join(claudeDir, "rules", "openwolf.md");
    if (fs.existsSync(rulePath)) {
      const knownRule = readTemplateContent("claude-rules-openwolf.md", templatesDir);
      if (isOwnedOpenWolfRule(readText(rulePath), knownRule)) fs.unlinkSync(rulePath);
      else console.log(`    ⚠ Modified .claude/rules/openwolf.md preserved`);
    }
    const globalPath = process.env.OPENWOLF_GLOBAL_CLAUDE_PATH ?? path.join(os.homedir(), ".claude", "CLAUDE.md");
    const contract = readTemplateContent("global-claude-wolfpack.md", templatesDir);
    writeText(globalPath, mergeGlobalContract(readText(globalPath), contract));
    console.log(`    ✓ Instructions consolidated`);

    // 7. Clean up stale .tmp files
    try {
      const files = fs.readdirSync(wolfDir);
      let cleaned = 0;
      for (const f of files) {
        if (f.endsWith(".tmp")) {
          try { fs.unlinkSync(path.join(wolfDir, f)); cleaned++; } catch {}
        }
      }
      if (cleaned > 0) console.log(`    ✓ Cleaned ${cleaned} stale .tmp file(s)`);
    } catch {}

    // 8. Update registry entry
    registerProject(root, name, version);
    const pruned = pruneEligibleBackups(wolfDir, backupDir);
    if (pruned.length > 0) console.log(`    ✓ Pruned ${pruned.length} expired backup(s)`);

    return {
      project,
      status: "updated",
      backupDir,
      message: `v${project.version} → v${version}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const recovery = backupDir ? ` Backup preserved at ${backupDir}. Restore with: openwolf restore ${path.basename(backupDir)}` : " No backup was created.";
    return { project, status: "error", backupDir, message: msg + recovery };
  }
}

/**
 * Create a timestamped backup of all .wolf files into .wolf/backups/YYYY-MM-DD_HHMMSS/
 */
function createBackup(wolfDir: string): string {
  const now = new Date();
  const baseStamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15); // 20260315T0130
  const backupsDir = path.join(wolfDir, "backups");
  ensureDir(backupsDir);
  let stamp = baseStamp;
  let suffix = 1;
  let backupDir = path.join(backupsDir, stamp);
  while (true) {
    try {
      fs.mkdirSync(backupDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      stamp = `${baseStamp}-${suffix++}`;
      backupDir = path.join(backupsDir, stamp);
    }
  }

  // Backup all relevant files
  for (const file of BACKUP_FILES) {
    const src = path.join(wolfDir, file);
    if (fs.existsSync(src)) {
      safeCopyFile(src, path.join(backupDir, file));
    }
  }

  // Also backup hooks
  const hooksDir = path.join(wolfDir, "hooks");
  if (fs.existsSync(hooksDir)) {
    const hooksBackup = path.join(backupDir, "hooks");
    ensureDir(hooksBackup);
    try {
      // Recurse: hooks/ now contains a nested nudges/ tree. A flat copy backed
      // up only top-level files, so a rollback could not restore the nudge
      // modules and would leave stop.js importing modules that no longer exist.
      //
      // Back up EVERY file, not just .js: hooks/package.json carries
      // {"type":"module"} and is required for ESM resolution, and .mjs helpers
      // and _session.json state live here too. A backup is a fidelity copy —
      // the narrower .js filter is right for installing, wrong for restoring.
      safeCopyDir(hooksDir, hooksBackup, () => true);
    } catch {}
  }

  // Also backup .claude/settings.json and rules
  const projectRoot = path.dirname(wolfDir);
  const claudeSettings = path.join(projectRoot, ".claude", "settings.json");
  if (fs.existsSync(claudeSettings)) {
    const claudeBackup = path.join(backupDir, ".claude");
    ensureDir(claudeBackup);
    safeCopyFile(claudeSettings, path.join(claudeBackup, "settings.json"));
  }
  backupManagedClaudeSkills(projectRoot, backupDir);

  const claudeRules = path.join(projectRoot, ".claude", "rules", "openwolf.md");
  if (fs.existsSync(claudeRules)) {
    const rulesBackup = path.join(backupDir, ".claude", "rules");
    ensureDir(rulesBackup);
    safeCopyFile(claudeRules, path.join(rulesBackup, "openwolf.md"));
  }
  const rootClaudeMd = path.join(projectRoot, "CLAUDE.md");
  writeJSON(path.join(backupDir, "root-claude-state.json"), { present: fs.existsSync(rootClaudeMd) });
  if (fs.existsSync(rootClaudeMd)) safeCopyFile(rootClaudeMd, path.join(backupDir, "CLAUDE.md"));

  const configBytes = fs.existsSync(path.join(wolfDir, "config.json"))
    ? fs.readFileSync(path.join(wolfDir, "config.json"))
    : Buffer.from("");
  const reviewLog = readJSON<any>(path.join(wolfDir, "reviewlog.json"), { reviews: [] });
  const pendingReviews = Array.isArray(reviewLog?.reviews)
    ? reviewLog.reviews.filter((review: any) => !["completed", "resolved", "dismissed", "superseded"].includes(String(review?.status ?? "pending").toLowerCase()))
      .map((review: any) => ({ id: review.id ?? null, hash: review.hash ?? review.content_hash ?? review.reviewed_hash ?? null }))
    : [];
  writeJSON(path.join(backupDir, "backup-manifest.json"), {
    version: 1,
    created_at: now.toISOString(),
    source_version: getVersion(),
    config_sha256: crypto.createHash("sha256").update(configBytes).digest("hex"),
    pending_reviews: pendingReviews,
  });
  for (const required of ["config.json", "hooks", "backup-manifest.json"]) {
    if (!fs.existsSync(path.join(backupDir, required))) throw new Error(`Backup verification failed: missing ${required}`);
  }
  return backupDir;
}

export function planBackupRetention(wolfDir: string, currentBackup?: string): { keep: string[]; prune: string[]; protected: Record<string, string> } {
  const cfg = readJSON<any>(path.join(wolfDir, "config.json"), {});
  const retentionDays = Math.max(0, Number(cfg?.openwolf?.backups?.retention_days ?? 30));
  const keepLast = Math.max(1, Number(cfg?.openwolf?.backups?.keep_last ?? 3));
  const protectPending = cfg?.openwolf?.backups?.protect_pending_reviews !== false;
  const backupsDir = path.join(wolfDir, "backups");
  if (!fs.existsSync(backupsDir)) return { keep: [], prune: [], protected: {} };
  const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(backupsDir, entry.name))
    .sort((a, b) => b.localeCompare(a));
  const keep = new Set<string>();
  const protectedReasons: Record<string, string> = {};
  entries.slice(0, keepLast).forEach(entry => { keep.add(entry); protectedReasons[entry] = "keep_last"; });
  const cutoff = Date.now() - retentionDays * 86400000;
  for (const entry of entries) {
    if (entry === currentBackup) { keep.add(entry); protectedReasons[entry] = "current_update"; continue; }
    const manifestPath = path.join(entry, "backup-manifest.json");
    if (!fs.existsSync(manifestPath)) { keep.add(entry); protectedReasons[entry] = "unverified_or_legacy"; continue; }
    const manifest = readJSON<any>(manifestPath, null);
    const created = Date.parse(manifest?.created_at ?? "");
    if (!Number.isFinite(created)) { keep.add(entry); protectedReasons[entry] = "malformed_manifest"; continue; }
    if (created >= cutoff) { keep.add(entry); protectedReasons[entry] = "within_retention"; continue; }
    if (protectPending && Array.isArray(manifest?.pending_reviews) && manifest.pending_reviews.length > 0) {
      keep.add(entry); protectedReasons[entry] = "pending_reviews";
    }
  }
  return { keep: entries.filter(entry => keep.has(entry)), prune: entries.filter(entry => !keep.has(entry)), protected: protectedReasons };
}

function pruneEligibleBackups(wolfDir: string, currentBackup: string): string[] {
  const plan = planBackupRetention(wolfDir, currentBackup);
  const removed: string[] = [];
  for (const entry of plan.prune) {
    fs.rmSync(entry, { recursive: true, force: false });
    removed.push(entry);
  }
  return removed;
}

// ─── Shared helpers (extracted from init.ts patterns) ─────────────

function mergeMissingDefaults(existing: unknown, defaults: unknown): unknown {
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    return existing === undefined ? defaults : existing;
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return defaults;
  }
  const out: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  for (const [key, value] of Object.entries(defaults as Record<string, unknown>)) {
    out[key] = key in out ? mergeMissingDefaults(out[key], value) : value;
  }
  return out;
}

function mergeConfigDefaults(srcPath: string, destPath: string): void {
  if (!fs.existsSync(srcPath) || !fs.existsSync(destPath)) return;
  const defaults = readJSON<Record<string, unknown>>(srcPath, {});
  const existing = readJSON<Record<string, unknown>>(destPath, {});
  const merged = mergeMissingDefaults(existing, defaults);
  writeJSON(destPath, migrateReviewCompanionConfig(merged));
}

function updateQaDirectory(templatesDir: string, wolfDir: string): void {
  const qaDir = path.join(wolfDir, "qa");
  ensureDir(qaDir);

  for (const name of ["_README.md", "_template.md"]) {
    const src = path.join(templatesDir, "qa", name);
    const dest = path.join(qaDir, name);
    if (fs.existsSync(src)) {
      safeCopyFile(src, dest);
    }
  }

  const gateLogDest = path.join(qaDir, "_gate-log.json");
  if (!fs.existsSync(gateLogDest)) {
    const src = path.join(templatesDir, "qa", "_gate-log.json");
    if (fs.existsSync(src)) {
      safeCopyFile(src, gateLogDest);
    } else {
      fs.writeFileSync(gateLogDest, JSON.stringify({ version: 1, entries: [] }, null, 2) + "\n", "utf-8");
    }
  }
}

function readTemplateContent(filename: string, templatesDir: string): string {
  const filePath = path.join(templatesDir, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  const templates: Record<string, string> = {
    "claude-rules-openwolf.md": `---\ndescription: OpenWolf protocol enforcement — active on all files\nglobs: **/*\n---\n\n- Check .wolf/anatomy.md before reading any project file\n- Check .wolf/cerebrum.md Do-Not-Repeat list before generating code\n- After writing or editing files, update .wolf/anatomy.md and append to .wolf/memory.md\n- After receiving a user correction, update .wolf/cerebrum.md immediately (Preferences, Learnings, or Do-Not-Repeat)\n- LEARN from every interaction: if you discover a convention, user preference, or project pattern, add it to .wolf/cerebrum.md. Low threshold — when in doubt, log it.\n- BEFORE fixing any bug or error: read .wolf/buglog.json for known fixes\n- AFTER fixing any bug, error, failed test, failed build, or user-reported problem: ALWAYS log to .wolf/buglog.json with error_message, root_cause, fix, and tags\n- If you edit a file more than twice in a session, that likely indicates a bug — log it to .wolf/buglog.json\n- When the user asks to check/evaluate UI design: run \`openwolf designqc\` to capture screenshots, then read them from .wolf/designqc-captures/\n- When the user asks to change/pick/migrate UI framework: read .wolf/reframe-frameworks.md, ask decision questions, recommend a framework, then execute with the framework's prompt`,
  };
  return templates[filename] ?? "";
}

function copyHookScripts(wolfDir: string): void {
  const hooksDir = path.join(wolfDir, "hooks");
  ensureDir(hooksDir);

  const candidates = [
    path.join(__dirname, "..", "hooks"),
    path.resolve(__dirname, "..", "..", "hooks"),
    path.resolve(__dirname, "..", "..", "dist", "hooks"),
  ];

  let sourceDir = "";
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "shared.js"))) {
      sourceDir = candidate;
      break;
    }
  }

  const hookFiles = [
    "session-start.js",
    "pre-read.js",
    "pre-write.js",
    "post-read.js",
    "post-write.js",
    "stop.js",
    "shared.js",
    "complete-review.js",
  ];

  if (sourceDir) {
    for (const file of hookFiles) {
      const src = path.join(sourceDir, file);
      if (fs.existsSync(src)) {
        safeCopyFile(src, path.join(hooksDir, file));
      }
    }

    // stop.js imports ./nudges/engine.js and ./nudges/rules/*.js. The flat
    // hookFiles allowlist cannot express a nested tree, so copy it wholesale.
    // Without this an updated project gets the importer without its imports
    // and the Stop hook dies with ERR_MODULE_NOT_FOUND — silently, since the
    // project hook wrapper swallows import errors.
    const nudgesSrcDir = path.join(sourceDir, "nudges");
    if (fs.existsSync(nudgesSrcDir)) {
      safeCopyDir(nudgesSrcDir, path.join(hooksDir, "nudges"));
    }

    // Hooks and helper scripts import compiled utilities via ../utils/*.js.
    // Keep .wolf/utils as a sibling of .wolf/hooks so those relative imports
    // resolve in projects upgraded with `openwolf update`, not only fresh init.
    const utilsSrcDir = path.resolve(sourceDir, "..", "utils");
    if (fs.existsSync(utilsSrcDir)) {
      const utilsDestDir = path.resolve(hooksDir, "..", "utils");
      ensureDir(utilsDestDir);
      for (const entry of fs.readdirSync(utilsSrcDir)) {
        if (entry.endsWith(".js")) {
          safeCopyFile(path.join(utilsSrcDir, entry), path.join(utilsDestDir, entry));
        }
      }
      fs.writeFileSync(path.join(utilsDestDir, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n", "utf-8");
    }
  }

  // Always ensure package.json with type:module
  const hooksPkgPath = path.join(hooksDir, "package.json");
  fs.writeFileSync(hooksPkgPath, JSON.stringify({ type: "module" }, null, 2) + "\n", "utf-8");
}

function replaceOpenWolfHooks(
  existing: Record<string, unknown>,
  hookSettings: typeof HOOK_SETTINGS
): Record<string, unknown> {
  const merged = { ...existing };
  if (!merged.hooks) merged.hooks = {};
  const hooks = merged.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ command?: string; type: string }> }>>;

  for (const [event, newMatchers] of Object.entries(hookSettings.hooks)) {
    if (!hooks[event]) hooks[event] = [];

    // Remove existing OpenWolf hook entries
    hooks[event] = hooks[event].filter((entry) => {
      const isOpenWolfHook = entry.hooks?.some(
        (h) => h.command && h.command.includes(".wolf/hooks/")
      );
      return !isOpenWolfHook;
    });

    // Add new OpenWolf hooks
    for (const matcher of newMatchers) {
      hooks[event].push(matcher);
    }
  }

  return merged;
}

/**
 * List all registered projects (for `openwolf update --list`)
 */
export function listProjects(): void {
  const projects = getRegisteredProjects(true);

  if (projects.length === 0) {
    console.log("No registered OpenWolf projects.");
    console.log("Run 'openwolf init' in a project directory to register it.");
    return;
  }

  console.log(`Registered OpenWolf projects (${projects.length}):\n`);
  for (const p of projects) {
    const age = Math.floor((Date.now() - new Date(p.last_updated).getTime()) / (1000 * 60 * 60 * 24));
    console.log(`  ${p.name}`);
    console.log(`    Path: ${p.root}`);
    console.log(`    Version: ${p.version} | Updated: ${age}d ago`);
    console.log("");
  }
}

/**
 * Restore a project's .wolf from a backup
 */
export function restoreCommand(backupName?: string): void {
  const wolfDir = path.join(findProjectRoot(), ".wolf");
  const backupsDir = path.join(wolfDir, "backups");

  if (!fs.existsSync(backupsDir)) {
    console.log("No backups found for this project.");
    return;
  }

  const backups = fs.readdirSync(backupsDir)
    .filter(d => fs.statSync(path.join(backupsDir, d)).isDirectory())
    .sort()
    .reverse();

  if (backups.length === 0) {
    console.log("No backups found.");
    return;
  }

  if (!backupName) {
    console.log(`Available backups (${backups.length}):\n`);
    for (const b of backups) {
      const files = fs.readdirSync(path.join(backupsDir, b)).filter(f => !fs.statSync(path.join(backupsDir, b, f)).isDirectory());
      console.log(`  ${b} (${files.length} files)`);
    }
    console.log(`\nTo restore: openwolf restore <backup-name>`);
    return;
  }

  const backupDir = path.join(backupsDir, backupName);
  if (!fs.existsSync(backupDir)) {
    console.log(`Backup "${backupName}" not found.`);
    return;
  }

  // Restore files
  const backupMetadata = new Set(["backup-manifest.json", "root-claude-state.json", "CLAUDE.md"]);
  const files = fs.readdirSync(backupDir).filter(f => !backupMetadata.has(f) && fs.statSync(path.join(backupDir, f)).isFile());
  for (const file of files) {
    safeCopyFile(path.join(backupDir, file), path.join(wolfDir, file));
  }

  // Restore hooks if present
  const hooksBackup = path.join(backupDir, "hooks");
  if (fs.existsSync(hooksBackup)) {
    const hooksDir = path.join(wolfDir, "hooks");
    ensureDir(hooksDir);
    // Recurse, and copy every file type — must mirror the backup above.
    // The previous flat loop called safeCopyFile on directory entries with no
    // isFile() guard, so once hooks/ gained the nested nudges/ tree a restore
    // threw EISDIR and aborted PART-WAY, leaving hooks/ half rolled back.
    safeCopyDir(hooksBackup, hooksDir, () => true);
  }

  const projectRoot = path.dirname(wolfDir);
  const rootClaudeState = readJSON<{ present?: boolean }>(path.join(backupDir, "root-claude-state.json"), {});
  const rootClaudeDest = path.join(projectRoot, "CLAUDE.md");
  if (rootClaudeState.present && fs.existsSync(path.join(backupDir, "CLAUDE.md"))) {
    safeCopyFile(path.join(backupDir, "CLAUDE.md"), rootClaudeDest);
  } else if (rootClaudeState.present === false && fs.existsSync(rootClaudeDest)) {
    fs.unlinkSync(rootClaudeDest);
  }

  // Restore .claude settings if present
  const claudeBackup = path.join(backupDir, ".claude");
  if (fs.existsSync(claudeBackup)) {
    const settingsBackup = path.join(claudeBackup, "settings.json");
    if (fs.existsSync(settingsBackup)) {
      const dest = path.join(projectRoot, ".claude", "settings.json");
      ensureDir(path.dirname(dest));
      safeCopyFile(settingsBackup, dest);
    }
    restoreManagedClaudeSkills(projectRoot, backupDir, findTemplatesDir());

    const rulesBackup = path.join(claudeBackup, "rules", "openwolf.md");
    if (fs.existsSync(rulesBackup)) {
      const dest = path.join(projectRoot, ".claude", "rules", "openwolf.md");
      ensureDir(path.dirname(dest));
      safeCopyFile(rulesBackup, dest);
    }
  }

  console.log(`Restored ${files.length} files from backup "${backupName}".`);
}
