import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../utils/paths.js";
import { readJSON, readText, safeCopyFile, writeJSON, writeText } from "../utils/fs-safe.js";
import { classifyFleetProjects, readRegistry, type FleetEligibility } from "./registry.js";
import { findTemplatesDir } from "./init.js";

const CURRENT_BOOTSTRAP = `# Wolfpack\n\n@.wolf/OPENWOLF.md\n\nThis project uses Wolfpack, a heavily customized Claude Code workflow harness built on the OpenWolf runtime namespace. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`;
const LEGACY_BOOTSTRAP = `# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`;
const SIMPLE_CHRISTIANITY_BOOTSTRAP = `This project uses the same Wolfpack/OpenWolf harness as its sibling (\`/mnt/j/projectshome/projects/adventists/\`). Read and follow \`.wolf/OPENWOLF.md\` every session. Check \`.wolf/cerebrum.md\` before generating prose. Check \`.wolf/anatomy.md\` before reading files.`;
const GLOBAL_START = "<!-- wolfpack:global:start -->";
const GLOBAL_END = "<!-- wolfpack:global:end -->";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(__dirname, "../../..");

export type ClaudeMdClassification = "absent" | "wolfpack-only" | "mixed-recognized-bootstrap" | "project-only" | "ambiguous-wolfpack-reference";
export interface ClaudeMdPlan { classification: ClaudeMdClassification; output?: string; action: "none" | "delete" | "remove-bootstrap" | "preserve" | "manual-review"; }

