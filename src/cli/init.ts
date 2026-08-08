import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { findProjectRoot } from "../scanner/project-root.js";
import { scanProject } from "../scanner/anatomy-scanner.js";
import { readJSON, writeJSON, readText, writeText, safeCopyFile, safeCopyDir } from "../utils/fs-safe.js";
import { ensureDir } from "../utils/paths.js";
import { isWindows } from "../utils/platform.js";
import { registerProject } from "./registry.js";
import { allocateProjectPorts, isPortFree } from "../utils/port-allocator.js";
import { cleanupOpenWolfPm2, ensurePm2Daemon, hasOpenWolfPm2Daemon } from "./daemon-cmd.js";
import { installManagedClaudeSkills } from "./managed-skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// Files that are safe to overwrite on upgrade (config/protocol, not user data)
const ALWAYS_OVERWRITE = [
  "OPENWOLF.md",
  "PROTOCOL-UPGRADE-2026-06.md",
  "reframe-frameworks.md",
  ".gitignore",
];

// Files that contain user/session data — only create if missing, never overwrite
const CREATE_IF_MISSING = [
  "identity.md",
  "cerebrum.md",
  "memory.md",
  "anatomy.md",
  "token-ledger.json",
  "buglog.json",
  "reviewlog.json",
  "cron-manifest.json",
  "cron-state.json",
  "designqc-report.json",
  "suggestions.json",
];

// Resolve $CLAUDE_PROJECT_DIR cross-platform via node -e instead of shell expansion.
// `$CLAUDE_PROJECT_DIR` is POSIX-only — on Windows cmd/PowerShell the literal reaches
// node's argv unmodified, producing paths like `C:\.wolf\hooks\stop.js` that don't
// exist. Reading `process.env.CLAUDE_PROJECT_DIR` inside `node -e` works on every OS
// because Node parses env vars the same way everywhere. The trailing `.catch(()=>{})`
// makes the hook a silent no-op when `.wolf/` is absent (e.g. a project that doesn't
// use OpenWolf but inherits the hooks from a global settings.json).
function hookCommand(file: string): string {
  return `node -e "import('node:url').then(({pathToFileURL})=>import(pathToFileURL(process.env.CLAUDE_PROJECT_DIR+'/.wolf/hooks/${file}').href)).catch(()=>{})"`;
}

const HOOK_SETTINGS = {
  hooks: {
    SessionStart: [
      { matcher: "", hooks: [{ type: "command", command: hookCommand("session-start.js"), timeout: 5 }] },
    ],
    PreToolUse: [
      { matcher: "Read", hooks: [{ type: "command", command: hookCommand("pre-read.js"), timeout: 5 }] },
      { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: hookCommand("pre-write.js"), timeout: 5 }] },
    ],
    PostToolUse: [
      { matcher: "Read", hooks: [{ type: "command", command: hookCommand("post-read.js"), timeout: 5 }] },
      { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: hookCommand("post-write.js"), timeout: 10 }] },
    ],
    Stop: [
      { matcher: "", hooks: [{ type: "command", command: hookCommand("stop.js"), timeout: 10 }] },
    ],
  },
};

