import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { readJSON, tryWriteJSON, safeCopyDir } from "../utils/fs-safe.js";

export interface SkillsBenchConfig {
  sourceUrl: string;
  sourceRef: string;
  cadence: "weekly";
  skills: Array<{ id: string; path: string }>;
}

interface SkillLock {
  id: string;
  path: string;
  hash: string;
}

interface SkillsBenchLock {
  version: 1;
  commit: string;
  activeRelease: string;
  releaseKey: string;
  previousRelease?: string;
  skills: SkillLock[];
  updatedAt: string;
  lastResult: "ok" | "failed";
}

export const DEFAULT_SKILLSBENCH_CONFIG: SkillsBenchConfig = {
  sourceUrl: "https://github.com/benchflow-ai/skillsbench.git",
  sourceRef: "HEAD",
  cadence: "weekly",
  skills: [
    { id: "pdf", path: "tasks/pdf-excel-diff/environment/skills/pdf" },
    { id: "xlsx", path: "tasks/pdf-excel-diff/environment/skills/xlsx" },
    { id: "docx", path: "tasks/offer-letter-generator/environment/skills/docx" },
    { id: "pptx", path: "tasks/pptx-reference-formatting/environment/skills/pptx" },
    { id: "image-ocr", path: "tasks/jpg-ocr-stat/environment/skills/image-ocr" },
    { id: "video-frame-extraction", path: "tasks/jpg-ocr-stat/environment/skills/video-frame-extraction" },
  ],
};

const MARKETPLACE_NAME = "skillsbench-standard";
const PLUGIN_NAME = "standard-skills";
const SCHEDULE_MARKER = "# openwolf-skillsbench-managed";

function homeDir(): string { return process.env.HOME || os.homedir(); }
function stateDir(): string { return path.join(homeDir(), ".openwolf", "skillsbench"); }
function checkoutDir(): string { return path.join(homeDir(), "projects", "skillsbench", "upstream"); }
function configPath(): string { return path.join(stateDir(), "config.json"); }
function lockPath(): string { return path.join(stateDir(), "lock.json"); }
function releasesDir(): string { return path.join(stateDir(), "releases"); }
function activeLink(): string { return path.join(stateDir(), "active"); }
function marketplaceLink(): string { return path.join(homeDir(), ".claude", "plugins", "marketplaces", MARKETPLACE_NAME); }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashDirectory(root: string): string {
  if (!fs.lstatSync(root).isDirectory()) throw new Error(`Expected a real directory: ${root}`);
  const entries: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new Error(`Skill tree contains unsupported symlink or special entry: ${path.relative(root, absolute)}`);
      }
      if (entry.isDirectory()) visit(absolute);
      else entries.push(`${path.relative(root, absolute).split(path.sep).join("/")}\0${sha256(fs.readFileSync(absolute))}`);
    }
  };
  visit(root);
  return sha256(entries.join("\n"));
}

function validateConfig(value: unknown): SkillsBenchConfig {
  const config = value as Partial<SkillsBenchConfig>;
  if (!config || typeof config.sourceUrl !== "string" || !config.sourceUrl || typeof config.sourceRef !== "string" || !Array.isArray(config.skills) || config.skills.length === 0) {
    throw new Error("SkillsBench config is malformed.");
  }
  const seen = new Set<string>();
  for (const skill of config.skills) {
    if (!skill || typeof skill.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(skill.id) || typeof skill.path !== "string" || !skill.path || path.isAbsolute(skill.path) || skill.path.split(/[\\/]+/).includes("..") || seen.has(skill.id)) {
      throw new Error("SkillsBench config has an invalid, duplicate, or escaping skill entry.");
    }
    seen.add(skill.id);
  }
  return { sourceUrl: config.sourceUrl, sourceRef: config.sourceRef, cadence: "weekly", skills: config.skills.map(skill => ({ id: skill.id, path: skill.path })) };
}

