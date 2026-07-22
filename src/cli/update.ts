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
import { fileURLToPath } from "node:url";
import { getRegisteredProjects, registerProject, type RegisteredProject } from "./registry.js";
import { applyReviewerProfile, migrateReviewCompanionConfig, normalizeReviewerProfile, shouldAutoStartDaemon } from "./init.js";
import { cleanupOpenWolfPm2, listPm2Processes } from "./daemon-cmd.js";
import { readJSON, writeJSON, readText, writeText, safeCopyFile } from "../utils/fs-safe.js";
import { ensureDir } from "../utils/paths.js";

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

// Files that are safe to overwrite (protocol/config)
const ALWAYS_OVERWRITE = ["OPENWOLF.md", "PROTOCOL-UPGRADE-2026-06.md", "reframe-frameworks.md", ".gitignore"];
const CREATE_IF_MISSING = ["config.json"];

// Files that contain user data — NEVER overwrite, only create if missing
const USER_DATA_FILES = [
  "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
  "token-ledger.json", "buglog.json", "cron-manifest.json", "cron-state.json",
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

export async function updateCommand(options: { dryRun?: boolean; force?: boolean; project?: string; profile?: string }): Promise<void> {
  const version = getVersion();
  const dryRun = options.dryRun ?? false;
  // Keep missing projects long enough to correlate and remove their owned PM2
  // registrations before registry validation drops them.
  const allProjects = getRegisteredProjects(false);
  const projects = allProjects.filter(project => fs.existsSync(path.join(project.root, ".wolf")));

  if (allProjects.length === 0) {
    console.log("No registered OpenWolf projects found.");
    console.log("Run 'openwolf init' in a project directory to register it.");
    return;
  }

  // Filter against all registrations so a scoped update can clean a missing project's owned daemon.
  let selected = allProjects;
  if (options.project) {
    const search = options.project.toLowerCase();
    selected = allProjects.filter(p =>
      p.name.toLowerCase().includes(search) ||
      p.root.toLowerCase().includes(search)
    );
    if (selected.length === 0) {
      console.log(`No registered project matching "${options.project}".`);
      console.log("Registered projects:");
      for (const p of allProjects) {
        console.log(`  - ${p.name} (${p.root})`);
      }
      return;
    }
  }
  const targets = selected.filter(project => fs.existsSync(path.join(project.root, ".wolf")));
  const missingSelectedRoots = selected.filter(project => !fs.existsSync(path.join(project.root, ".wolf"))).map(project => project.root);

  if (options.profile) {
    normalizeReviewerProfile(options.profile);
  }

  console.log(`OpenWolf v${version} — updating ${targets.length} project(s)${dryRun ? " (dry run)" : ""}...\n`);

  const results: UpdateResult[] = [];
  const pm2Processes = listPm2Processes();
  const daemonRootsToRemove: string[] = [...missingSelectedRoots];
  let daemonPreserved = 0;
  let daemonNotRunning = 0;

  for (const project of targets) {
    const result = await updateProject(project, version, dryRun, options.profile);
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
    pruneStale: !options.project,
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
  profile?: string
): Promise<UpdateResult> {
  const { root, name } = project;
  const wolfDir = path.join(root, ".wolf");

  // Validate project still exists
  if (!fs.existsSync(wolfDir)) {
    return { project, status: "skipped", message: ".wolf/ directory not found" };
  }

  // Never update the openwolf source repo itself
  if (name === "openwolf") {
    return { project, status: "skipped", message: "openwolf source repo — skipped" };
  }

  console.log(`  ${name} (${root})`);

  // Already at this version?
  if (project.version === version) {
    console.log(`    Already at v${version} — updating hooks/templates anyway`);
  }

  if (dryRun) {
    const profileText = profile ? ` and set reviewer profile to ${normalizeReviewerProfile(profile)}` : "";
    console.log(`    [dry run] Would backup, update hooks, templates, rules${profileText}`);
    return { project, status: "updated", message: `would update to v${version}${profileText}` };
  }

  try {
    // 1. Create backup
    const backupDir = createBackup(wolfDir);
    console.log(`    ✓ Backup: ${path.basename(backupDir)}`);

    // 2. Update template files (OPENWOLF.md, config.json)
    const templatesDir = findTemplatesDir();
    for (const file of ALWAYS_OVERWRITE) {
      const srcPath = path.join(templatesDir, file);
      const destPath = path.join(wolfDir, file);
      if (fs.existsSync(srcPath)) {
        safeCopyFile(srcPath, destPath);
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

    // 5. Update .claude/rules/openwolf.md
    const rulesDir = path.join(claudeDir, "rules");
    ensureDir(rulesDir);
    const rulesContent = readTemplateContent("claude-rules-openwolf.md", templatesDir);
    writeText(path.join(rulesDir, "openwolf.md"), rulesContent);
    console.log(`    ✓ Claude rules updated`);

    // 6. Update CLAUDE.md snippet if it references OpenWolf
    const claudeMdPath = path.join(root, "CLAUDE.md");
    const snippetContent = readTemplateContent("claude-md-snippet.md", templatesDir);
    if (fs.existsSync(claudeMdPath)) {
      const existing = readText(claudeMdPath);
      if (!existing.includes("OpenWolf")) {
        writeText(claudeMdPath, snippetContent + "\n\n" + existing);
        console.log(`    ✓ CLAUDE.md updated`);
      }
    }

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

    return {
      project,
      status: "updated",
      backupDir,
      message: `v${project.version} → v${version}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { project, status: "error", message: msg };
  }
}

/**
 * Create a timestamped backup of all .wolf files into .wolf/backups/YYYY-MM-DD_HHMMSS/
 */
function createBackup(wolfDir: string): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15); // 20260315T013000
  const backupDir = path.join(wolfDir, "backups", stamp);
  ensureDir(backupDir);

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
      const hookFiles = fs.readdirSync(hooksDir);
      for (const f of hookFiles) {
        const src = path.join(hooksDir, f);
        if (fs.statSync(src).isFile()) {
          safeCopyFile(src, path.join(hooksBackup, f));
        }
      }
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
  const claudeRules = path.join(projectRoot, ".claude", "rules", "openwolf.md");
  if (fs.existsSync(claudeRules)) {
    const rulesBackup = path.join(backupDir, ".claude", "rules");
    ensureDir(rulesBackup);
    safeCopyFile(claudeRules, path.join(rulesBackup, "openwolf.md"));
  }

  return backupDir;
}

// ─── Shared helpers (extracted from init.ts patterns) ─────────────

function findTemplatesDir(): string {
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "src", "templates"),
    path.resolve(__dirname, "..", "..", "src", "templates"),
    path.resolve(__dirname, "..", "templates"),
    path.resolve(__dirname, "templates"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

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
    "claude-md-snippet.md": `# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`,
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
  const wolfDir = path.join(process.cwd(), ".wolf");
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
  const files = fs.readdirSync(backupDir).filter(f => fs.statSync(path.join(backupDir, f)).isFile());
  for (const file of files) {
    safeCopyFile(path.join(backupDir, file), path.join(wolfDir, file));
  }

  // Restore hooks if present
  const hooksBackup = path.join(backupDir, "hooks");
  if (fs.existsSync(hooksBackup)) {
    const hookFiles = fs.readdirSync(hooksBackup);
    const hooksDir = path.join(wolfDir, "hooks");
    ensureDir(hooksDir);
    for (const f of hookFiles) {
      safeCopyFile(path.join(hooksBackup, f), path.join(hooksDir, f));
    }
  }

  // Restore .claude settings if present
  const claudeBackup = path.join(backupDir, ".claude");
  if (fs.existsSync(claudeBackup)) {
    const projectRoot = path.dirname(wolfDir);
    const settingsBackup = path.join(claudeBackup, "settings.json");
    if (fs.existsSync(settingsBackup)) {
      const dest = path.join(projectRoot, ".claude", "settings.json");
      ensureDir(path.dirname(dest));
      safeCopyFile(settingsBackup, dest);
    }
    const rulesBackup = path.join(claudeBackup, "rules", "openwolf.md");
    if (fs.existsSync(rulesBackup)) {
      const dest = path.join(projectRoot, ".claude", "rules", "openwolf.md");
      ensureDir(path.dirname(dest));
      safeCopyFile(rulesBackup, dest);
    }
  }

  console.log(`Restored ${files.length} files from backup "${backupName}".`);
}