export async function initCommand(options: { profile?: string } = {}): Promise<void> {
  // Check Node.js version
  const nodeVersion = parseInt(process.version.slice(1), 10);
  if (nodeVersion < 20) {
    console.error(`Node.js 20+ required. Current: ${process.version}`);
    process.exit(1);
  }

  // Detect project root
  const projectRoot = findProjectRoot();
  console.log(`Project root: ${projectRoot}`);

  const wolfDir = path.join(projectRoot, ".wolf");
  const isUpgrade = fs.existsSync(wolfDir);

  const version = getVersion();

  if (isUpgrade) {
    console.log(`Upgrading Wolfpack to v${version}...`);
  }

  // Create .wolf/ directory
  ensureDir(wolfDir);
  ensureDir(path.join(wolfDir, "hooks"));

  // Find templates directory
  const actualTemplatesDir = findTemplatesDir();

  // --- Template files ---
  let createdCount = 0;
  let skippedCount = 0;

  for (const file of ALWAYS_OVERWRITE) {
    writeTemplateFile(actualTemplatesDir, wolfDir, file);
    createdCount++;
  }

  if (!fs.existsSync(path.join(wolfDir, "config.json"))) {
    writeTemplateFile(actualTemplatesDir, wolfDir, "config.json");
    createdCount++;
  }

  for (const file of CREATE_IF_MISSING) {
    const destPath = path.join(wolfDir, file);
    if (fs.existsSync(destPath)) {
      skippedCount++;
    } else {
      writeTemplateFile(actualTemplatesDir, wolfDir, file);
      createdCount++;
    }
  }

  // Quality gate: scaffold .wolf/qa/ — README and template are overwritten on
  // upgrade (protocol docs), _gate-log.json is create-if-missing (user data).
  seedQaDirectory(actualTemplatesDir, wolfDir);

  // --- Cerebrum: seed project info only if fresh ---
  if (!isUpgrade) {
    seedCerebrum(wolfDir, projectRoot);
    seedIdentity(wolfDir, projectRoot);
  }

  const configPath = path.join(wolfDir, "config.json");
  const cfg = readJSON<unknown>(configPath, {});
  const daemonAutoStart = shouldAutoStartDaemon(cfg);

  // Port allocation is only needed when the user explicitly opted into an
  // always-on daemon. On-demand commands allocate ports when they start it.
  if (daemonAutoStart && (!isUpgrade || !hasOpenWolfPm2Daemon(projectRoot))) {
    const normalized = normalizeDaemonConfig(cfg);
    try {
      const dashboardFree = await isPortFree(normalized.openwolf.dashboard.port);
      const daemonFree = await isPortFree(normalized.openwolf.daemon.port);
      if (!dashboardFree || !daemonFree) {
        const { daemon, dashboard } = await allocateProjectPorts(projectRoot);
        normalized.openwolf.daemon.port = daemon;
        normalized.openwolf.dashboard.port = dashboard;
        writeJSON(configPath, normalized);
        console.log(`  ✓ Allocated per-project ports: daemon=${daemon}, dashboard=${dashboard}`);
      }
    } catch (e) {
      console.warn(`  ⚠ Port allocation failed (${(e as Error).message}); keeping configured daemon/dashboard ports`);
    }
  }

  migrateReviewCompanionConfigFile(configPath);
  applyReviewerProfile(configPath, options.profile);

  // --- Token ledger: set created_at only if empty ---
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  const ledger = readJSON<Record<string, unknown>>(ledgerPath, {});
  if (!ledger.created_at) {
    ledger.created_at = new Date().toISOString();
    writeJSON(ledgerPath, ledger);
  }

  // --- Hook scripts: always update (bug fixes, new features) ---
  copyHookScripts(wolfDir);

  // --- Claude settings: replace OpenWolf hooks (upgrade old paths) ---
  const claudeDir = path.join(projectRoot, ".claude");
  ensureDir(claudeDir);

  const settingsPath = path.join(claudeDir, "settings.json");
  if (fs.existsSync(settingsPath)) {
    const existing = readJSON<Record<string, unknown>>(settingsPath, {});
    const merged = replaceOpenWolfHooks(existing, HOOK_SETTINGS);
    writeJSON(settingsPath, merged);
  } else {
    writeJSON(settingsPath, HOOK_SETTINGS);
  }

  // --- Managed Claude skills: always update exact Wolfpack-owned files ---
  installManagedClaudeSkills(actualTemplatesDir, projectRoot);

  // --- Claude rules: always update ---
  const rulesDir = path.join(claudeDir, "rules");
  ensureDir(rulesDir);
  const rulesContent = readTemplateContent("claude-rules-openwolf.md", actualTemplatesDir);
  writeText(path.join(rulesDir, "openwolf.md"), rulesContent);

  // --- CLAUDE.md: add snippet if missing ---
  const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
  const snippetContent = readTemplateContent("claude-md-snippet.md", actualTemplatesDir);
  if (fs.existsSync(claudeMdPath)) {
    const existing = readText(claudeMdPath);
    const oldSnippetPattern = /# OpenWolf\n\n@\.wolf\/OPENWOLF\.md\n\nThis project uses OpenWolf for context management\. Read and follow \.wolf\/OPENWOLF\.md every session\. Check \.wolf\/cerebrum\.md before generating code\. Check \.wolf\/anatomy\.md before reading files\.?\n*/;
    if (existing.includes("# Wolfpack") || existing.includes("This project uses Wolfpack")) {
      // Already carries the current Wolfpack-facing bootstrap.
    } else if (oldSnippetPattern.test(existing)) {
      writeText(claudeMdPath, existing.replace(oldSnippetPattern, snippetContent + "\n\n"));
    } else if (!existing.includes("OpenWolf")) {
      writeText(claudeMdPath, snippetContent + "\n\n" + existing);
    }
  } else {
    writeText(claudeMdPath, snippetContent);
  }

  // --- Anatomy scan: only on fresh init ---
  let fileCount = 0;
  if (!isUpgrade) {
    try {
      fileCount = scanProject(wolfDir, projectRoot);
    } catch {
      console.log("  Anatomy scan deferred — will run on first session.");
    }
  } else {
    // On upgrade, read existing count
    try {
      const anatomyContent = readText(path.join(wolfDir, "anatomy.md"));
      const m = anatomyContent.match(/Files:\s*(\d+)/);
      fileCount = m ? parseInt(m[1], 10) : 0;
    } catch {
      fileCount = 0;
    }
  }

  const verifyInstallMode = process.env.OPENWOLF_VERIFY_INSTALL === "1";

  // --- Optional daemon ---
  let daemonStatus = "disabled by default; start on demand with: openwolf daemon start";
  if (verifyInstallMode) {
    daemonStatus = "disabled by default (install verification)";
  } else if (!daemonAutoStart) {
    if (isUpgrade) {
      const cleanup = cleanupOpenWolfPm2({ projectRoots: [projectRoot] });
      if (cleanup.removed.length > 0) {
        daemonStatus = `disabled by default; removed ${cleanup.removed[0]} from PM2`;
      }
    }
  } else {
    try {
      const pm2Cmd = isWindows() ? "where pm2" : "which pm2";
      execSync(pm2Cmd, { stdio: "ignore" });
      try {
        const result = ensurePm2Daemon(projectRoot, { silent: true });
        daemonStatus = result.status === "already-running"
          ? `auto-start enabled; already registered via pm2 (${result.name})`
          : `auto-start enabled; ${result.status} via pm2 (${result.name})`;
      } catch {
        daemonStatus = "auto-start enabled, but daemon start failed. Try: openwolf daemon start";
      }
    } catch {
      daemonStatus = "auto-start enabled, but pm2 is not installed";
    }
  }

  // --- Register in central registry (skip if this IS the openwolf source repo) ---
  if (!verifyInstallMode) {
    try {
      const projectName = detectProjectName(projectRoot);
      if (projectName === "openwolf") {
        // Don't register the openwolf dev repo — it would get updated by `openwolf update`
      } else {
        registerProject(projectRoot, projectName, version);
      }
    } catch {
      // Non-fatal — registry is a convenience feature
    }
  }

  // --- Summary ---
  console.log("");
  if (isUpgrade) {
    console.log(`  ✓ Wolfpack upgraded to v${version}`);
    console.log(`  ✓ All .wolf runtime data preserved (${skippedCount} files: cerebrum, memory, anatomy, buglog, ledger)`);
    console.log(`  ✓ Hook scripts updated (6 hooks)`);
    console.log(`  ✓ ${createdCount} config files updated`);
    console.log(`  ✓ Anatomy: ${fileCount} files tracked (unchanged)`);
  } else {
    console.log(`  ✓ Wolfpack v${version} initialized`);
    console.log(`  ✓ .wolf/ runtime created with ${createdCount} files`);
    console.log(`  ✓ Claude Code hooks registered (6 hooks)`);
    console.log(`  ✓ CLAUDE.md updated`);
    console.log(`  ✓ .claude/rules/openwolf.md created`);
    console.log(`  ✓ Anatomy scan: ${fileCount} files indexed`);
  }
  if (options.profile) {
    const reviewerProfile = normalizeReviewerProfile(options.profile);
    console.log(`  ✓ Reviewer profile: ${reviewerProfile}`);
  }
  console.log(`  ✓ Daemon: ${daemonStatus}`);
  console.log(`  ✓ Dashboard: available on demand with: openwolf dashboard`);
  console.log("");
  console.log("  You're ready. Wolfpack quality hooks are active whenever you use Claude Code.");
  console.log("");
}