function loadConfig(create: boolean): SkillsBenchConfig {
  if (!fs.existsSync(configPath())) {
    if (!create) return clone(DEFAULT_SKILLSBENCH_CONFIG);
    fs.mkdirSync(stateDir(), { recursive: true });
    if (!tryWriteJSON(configPath(), DEFAULT_SKILLSBENCH_CONFIG)) throw new Error("Could not write SkillsBench configuration.");
  }
  return validateConfig(readJSON<unknown>(configPath(), DEFAULT_SKILLSBENCH_CONFIG));
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function ensureCheckout(config: SkillsBenchConfig): string {
  const checkout = checkoutDir();
  if (!fs.existsSync(checkout)) {
    fs.mkdirSync(path.dirname(checkout), { recursive: true });
    // Do not let clone's default branch choose the release. The configured ref is
    // always resolved below, including when it is a tag or a commit SHA.
    git(["clone", "--no-checkout", config.sourceUrl, checkout]);
  } else if (!fs.existsSync(path.join(checkout, ".git"))) {
    throw new Error(`SkillsBench checkout path is not a Git checkout: ${checkout}`);
  }
  git(["fetch", "--depth", "1", "origin", config.sourceRef], checkout);
  const revision = git(["rev-parse", "FETCH_HEAD^{commit}"], checkout);
  git(["checkout", "--detach", "--force", revision], checkout);
  return revision;
}

function validateSkill(checkout: string, skill: { id: string; path: string }): SkillLock {
  const source = path.resolve(checkout, skill.path);
  if (!isInside(checkout, source) || !fs.statSync(source).isDirectory()) throw new Error(`Skill ${skill.id} path is missing or escapes the checkout.`);
  const skillMd = path.join(source, "SKILL.md");
  if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) throw new Error(`Skill ${skill.id} is missing SKILL.md.`);
  const body = fs.readFileSync(skillMd, "utf8");
  const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---/);
  const name = frontmatter?.[1].match(/^name:\s*["']?([^\s"']+)["']?\s*$/m)?.[1];
  if (name !== skill.id) throw new Error(`Skill ${skill.id} frontmatter name must exactly equal its configured id.`);
  return { id: skill.id, path: skill.path, hash: hashDirectory(source) };
}

interface SymlinkReplacement { restore(): void; commit(): void; }

function replaceSymlink(target: string, destination: string): SymlinkReplacement {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && !fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error(`Refusing to replace non-managed path: ${destination}`);
  }
  const suffix = `${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  const temporary = `${destination}.${suffix}.tmp`;
  const backup = `${destination}.${suffix}.backup`;
  fs.symlinkSync(target, temporary, "junction");
  const hadDestination = fs.existsSync(destination);
  try {
    if (hadDestination) fs.renameSync(destination, backup);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { if (fs.existsSync(backup)) fs.renameSync(backup, destination); } catch {}
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return {
    restore: () => {
      try { fs.unlinkSync(destination); } catch {}
      if (hadDestination && fs.existsSync(backup)) fs.renameSync(backup, destination);
    },
    commit: () => { try { fs.unlinkSync(backup); } catch {} },
  };
}

function releaseKey(commit: string, skills: SkillLock[]): string {
  const manifest = skills.map(skill => [skill.id, skill.path, skill.hash]).sort((a, b) => a[0].localeCompare(b[0]));
  return `${commit}-${sha256(JSON.stringify(manifest)).slice(0, 16)}`;
}

function buildRelease(checkout: string, commit: string, skills: SkillLock[]): { path: string; key: string } {
  const key = releaseKey(commit, skills);
  const release = path.join(releasesDir(), key);
  const staging = `${release}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.staging`;
  fs.rmSync(staging, { recursive: true, force: true });
  const pluginRoot = path.join(staging, "marketplace", "plugins", PLUGIN_NAME);
  try {
    for (const skill of skills) safeCopyDir(path.join(checkout, skill.path), path.join(pluginRoot, "skills", skill.id), () => true);
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    const pluginVersion = `0.1.0+${commit.slice(0, 12)}`;
    fs.writeFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({ name: PLUGIN_NAME, version: pluginVersion, description: "Selected SkillsBench standard skills", metadata: { skillsbenchCommit: commit } }, null, 2) + "\n");
    fs.mkdirSync(path.join(staging, "marketplace", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(staging, "marketplace", ".claude-plugin", "marketplace.json"), JSON.stringify({ name: MARKETPLACE_NAME, owner: { name: "OpenWolf" }, metadata: { description: "Locally generated SkillsBench standard skills", skillsbenchCommit: commit }, plugins: [{ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}`, version: pluginVersion }] }, null, 2) + "\n");
    for (const skill of skills) {
      const copied = path.join(pluginRoot, "skills", skill.id);
      if (hashDirectory(copied) !== skill.hash) throw new Error(`Release copy hash mismatch for ${skill.id}.`);
    }
    fs.mkdirSync(releasesDir(), { recursive: true });
    if (!fs.existsSync(release)) fs.renameSync(staging, release);
    else fs.rmSync(staging, { recursive: true, force: true });
    return { path: release, key };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function activateRelease(release: string): { commit(): void; restore(): void } {
  const active = replaceSymlink(release, activeLink());
  try {
    const marketplace = replaceSymlink(path.join(release, "marketplace"), marketplaceLink());
    return {
      commit: () => { active.commit(); marketplace.commit(); },
      restore: () => { marketplace.restore(); active.restore(); },
    };
  } catch (error) {
    active.restore();
    throw error;
  }
}

