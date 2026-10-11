import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planClaudeMd, mergeGlobalContract, isOwnedOpenWolfRule } from "../dist/src/cli/instruction-consolidation.js";
import { classifyFleetProjects } from "../dist/src/cli/registry.js";

const current = `# Wolfpack\n\n@.wolf/OPENWOLF.md\n\nThis project uses Wolfpack, a heavily customized Claude Code workflow harness built on the OpenWolf runtime namespace. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`;
const legacy = `# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`;

test("classifies and removes only recognized WolfPack bootstraps", () => {
  assert.equal(planClaudeMd(undefined).classification, "absent");
  assert.equal(planClaudeMd(current + "\n").action, "delete");
  assert.equal(planClaudeMd(legacy.replaceAll("\n", "\r\n")).action, "delete");
  const mixed = planClaudeMd(current + "\n\n# Project\n\nKeep this.\n");
  assert.equal(mixed.action, "remove-bootstrap");
  assert.equal(mixed.output, "# Project\n\nKeep this.\n");
  const proseBootstrap = "This project uses the same Wolfpack/OpenWolf harness as its sibling (`/mnt/j/projectshome/projects/adventists/`). Read and follow `.wolf/OPENWOLF.md` every session. Check `.wolf/cerebrum.md` before generating prose. Check `.wolf/anatomy.md` before reading files.";
  const proseProject = planClaudeMd(`# Simple Christianity — project instructions\n\n${proseBootstrap}\n\n## What this project is\n\nKeep this.\n`);
  assert.equal(proseProject.action, "remove-bootstrap");
  assert.equal(proseProject.output, "# Simple Christianity — project instructions\n\n## What this project is\n\nKeep this.\n");
  assert.equal(planClaudeMd("# Project\n\nOpenWolf is mentioned historically.\n").action, "manual-review");
  assert.equal(planClaudeMd("# Project\n\nBuild with npm.\n").action, "preserve");
  assert.equal(planClaudeMd(mixed.output).action, "preserve");
});

test("global contract merge is bounded and idempotent", () => {
  const contract = "<!-- wolfpack:global:start -->\n## WolfPack\nCompact.\n<!-- wolfpack:global:end -->";
  const first = mergeGlobalContract("# Global\n", contract);
  assert.match(first, /# Global/);
  assert.equal(mergeGlobalContract(first, contract), first);
  const changed = mergeGlobalContract(first, contract.replace("Compact.", "Updated."));
  assert.match(changed, /Updated/);
  assert.doesNotMatch(changed, /Compact\./);
  assert.throws(() => mergeGlobalContract("<!-- wolfpack:global:start -->", contract));
  assert.throws(() => mergeGlobalContract("", "x".repeat(1501)));
});

test("owned rule matching is exact apart from line endings", () => {
  assert.equal(isOwnedOpenWolfRule("a\r\n", "a\n"), true);
  assert.equal(isOwnedOpenWolfRule("a\nmodified", "a\n"), false);
});

test("fleet eligibility excludes archive, worktree, source, missing, and aliases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-fleet-"));
  const active = path.join(dir, "active");
  const archive = path.join(dir, "Archived", "old");
  const worktree = path.join(dir, ".claude", "worktrees", "w");
  const source = path.join(dir, "source");
  for (const root of [active, archive, worktree, source]) fs.mkdirSync(path.join(root, ".wolf"), { recursive: true });
  const projects = [active, archive, worktree, source, path.join(dir, "missing"), active].map((root, i) => ({ root, name: `p${i}`, registered_at: "", last_updated: "", version: "" }));
  const result = classifyFleetProjects(projects, source);
  assert.equal(result[0].eligible, true);
  assert.equal(result[1].reason, "archive");
  assert.equal(result[2].reason, "worktree");
  assert.equal(result[3].reason, "source-checkout");
  assert.equal(result[4].reason, "missing");
  assert.equal(result[5].reason, "duplicate-real-root");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("canonical instruction templates meet size and equality contracts", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const canonical = fs.readFileSync(path.join(root, "src", "templates", "OPENWOLF.md"));
  const portable = fs.readFileSync(path.join(root, "templates", "wolf", "OPENWOLF.md"));
  const global = fs.readFileSync(path.join(root, "src", "templates", "global-claude-wolfpack.md"), "utf8");
  assert.ok(canonical.length <= 2048, `OPENWOLF.md is ${canonical.length} bytes`);
  assert.deepEqual(portable, canonical);
  assert.ok(Buffer.byteLength(global.trim()) <= 1500);
  assert.equal((global.match(/wolfpack:global:start/g) ?? []).length, 1);
  assert.equal((global.match(/wolfpack:global:end/g) ?? []).length, 1);
  assert.doesNotMatch(canonical.toString("utf8"), /appl(?:y|ies) every turn/i);
});