// ─── Helpers ─────────────────────────────────────────────────

export function findTemplatesDir(): string {
  let current = __dirname;
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      const pkg = readJSON<{ name?: string }>(packagePath, {});
      if (pkg.name === ["custom", "openwolf"].join("")) {
        const templatesDir = path.join(current, "src", "templates");
        if (fs.existsSync(templatesDir)) return templatesDir;
        throw new Error(`OpenWolf templates missing from package root: ${templatesDir}`);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not resolve the Wolfpack package root from ${__dirname}`);
}

export function writeTemplateFile(templatesDir: string, wolfDir: string, file: string): void {
  const srcPath = path.join(templatesDir, file);
  const destPath = path.join(wolfDir, file);
  if (fs.existsSync(srcPath)) {
    safeCopyFile(srcPath, destPath);
  } else if (file === "OPENWOLF.md") {
    throw new Error(`Required OpenWolf protocol template missing: ${srcPath}`);
  } else {
    generateTemplate(destPath, file);
  }
}

// Scaffold .wolf/qa/ for the quality gate. _README.md and _template.md are
// protocol docs — overwritten on every init/upgrade. _gate-log.json is user
// data — created on first init, then left alone.
function seedQaDirectory(templatesDir: string, wolfDir: string): void {
  const qaDir = path.join(wolfDir, "qa");
  ensureDir(qaDir);

  const overwriteAlways = ["_README.md", "_template.md"];
  for (const name of overwriteAlways) {
    const src = path.join(templatesDir, "qa", name);
    const dest = path.join(qaDir, name);
    if (fs.existsSync(src)) {
      safeCopyFile(src, dest);
    } else {
      fs.writeFileSync(dest, embeddedQaTemplate(name), "utf-8");
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

function embeddedQaTemplate(name: string): string {
  if (name === "_README.md") {
    return "# Quality Gate — Adversarial Reductions\n\nSee .wolf/OPENWOLF.md \"Quality Gate\" section. The Stop hook nudges (soft mode) when an edited source file lacks a current reduction here. Each reduction names ≥3 concrete assumptions, picks the riskiest, and pastes the output of a falsification test against it. Frontmatter must include `target-hash` (sha256 of the target file) so the gate can detect staleness.\n";
  }
  if (name === "_template.md") {
    return "---\ntarget: <relative path>\ntarget-hash: <sha256 of the target file>\ncreated: YYYY-MM-DD\n---\n\n# <title>\n\n## What the code claims to do\n\n## Assumptions (≥3)\n\n1. **<name>** — concrete statement.\n2. **<name>** — …\n3. **<name>** — …\n\n## Riskiest assumption\n\n## Falsification test\n\n```bash\n# command\n```\n\n## Run output\n\n```\n<actual output>\n```\n\n## Verdict\n\n- [ ] Survived.\n- [ ] Falsified — link the fix.\n";
  }
  return "";
}