function ensurePluginRegistration(): void {
  if (process.env.OPENWOLF_SKILLSBENCH_SKIP_PLUGIN_CLI === "1") return;
  const claude = process.env.OPENWOLF_CLAUDE_BIN || "claude";
  const run = (args: string[], allowFailure = false): string => {
    const result = spawnSync(claude, args, { encoding: "utf8" });
    if (result.error || (!allowFailure && result.status !== 0)) {
      throw new Error(`Claude plugin command failed: ${args.join(" ")}\n${result.stderr || result.error?.message || ""}`.trim());
    }
    return `${result.stdout || ""}\n${result.stderr || ""}`;
  };
  const id = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  const listed = run(["plugin", "list"]);
  if (!listed.includes(id)) {
    const added = run(["plugin", "marketplace", "add", marketplaceLink()], true);
    if (!added.includes(MARKETPLACE_NAME) && !added.toLowerCase().includes("already")) {
      throw new Error(`Could not register SkillsBench marketplace: ${added.trim()}`);
    }
    run(["plugin", "install", id, "--scope", "user"]);
  } else {
    run(["plugin", "update", id]);
  }
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

export function buildScheduledCommand(executable: string, entrypoint: string, logPath: string): string {
  return `${shellQuote(executable)} ${shellQuote(entrypoint)} skills update --quiet >> ${shellQuote(logPath)} 2>&1`;
}

export function managedCron(crontab: string, command: string, present: boolean): string {
  const lines = crontab.split("\n").filter(line => !line.includes(SCHEDULE_MARKER));
  if (present) lines.push(`17 4 * * 1 ${command} ${SCHEDULE_MARKER}`);
  return `${lines.filter(Boolean).join("\n")}\n`;
}

function installSchedule(present: boolean): string {
  if (process.env.OPENWOLF_SKILLSBENCH_DISABLE_SCHEDULE === "1") return "disabled by environment";
  const existing = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (existing.error) return "crontab unavailable";
  const logDir = path.join(stateDir(), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const command = buildScheduledCommand(process.execPath, path.resolve(process.argv[1] || "openwolf"), path.join(logDir, "weekly.log"));
  const next = managedCron(existing.status === 0 ? existing.stdout : "", command, present);
  const applied = spawnSync("crontab", ["-"], { input: next, encoding: "utf8" });
  if (applied.status !== 0) throw new Error(`Could not update SkillsBench crontab entry: ${applied.stderr.trim()}`);
  return present ? "weekly crontab installed" : "weekly crontab removed";
}

function prerequisiteStatus(): Record<string, boolean> {
  const available = (command: string, versionArg = "--version") => spawnSync(command, [versionArg], { stdio: "ignore" }).status === 0;
  return { git: available("git"), python: available("python3"), tesseract: available("tesseract"), ffmpeg: available("ffmpeg", "-version") };
}

export async function skillsUpdate(options: { dryRun?: boolean; quiet?: boolean; schedule?: boolean } = {}): Promise<void> {
  const dryRun = options.dryRun === true;
  const config = loadConfig(!dryRun);
  if (dryRun) {
    console.log(`Would fetch ${config.sourceUrl} and validate ${config.skills.length} configured SkillsBench skills.`);
    return;
  }
  const transactionLock = path.join(stateDir(), ".update.lock");
  fs.mkdirSync(stateDir(), { recursive: true });
  let lockHandle: number;
  try {
    lockHandle = fs.openSync(transactionLock, "wx");
    fs.writeFileSync(lockHandle, `${process.pid}\n`);
  } catch {
    throw new Error("Another SkillsBench update is already running.");
  }
  try {
    const commit = ensureCheckout(config);
    const skills = config.skills.map(skill => validateSkill(checkoutDir(), skill));
    const prior = readJSON<SkillsBenchLock | null>(lockPath(), null);
    const release = buildRelease(checkoutDir(), commit, skills);
    const activation = activateRelease(release.path);
    try {
      ensurePluginRegistration();
    } catch (error) {
      activation.restore();
      throw error;
    }
    activation.commit();
    const lock: SkillsBenchLock = { version: 1, commit, activeRelease: release.key, releaseKey: release.key, previousRelease: prior?.activeRelease, skills, updatedAt: new Date().toISOString(), lastResult: "ok" };
    if (!tryWriteJSON(lockPath(), lock)) throw new Error("Could not write SkillsBench lock.");
    if (options.schedule) installSchedule(true);
    if (!options.quiet) console.log(`Activated SkillsBench release ${commit.slice(0, 12)} with ${skills.length} skills.`);
  } catch (error) {
    const prior = readJSON<SkillsBenchLock | null>(lockPath(), null);
    if (prior) tryWriteJSON(lockPath(), { ...prior, lastResult: "failed", updatedAt: new Date().toISOString() });
    if (options.quiet) process.exitCode = 1;
    else throw error;
  } finally {
    try { fs.closeSync(lockHandle); } catch {}
    try { fs.unlinkSync(transactionLock); } catch {}
  }
}

export async function skillsInit(options: { dryRun?: boolean; quiet?: boolean } = {}): Promise<void> {
  await skillsUpdate({ ...options, schedule: !options.dryRun });
}

export function skillsStatus(): void {
  const config = loadConfig(false);
  const lock = readJSON<SkillsBenchLock | null>(lockPath(), null);
  console.log(`SkillsBench source: ${config.sourceUrl}`);
  console.log(`Selected skills: ${config.skills.map(skill => skill.id).join(", ")}`);
  console.log(`Active release: ${lock?.activeRelease || "none"}`);
  console.log(`Previous release: ${lock?.previousRelease || "none"}`);
  console.log(`Last result: ${lock?.lastResult || "never"}`);
  console.log(`Prerequisites: ${Object.entries(prerequisiteStatus()).map(([name, available]) => `${name}=${available ? "available" : "missing"}`).join(", ")}`);
}

export function skillsDoctor(): void {
  const lock = readJSON<SkillsBenchLock | null>(lockPath(), null);
  if (!lock) throw new Error("No active SkillsBench release. Run 'openwolf skills init'.");
  const release = path.join(releasesDir(), lock.activeRelease);
  if (!fs.existsSync(release) || !fs.existsSync(path.join(release, "marketplace", ".claude-plugin", "marketplace.json"))) throw new Error("Active SkillsBench release is incomplete.");
  for (const skill of lock.skills) {
    const installed = path.join(release, "marketplace", "plugins", PLUGIN_NAME, "skills", skill.id);
    if (!fs.existsSync(installed) || hashDirectory(installed) !== skill.hash) throw new Error(`Installed skill hash mismatch: ${skill.id}`);
  }
  if (!fs.existsSync(marketplaceLink()) || !fs.lstatSync(marketplaceLink()).isSymbolicLink()) throw new Error("Generated SkillsBench marketplace is not active.");
  if (process.env.OPENWOLF_SKILLSBENCH_SKIP_PLUGIN_CLI !== "1") {
    const installed = spawnSync(process.env.OPENWOLF_CLAUDE_BIN || "claude", ["plugin", "list"], { encoding: "utf8" });
    if (installed.error || installed.status !== 0 || !installed.stdout.includes(`${PLUGIN_NAME}@${MARKETPLACE_NAME}`)) {
      throw new Error("SkillsBench plugin is not registered with Claude Code.");
    }
  }
  console.log(`SkillsBench doctor: healthy (${lock.skills.length} skills; ${lock.commit.slice(0, 12)}).`);
}

export function skillsRollback(revision?: string): void {
  const lock = readJSON<SkillsBenchLock | null>(lockPath(), null);
  if (!lock) throw new Error("No SkillsBench release to roll back.");
  const target = revision || lock.previousRelease;
  if (!target || !/^[0-9a-f]{7,64}(?:-[0-9a-f]{16})?$/i.test(target)) throw new Error("No valid previous SkillsBench release is available.");
  const release = path.join(releasesDir(), target);
  if (!fs.existsSync(release)) throw new Error(`SkillsBench release not found: ${target}`);
  const activation = activateRelease(release);
  try {
    ensurePluginRegistration();
  } catch (error) {
    activation.restore();
    throw error;
  }
  activation.commit();
  if (!tryWriteJSON(lockPath(), { ...lock, activeRelease: target, releaseKey: target, previousRelease: lock.activeRelease, updatedAt: new Date().toISOString(), lastResult: "ok" })) throw new Error("Could not update SkillsBench lock after rollback.");
  console.log(`Rolled back SkillsBench to ${target.slice(0, 12)}.`);
}

export function skillsRemoveSchedule(): void { console.log(installSchedule(false)); }