function normalizedForMatch(value: string): string {
  return value.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

export function planClaudeMd(content?: string): ClaudeMdPlan {
  if (content === undefined) return { classification: "absent", action: "none" };
  const normalized = normalizedForMatch(content);
  const matches = [CURRENT_BOOTSTRAP, LEGACY_BOOTSTRAP, SIMPLE_CHRISTIANITY_BOOTSTRAP]
    .map(block => ({ block, index: normalized.indexOf(block) }))
    .filter(match => match.index >= 0);
  if (matches.length !== 1) {
    const related = /(?:Wolfpack|OpenWolf|@\.wolf\/OPENWOLF\.md|\.wolf\/OPENWOLF\.md)/i.test(normalized);
    return related
      ? { classification: "ambiguous-wolfpack-reference", action: "manual-review" }
      : { classification: "project-only", action: "preserve", output: content };
  }
  const { block, index } = matches[0];
  const before = normalized.slice(0, index);
  const after = normalized.slice(index + block.length);
  if ((before + after).trim() === "") return { classification: "wolfpack-only", action: "delete" };
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const remaining = (before + after).replace(/^\s*\n/, "").replace(/\n\s*$/, "\n").replace(/\n{3,}/g, "\n\n");
  const output = (content.startsWith("﻿") ? "﻿" : "") + remaining.replace(/\n/g, newline);
  return { classification: "mixed-recognized-bootstrap", action: "remove-bootstrap", output };
}

export function mergeGlobalContract(existing: string, contract: string): string {
  const startCount = existing.split(GLOBAL_START).length - 1;
  const endCount = existing.split(GLOBAL_END).length - 1;
  if (startCount !== endCount || startCount > 1) throw new Error("Malformed or duplicate WolfPack global markers");
  const cleanContract = contract.trim();
  if (Buffer.byteLength(cleanContract) > 1500) throw new Error("WolfPack global contract exceeds 1500-byte budget");
  if (startCount === 0) return existing.trimEnd() + "\n\n" + cleanContract + "\n";
  const start = existing.indexOf(GLOBAL_START);
  const end = existing.indexOf(GLOBAL_END, start) + GLOBAL_END.length;
  return existing.slice(0, start) + cleanContract + existing.slice(end);
}

export function isOwnedOpenWolfRule(content: string, knownRule: string): boolean {
  return normalizedForMatch(content).trim() === normalizedForMatch(knownRule).trim();
}

function sha(content?: Buffer | string): string | null {
  return content === undefined ? null : crypto.createHash("sha256").update(content).digest("hex");
}
function fileBytes(file: string): Buffer | undefined { try { return fs.readFileSync(file); } catch { return undefined; } }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

interface SurfacePlan { path: string; before: string | null; action: string; after: string | null; classification?: string; }
interface ProjectPlan { root: string; realRoot: string; eligible: boolean; reason?: string; behavior?: string; profile?: string; claudeMd?: SurfacePlan; rule?: SurfacePlan; protocol?: SurfacePlan; }
export interface InstructionManifest { version: 1; sourceRoot: string; global: SurfacePlan; projects: ProjectPlan[]; }

function projectPlan(entry: FleetEligibility, compactProtocol: Buffer, knownRule: string): ProjectPlan {
  const { project, eligible, realRoot, reason } = entry;
  const base: ProjectPlan = { root: project.root, realRoot, eligible, reason };
  if (!eligible) return base;
  const config = readJSON<any>(path.join(project.root, ".wolf", "config.json"), {});
  base.behavior = config?.openwolf?.behavior?.mode ?? "standard";
  base.profile = config?.openwolf?.hook_messages?.reviewer_profile ?? "us-only";
  const claudePath = path.join(project.root, "CLAUDE.md");
  const claudeBytes = fileBytes(claudePath);
  const claude = planClaudeMd(claudeBytes?.toString("utf8"));
  base.claudeMd = { path: claudePath, before: sha(claudeBytes), action: claude.action, after: claude.action === "delete" ? null : sha(claude.output ?? claudeBytes), classification: claude.classification };
  const rulePath = path.join(project.root, ".claude", "rules", "openwolf.md");
  const ruleBytes = fileBytes(rulePath);
  const owned = ruleBytes !== undefined && isOwnedOpenWolfRule(ruleBytes.toString("utf8"), knownRule);
  base.rule = { path: rulePath, before: sha(ruleBytes), action: owned ? "delete" : ruleBytes ? "preserve" : "none", after: owned ? null : sha(ruleBytes), classification: owned ? "owned" : ruleBytes ? "modified" : "absent" };
  const protocolPath = path.join(project.root, ".wolf", "OPENWOLF.md");
  const protocolBytes = fileBytes(protocolPath);
  base.protocol = { path: protocolPath, before: sha(protocolBytes), action: sha(protocolBytes) === sha(compactProtocol) ? "none" : "replace", after: sha(compactProtocol) };
  return base;
}

export function buildInstructionManifest(root?: string): { manifest: InstructionManifest; hash: string } {
  const templates = findTemplatesDir();
  const compactProtocol = fs.readFileSync(path.join(templates, "OPENWOLF.md"));
  const contract = readText(path.join(templates, "global-claude-wolfpack.md"));
  const knownRule = readText(path.join(templates, "claude-rules-openwolf.md"));
  const globalPath = path.join(os.homedir(), ".claude", "CLAUDE.md");
  const globalBytes = fileBytes(globalPath) ?? Buffer.from("");
  const globalAfter = mergeGlobalContract(globalBytes.toString("utf8"), contract);
  let entries = classifyFleetProjects(readRegistry().projects, SOURCE_ROOT).map(entry => {
    const pkg = readJSON<{ name?: string }>(path.join(entry.project.root, "package.json"), {});
    const isSource = pkg.name === "customopenwolf" && fs.existsSync(path.join(entry.project.root, "src", "cli", "update.ts"));
    return isSource ? { ...entry, eligible: false, reason: "source-checkout" as const } : entry;
  });
  if (root) {
    const exact = path.resolve(root);
    entries = entries.filter(entry => path.resolve(entry.project.root) === exact);
    if (entries.length !== 1) throw new Error(`No exact registered root: ${root}`);
  }
  const manifest: InstructionManifest = {
    version: 1,
    sourceRoot: SOURCE_ROOT,
    global: { path: globalPath, before: sha(globalBytes), action: sha(globalBytes) === sha(globalAfter) ? "none" : "merge", after: sha(globalAfter) },
    projects: entries.sort((a, b) => a.realRoot.localeCompare(b.realRoot)).map(entry => projectPlan(entry, compactProtocol, knownRule)),
  };
  return { manifest, hash: sha(stable(manifest))! };
}

function assertHash(file: string, expected: string | null): void {
  const actual = sha(fileBytes(file));
  if (actual !== expected) throw new Error(`Preimage changed: ${file}`);
}
function backupSurface(file: string, dir: string, key: string): void {
  const bytes = fileBytes(file);
  writeJSON(path.join(dir, `${key}.state.json`), { path: file, present: bytes !== undefined, sha256: sha(bytes) });
  if (bytes !== undefined) { ensureDir(dir); fs.writeFileSync(path.join(dir, `${key}.bytes`), bytes); }
}

function applySurface(plan: SurfacePlan, output?: string | Buffer): void {
  assertHash(plan.path, plan.before);
  if (plan.action === "delete") { if (fs.existsSync(plan.path)) fs.unlinkSync(plan.path); return; }
  if ((plan.action === "remove-bootstrap" || plan.action === "replace" || plan.action === "merge") && output !== undefined) {
    ensureDir(path.dirname(plan.path)); fs.writeFileSync(plan.path, output);
  }
}

export function applyInstructionManifest(expectedHash: string, root?: string): string {
  const { manifest, hash } = buildInstructionManifest(root);
  if (hash !== expectedHash) throw new Error(`Manifest hash mismatch: expected ${expectedHash}, current ${hash}`);
  if (manifest.projects.some(project => project.eligible && project.claudeMd?.action === "manual-review")) throw new Error("Ambiguous project CLAUDE.md requires manual review");
  assertHash(manifest.global.path, manifest.global.before);
  for (const project of manifest.projects.filter(project => project.eligible)) {
    for (const surface of [project.claudeMd, project.rule, project.protocol]) if (surface) assertHash(surface.path, surface.before);
  }
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const migrationRoot = path.join(os.homedir(), ".openwolf", "instruction-migrations", id);
  ensureDir(migrationRoot);
  writeJSON(path.join(migrationRoot, "manifest.json"), { hash, manifest });
  const templates = findTemplatesDir();
  const compact = fs.readFileSync(path.join(templates, "OPENWOLF.md"));
  const contract = readText(path.join(templates, "global-claude-wolfpack.md"));
  backupSurface(manifest.global.path, migrationRoot, "global-CLAUDE");
  const currentGlobal = fileBytes(manifest.global.path)?.toString("utf8") ?? "";
  applySurface(manifest.global, mergeGlobalContract(currentGlobal, contract));
  for (const project of manifest.projects.filter(project => project.eligible)) {
    const dir = path.join(project.root, ".wolf", "backups", `instructions-${id}`);
    ensureDir(dir);
    writeJSON(path.join(dir, "manifest.json"), { migrationId: id, manifestHash: hash, project });
    backupSurface(project.claudeMd!.path, dir, "root-CLAUDE");
    backupSurface(project.rule!.path, dir, "openwolf-rule");
    backupSurface(project.protocol!.path, dir, "OPENWOLF");
    backupSurface(path.join(project.root, ".claude", "settings.json"), dir, "settings");
    const oldClaude = fileBytes(project.claudeMd!.path)?.toString("utf8");
    const planned = planClaudeMd(oldClaude);
    applySurface(project.claudeMd!, planned.output);
    applySurface(project.rule!);
    applySurface(project.protocol!, compact);
  }
  writeJSON(path.join(migrationRoot, "receipt.json"), { id, manifestHash: hash, appliedAt: new Date().toISOString() });
  return id;
}

function restoreSurface(dir: string, key: string): void {
  const state = readJSON<any>(path.join(dir, `${key}.state.json`), null);
  if (!state) return;
  if (!state.present) { if (fs.existsSync(state.path)) fs.unlinkSync(state.path); return; }
  safeCopyFile(path.join(dir, `${key}.bytes`), state.path);
}

export function rollbackInstructionMigration(id: string): void {
  const migrationRoot = path.join(os.homedir(), ".openwolf", "instruction-migrations", id);
  const saved = readJSON<any>(path.join(migrationRoot, "manifest.json"), null);
  if (!saved?.manifest) throw new Error(`Migration not found: ${id}`);
  const changed = (surface?: SurfacePlan) => surface && !["none", "preserve", "manual-review"].includes(surface.action);
  if (changed(saved.manifest.global)) assertHash(saved.manifest.global.path, saved.manifest.global.after);
  for (const project of saved.manifest.projects.filter((item: ProjectPlan) => item.eligible)) {
    for (const surface of [project.claudeMd, project.rule, project.protocol]) if (changed(surface)) assertHash(surface!.path, surface!.after);
  }
  for (const project of saved.manifest.projects.filter((item: ProjectPlan) => item.eligible)) {
    const dir = path.join(project.root, ".wolf", "backups", `instructions-${id}`);
    restoreSurface(dir, "root-CLAUDE"); restoreSurface(dir, "openwolf-rule"); restoreSurface(dir, "OPENWOLF");
  }
  restoreSurface(migrationRoot, "global-CLAUDE");
}

export async function consolidateInstructionsCommand(options: { root?: string; fleet?: boolean; apply?: boolean; manifestHash?: string; json?: boolean; rollback?: string }): Promise<void> {
  if (options.rollback) { rollbackInstructionMigration(options.rollback); console.log(`Rolled back instruction migration ${options.rollback}`); return; }
  if (Boolean(options.root) === Boolean(options.fleet)) throw new Error("Choose exactly one of --root or --fleet");
  const { manifest, hash } = buildInstructionManifest(options.root);
  if (options.json) console.log(JSON.stringify({ hash, manifest }, null, 2));
  else {
    const eligible = manifest.projects.filter(project => project.eligible);
    const excluded = manifest.projects.filter(project => !project.eligible);
    console.log(`Instruction consolidation manifest: ${hash}`);
    console.log(`Eligible: ${eligible.length}; excluded: ${excluded.length}`);
    for (const project of excluded) console.log(`  excluded ${project.root}: ${project.reason}`);
    for (const project of eligible) console.log(`  ${project.root}: CLAUDE.md ${project.claudeMd?.action}, rule ${project.rule?.action}, protocol ${project.protocol?.action}`);
  }
  if (!options.apply) { console.log("Dry run only. Apply with --apply --manifest-hash <hash>."); return; }
  if (!options.manifestHash) throw new Error("--apply requires --manifest-hash");
  const id = applyInstructionManifest(options.manifestHash, options.root);
  console.log(`Applied instruction migration ${id}`);
}