export function normalizeReviewerProfile(profile?: string): "us-only" | "open" | "budget" | undefined {
  if (!profile) return undefined;
  const normalized = profile.trim().toLowerCase();
  if (["gov", "government", "us-only", "us", "american"].includes(normalized)) return "us-only";
  if (["open", "normal", "default", "unrestricted"].includes(normalized)) return "open";
  if (["budget", "token-rich", "cheap", "low-cost", "glm"].includes(normalized)) return "budget";
  throw new Error(`Unknown Wolfpack profile "${profile}". Use "gov", "open", or "budget".`);
}

export const LEGACY_CODEX_COMMAND_DEFAULT = "codex exec --full-auto";
export const REVIEW_COMPANION_DEFAULT = "provider companion";

export function shouldAutoStartDaemon(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const openwolf = (config as Record<string, unknown>).openwolf;
  if (!openwolf || typeof openwolf !== "object" || Array.isArray(openwolf)) return false;
  const daemon = (openwolf as Record<string, unknown>).daemon;
  if (!daemon || typeof daemon !== "object" || Array.isArray(daemon)) return false;
  return (daemon as Record<string, unknown>).auto_start === true;
}

function normalizeDaemonConfig(config: unknown): Record<string, any> {
  const cfg = config && typeof config === "object" && !Array.isArray(config)
    ? { ...(config as Record<string, any>) }
    : {};
  cfg.openwolf = cfg.openwolf && typeof cfg.openwolf === "object" && !Array.isArray(cfg.openwolf)
    ? { ...cfg.openwolf }
    : {};
  cfg.openwolf.daemon = cfg.openwolf.daemon && typeof cfg.openwolf.daemon === "object" && !Array.isArray(cfg.openwolf.daemon)
    ? { ...cfg.openwolf.daemon }
    : {};
  cfg.openwolf.dashboard = cfg.openwolf.dashboard && typeof cfg.openwolf.dashboard === "object" && !Array.isArray(cfg.openwolf.dashboard)
    ? { ...cfg.openwolf.dashboard }
    : {};
  cfg.openwolf.daemon.auto_start = cfg.openwolf.daemon.auto_start === true;
  cfg.openwolf.daemon.port = typeof cfg.openwolf.daemon.port === "number" ? cfg.openwolf.daemon.port : 18790;
  cfg.openwolf.dashboard.enabled = cfg.openwolf.dashboard.enabled === true;
  cfg.openwolf.dashboard.port = typeof cfg.openwolf.dashboard.port === "number" ? cfg.openwolf.dashboard.port : 18791;
  return cfg;
}

export function migrateReviewCompanionConfig(config: unknown): Record<string, any> {
  const cfg = config && typeof config === "object" && !Array.isArray(config)
    ? { ...(config as Record<string, any>) }
    : {};
  cfg.openwolf = cfg.openwolf && typeof cfg.openwolf === "object" && !Array.isArray(cfg.openwolf)
    ? { ...cfg.openwolf }
    : {};
  cfg.openwolf.review_hook = cfg.openwolf.review_hook && typeof cfg.openwolf.review_hook === "object" && !Array.isArray(cfg.openwolf.review_hook)
    ? { ...cfg.openwolf.review_hook }
    : {};
  const reviewHook = cfg.openwolf.review_hook;
  if (typeof reviewHook.review_companion !== "string" || reviewHook.review_companion.trim().length === 0) {
    reviewHook.review_companion = REVIEW_COMPANION_DEFAULT;
  }
  if (reviewHook.codex_command === LEGACY_CODEX_COMMAND_DEFAULT) {
    delete reviewHook.codex_command;
  }
  return cfg;
}

export function migrateReviewCompanionConfigFile(configPath: string): void {
  const existing = readJSON<unknown>(configPath, {});
  writeJSON(configPath, migrateReviewCompanionConfig(existing));
}

export function applyReviewerProfile(configPath: string, profile?: string): "us-only" | "open" | "budget" | undefined {
  const reviewerProfile = normalizeReviewerProfile(profile);
  if (!reviewerProfile) return undefined;
  const parsed = readJSON<Record<string, any>>(configPath, {});
  const cfg = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  cfg.openwolf = cfg.openwolf && typeof cfg.openwolf === "object" && !Array.isArray(cfg.openwolf) ? cfg.openwolf : {};
  cfg.openwolf.hook_messages = cfg.openwolf.hook_messages && typeof cfg.openwolf.hook_messages === "object" && !Array.isArray(cfg.openwolf.hook_messages) ? cfg.openwolf.hook_messages : {};
  cfg.openwolf.hook_messages.reviewer_profile = reviewerProfile;
  writeJSON(configPath, cfg);
  return reviewerProfile;
}

function readTemplateContent(filename: string, templatesDir: string): string {
  const filePath = path.join(templatesDir, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  return getEmbeddedTemplate(filename);
}

function getEmbeddedTemplate(filename: string): string {
  const templates: Record<string, string> = {
    "claude-md-snippet.md": `# Wolfpack\n\n@.wolf/OPENWOLF.md\n\nThis project uses Wolfpack, a heavily customized Claude Code workflow harness built on the OpenWolf runtime namespace. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`,
    "claude-rules-openwolf.md": `---\ndescription: Wolfpack protocol enforcement — active on all files\nglobs: **/*\n---\n\n- Check .wolf/anatomy.md before reading any project file\n- Check .wolf/cerebrum.md Do-Not-Repeat list before generating code\n- After writing or editing files, update .wolf/anatomy.md and append to .wolf/memory.md\n- After receiving a user correction, update .wolf/cerebrum.md immediately (Preferences, Learnings, or Do-Not-Repeat)\n- LEARN from every interaction: if you discover a convention, user preference, or project pattern, add it to .wolf/cerebrum.md. Low threshold — when in doubt, log it.\n- BEFORE fixing any bug or error: read .wolf/buglog.json for known fixes\n- AFTER fixing any bug, error, failed test, failed build, or user-reported problem: ALWAYS log to .wolf/buglog.json with error_message, root_cause, fix, and tags\n- If you edit a file more than twice in a session, that likely indicates a bug — log it to .wolf/buglog.json\n- When the user asks to check/evaluate UI design: run \`openwolf designqc\` to capture screenshots, then read them from .wolf/designqc-captures/\n- When the user asks to change/pick/migrate UI framework: read .wolf/reframe-frameworks.md, ask decision questions, recommend a framework, then execute with the framework's prompt`,
  };
  return templates[filename] ?? "";
}

export function generateTemplate(destPath: string, file: string): void {
  const templates: Record<string, string> = {
    "OPENWOLF.md": `# Wolfpack Operating Protocol\n\nYou are working in a Wolfpack-managed project. Wolfpack is the customized workflow harness; .wolf/ and openwolf.* remain the compatibility/runtime namespace. These rules apply every turn.\n\n## File Navigation\n\n1. Check \`.wolf/anatomy.md\` BEFORE reading any file.\n2. If the description is sufficient, do NOT read the full file.\n3. If a file is not in anatomy.md, search with Grep/Glob.\n\n## Code Generation\n\n1. Read \`.wolf/cerebrum.md\` and respect every entry.\n2. Check \`## Do-Not-Repeat\` section.\n\n## Standard Skills\n\nBefore recreating common workflows, check available standard skills and invoke the exact listed skill name when applicable. Skill instructions load on demand.\n\n## Recall Before Acting\n\nBefore starting non-trivial work, use Wolfpack's local memory in this order:\n\n1. Check \`.wolf/anatomy.md\` to locate only the files needed.\n2. Check \`.wolf/cerebrum.md\` for project conventions, user preferences, and do-not-repeat lessons.\n3. Check \`.wolf/buglog.json\` before fixing errors or repeating a pattern that may already have a known fix.\n4. Prefer applying an existing proven fix over rediscovering one. If the existing memory is stale or wrong, correct it as part of the work.\n\n## Link Fixes to Proof\n\nEvery buglog entry should connect the reported problem to the evidence that the fix was real:\n\n- \`commit\`: the resolving commit SHA when known, otherwise \`null\` until committed.\n- \`reduction\`: the QA reduction, test file, command, or transcript that proves the fix, otherwise \`null\` until evidence exists.\n\nWhen adding or updating a buglog entry, include both fields. If a bug is fixed before commit, fill \`reduction\` immediately and backfill \`commit\` after the fix is committed.\n\n## Consolidate When Noisy\n\nWolfpack memory should stay useful, not merely large. When \`.wolf/memory.md\`, \`.wolf/buglog.json\`, review logs, or QA logs become noisy:\n\n1. Preserve durable facts, current decisions, and recurring gotchas in \`.wolf/cerebrum.md\`.\n2. Keep raw chronological detail in the original log only when it is still operationally useful.\n3. Prefer compact summaries that link to proof files, reductions, review IDs, or commits.\n4. Do not delete user data just to reduce size; consolidate only when the retained summary is enough to recover the lesson.\n\n## After Actions\n\n1. Append to \`.wolf/memory.md\`.\n2. After file changes: update \`.wolf/anatomy.md\`.\n\n## Token Discipline\n\n- Never re-read a file already read this session.\n- Prefer anatomy.md descriptions over full reads.\n`,
    "identity.md": `# Identity\n\n- **Name:** Wolf\n- **Role:** AI development assistant for this project\n- **Tone:** Direct, concise, technically precise\n`,
    "cerebrum.md": `# Cerebrum\n\n> Wolfpack's learning memory. Updated automatically as the AI learns from interactions.\n> Do not edit manually unless correcting an error.\n> Last updated: —\n\n## User Preferences\n\n<!-- How the user likes things done. Code style, tools, patterns, communication. -->\n\n## Key Learnings\n\n<!-- Project-specific conventions discovered during development. -->\n\n## Do-Not-Repeat\n\n<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->\n<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->\n\n## Decision Log\n\n<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->\n`,
    "memory.md": `# Memory\n\n> Chronological action log. Hooks and AI append to this file automatically.\n> Old sessions are consolidated by the daemon weekly.\n\n## Session: bootstrap\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n`,
    "anatomy.md": `# anatomy.md\n\n> Auto-maintained by Wolfpack. Pending initial scan.\n> Files: 0 tracked | Anatomy hits: 0 | Misses: 0\n\n## Project\n\n- Run \`openwolf scan\` or \`openwolf init\` to populate this index with project files.\n`,
    "config.json": JSON.stringify({
      version: 1,
      openwolf: {
        enabled: true,
        anatomy: { auto_scan_on_init: true, rescan_interval_hours: 6, max_description_length: 100, max_files: 500, exclude_patterns: ["node_modules", ".git", "dist", "build", ".wolf", ".next", ".nuxt", "coverage", "__pycache__", ".cache", "target", ".vscode", ".idea", ".turbo", ".vercel", ".netlify", ".output", "*.min.js", "*.min.css"] },
        token_audit: { enabled: true, report_frequency: "weekly", waste_threshold_percent: 15, chars_per_token_code: 3.5, chars_per_token_prose: 4.0 },
        cron: { enabled: true, max_retry_attempts: 3, dead_letter_enabled: true, heartbeat_interval_minutes: 30, use_claude_p: true, api_key_env: null },
        memory: { consolidation_after_days: 7, max_entries_before_consolidation: 200 },
        cerebrum: { max_tokens: 2000, reflection_frequency: "weekly" },
        daemon: { auto_start: false, port: 18790, log_level: "info", auth_token: null },
        dashboard: { enabled: false, port: 18791 },
        designqc: { enabled: true, viewports: [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 375, height: 812 }], max_screenshots: 6, chrome_path: null },
        size_discipline: {
          enabled: true,
          buglog: { retention_days: 30 },
          reviewlog: { retention_days: 30 },
          memory: { retention_days: 30 },
          token_ledger: { max_inline_sessions: 60 },
          cerebrum: { retention_days: 180 },
          daemon_log: { max_bytes: 5242880, keep: 3 },
        },
        review_hook: {
          enabled: true,
          min_diff_lines: 40,
          always_review_paths: ["**/auth/**", "**/payment/**", "**/migrations/**"],
          review_companion: "provider companion",
          max_review_rounds: 3,
          nudge_only: true,
        },
        quality_gate: {
          enabled: true,
          scope: "all",
          scope_paths: [],
          min_assumptions: 3,
          require_run_output: true,
          nudge_only: true,
          retention_days: 30,
          verify_conclusions: {
            enabled: true,
            patterns: [
              "\\b(verdict|the (?:answer|finding|conclusion|result|edge|signal)\\s+is)\\b",
              "\\b(confirmed|proven|definitely|definitively|certainly)\\b",
              "\\b(works|fails|passes|broken|fixed|ready (?:to ship|for review))\\b",
              "\\b(t\\s*=\\s*-?\\d|p\\s*[<=>]\\s*0?\\.\\d|p-?value)\\b",
              "\\b(survivor|tradeable|profitable|unprofitable|economically (?:meaningful|meaningless))\\b",
              "\\b(devastating|catastrophic|dead|alive|holds|holds up)\\b",
            ],
            min_pattern_hits: 2,
            min_text_chars: 200,
            nudge_only: true,
          },
        },
      },
    }, null, 2),
    "token-ledger.json": JSON.stringify({ version: 1, created_at: "", lifetime: { total_tokens_estimated: 0, total_reads: 0, total_writes: 0, total_sessions: 0, anatomy_hits: 0, anatomy_misses: 0, repeated_reads_blocked: 0, estimated_savings_vs_bare_cli: 0 }, sessions: [], daemon_usage: [], waste_flags: [], optimization_report: { last_generated: null, patterns: [] } }, null, 2),
    "buglog.json": JSON.stringify({ version: 1, bugs: [] }, null, 2),
    "reviewlog.json": JSON.stringify({ version: 1, reviews: [] }, null, 2),
    "cron-manifest.json": JSON.stringify({ version: 1, tasks: [] }, null, 2),
    "cron-state.json": JSON.stringify({ last_heartbeat: null, engine_status: "initialized", execution_log: [], dead_letter_queue: [], upcoming: [] }, null, 2),
    "designqc-report.json": JSON.stringify({ captured_at: null, captures: [], total_size_kb: 0, estimated_tokens: 0 }, null, 2),
    "suggestions.json": JSON.stringify({ suggestions: [], generated_at: null }, null, 2),
    // Embedded fallback for the nested .wolf ignore policy — mirrors
    // src/templates/.gitignore. Without this, an upgrade on a packaging layout
    // missing the template would overwrite an existing .wolf/.gitignore with
    // zero bytes (companion review 2026-07-21, MEDIUM).
    ".gitignore": `# Wolfpack-managed ignore policy for .wolf/ runtime state.\n# Durable knowledge stays trackable: OPENWOLF.md, cerebrum.md, memory.md,\n# anatomy.md, identity.md, config.json, buglog.json, qa/_README.md,\n# qa/_template.md. Everything below is churn/state — safe to ignore.\n\n*.log\n**/*.log\n*-state.json\n**/*-state.json\ncron-state.json\ncron-manifest.json\ntoken-ledger.json\ncerebrum-stats.json\nsuggestions.json\nreviewlog.json\nskill-receipts/\ndesignqc-report.json\ndesignqc-captures/\n*.lock\n*.lock.reclaim\n**/*.lock\n**/*.lock.reclaim\nhooks/_session.json\nqa/_gate-log.json\nqa/*.md\n!qa/_README.md\n!qa/_template.md\nbackups/\nqueue-drops.json\nqueue-injections.json\narchive/\n`,
  };

  const content = templates[file] ?? "";
  fs.writeFileSync(destPath, content, "utf-8");
}

function seedCerebrum(wolfDir: string, projectRoot: string): void {
  const projectName = detectProjectName(projectRoot);
  const projectDescription = detectProjectDescription(projectRoot);
  if (!projectName && !projectDescription) return;

  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  let cerebrum = readText(cerebrumPath);
  const projectInfo = [
    `- **Project:** ${projectName || path.basename(projectRoot)}`,
    projectDescription ? `- **Description:** ${projectDescription}` : "",
  ].filter(Boolean).join("\n");

  // Insert after ## Key Learnings section
  cerebrum = cerebrum.replace(
    /## Key Learnings\n\n<!-- Project-specific conventions discovered during development\. -->/,
    `## Key Learnings\n\n${projectInfo}`
  );
  // Fallback: if the comment wasn't found (embedded template), try simpler pattern
  if (!cerebrum.includes("**Project:**")) {
    cerebrum = cerebrum.replace(
      /## Key Learnings\n/,
      `## Key Learnings\n\n${projectInfo}\n`
    );
  }
  cerebrum = cerebrum.replace(/Last updated: —/, `Last updated: ${new Date().toISOString().slice(0, 10)}`);
  writeText(cerebrumPath, cerebrum);
}

function seedIdentity(wolfDir: string, projectRoot: string): void {
  const projectName = detectProjectName(projectRoot);
  if (!projectName) return;

  const identityPath = path.join(wolfDir, "identity.md");
  let content = readText(identityPath);
  content = content.replace(/\*\*Name:\*\* Wolf/, `**Name:** ${projectName}`);
  content = content.replace(
    /\*\*Role:\*\* AI development assistant for this project/,
    `**Role:** AI development assistant for ${projectName}`
  );
  writeText(identityPath, content);
}

function copyHookScripts(wolfDir: string): void {
  const hooksDir = path.join(wolfDir, "hooks");
  ensureDir(hooksDir);

  // Single source of truth: the main `tsc` build (tsconfig.json) emits hooks
  // to dist/src/hooks/ because rootDir: "." preserves the src/ prefix. At
  // runtime __dirname is dist/src/cli/, so ../hooks resolves to dist/src/hooks.
  const hookSourceDir = path.join(__dirname, "..", "hooks");
  const srcHooksDir = path.resolve(__dirname, "..", "..", "..", "src", "hooks");

  const sourceDir =
    fs.existsSync(hookSourceDir) && fs.existsSync(path.join(hookSourceDir, "shared.js"))
      ? hookSourceDir
      : "";

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

  let copiedAny = false;
  if (sourceDir) {
    for (const file of hookFiles) {
      const src = path.join(sourceDir, file);
      if (fs.existsSync(src)) {
        safeCopyFile(src, path.join(hooksDir, file));
        copiedAny = true;
      }
    }
    // stop.js imports ./nudges/engine.js and ./nudges/rules/*.js. The flat
    // hookFiles allowlist above cannot express a nested tree, so copy it
    // wholesale — otherwise the Stop hook dies with ERR_MODULE_NOT_FOUND,
    // silently, because the project hook wrapper swallows import errors.
    const nudgesSrcDir = path.join(sourceDir, "nudges");
    if (fs.existsSync(nudgesSrcDir)) {
      const n = safeCopyDir(nudgesSrcDir, path.join(hooksDir, "nudges"));
      if (n > 0) copiedAny = true;
    }
    // Hooks reference compiled utilities via "../utils/size-discipline.js".
    // Place the utils as a sibling of hooks/ under .wolf/ so the relative
    // path resolves at runtime (.wolf/hooks/post-write.js → .wolf/utils/...).
    const utilsSrcDir = path.resolve(sourceDir, "..", "utils");
    if (fs.existsSync(utilsSrcDir)) {
      const utilsDestDir = path.resolve(hooksDir, "..", "utils");
      try { fs.mkdirSync(utilsDestDir, { recursive: true }); } catch {}
      for (const entry of fs.readdirSync(utilsSrcDir)) {
        if (entry.endsWith(".js")) {
          safeCopyFile(path.join(utilsSrcDir, entry), path.join(utilsDestDir, entry));
        }
      }
      fs.writeFileSync(path.join(utilsDestDir, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n", "utf-8");
    }
  } else if (fs.existsSync(srcHooksDir)) {
    // Dev mode: compile TS hooks inline using a simple copy with note.
    // In practice, user should run `pnpm build` first.
    for (const file of hookFiles) {
      const tsFile = file.replace(".js", ".ts");
      const src = path.join(srcHooksDir, tsFile);
      if (fs.existsSync(src)) {
        const loaderContent = `#!/usr/bin/env node\n// Auto-generated by openwolf init — run 'pnpm build' for compiled version\nimport("${src.replace(/\\/g, "/")}");\n`;
        fs.writeFileSync(path.join(hooksDir, file), loaderContent, "utf-8");
        copiedAny = true;
      }
    }
  }

  if (!copiedAny) {
    console.warn("  ⚠ Could not find compiled hook scripts. Run 'pnpm build' and re-run init.");
  }

  // Always write a package.json with type:module so ESM hooks work in any project
  const hooksPkgPath = path.join(hooksDir, "package.json");
  fs.writeFileSync(hooksPkgPath, JSON.stringify({ type: "module" }, null, 2) + "\n", "utf-8");
}

/**
 * Replace all OpenWolf hook entries in settings.json with the current version.
 * Removes old-style relative-path hooks and inserts the new $CLAUDE_PROJECT_DIR hooks.
 * Preserves any non-OpenWolf hooks the user may have added.
 */
function replaceOpenWolfHooks(
  existing: Record<string, unknown>,
  hookSettings: typeof HOOK_SETTINGS
): Record<string, unknown> {
  const merged = { ...existing };
  if (!merged.hooks) {
    merged.hooks = {};
  }
  const hooks = merged.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ command?: string; type: string }> }>>;

  for (const [event, newMatchers] of Object.entries(hookSettings.hooks)) {
    if (!hooks[event]) {
      hooks[event] = [];
    }

    // Remove any existing OpenWolf hook entries (match by .wolf/hooks/ in command)
    hooks[event] = hooks[event].filter((entry) => {
      const isOpenWolfHook = entry.hooks?.some(
        (h) => h.command && h.command.includes(".wolf/hooks/")
      );
      return !isOpenWolfHook;
    });

    // Add the new OpenWolf hooks
    for (const matcher of newMatchers) {
      hooks[event].push(matcher);
    }
  }

  return merged;
}

function detectProjectName(projectRoot: string): string {
  // Try package.json
  const pkgPath = path.join(projectRoot, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (pkg.name) return pkg.name;
  } catch {}
  // Try Cargo.toml
  try {
    const cargo = fs.readFileSync(path.join(projectRoot, "Cargo.toml"), "utf-8");
    const m = cargo.match(/^name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {}
  // Try pyproject.toml
  try {
    const py = fs.readFileSync(path.join(projectRoot, "pyproject.toml"), "utf-8");
    const m = py.match(/^name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {}
  return path.basename(projectRoot);
}

function detectProjectDescription(projectRoot: string): string {
  // Try package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    if (pkg.description) return pkg.description;
  } catch {}
  // Try README first line/paragraph
  for (const readme of ["README.md", "readme.md", "README.rst", "README.txt"]) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, readme), "utf-8");
      const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#") && !l.startsWith("=") && !l.startsWith("-") && !l.startsWith("!["));
      if (lines.length > 0) return lines[0].trim().slice(0, 200);
    } catch {}
  }
  return "";
}
