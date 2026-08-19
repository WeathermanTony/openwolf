#!/usr/bin/env node
// Verify a template section reached every REGISTERED project.
// Replaces `grep -L <pat> <glob>/**/.wolf/OPENWOLF.md`, which reports success
// when the glob matches zero files (globstar off => literal pattern => exit 2,
// empty stdout, visually identical to full coverage).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const needle = process.argv[2];
if (!needle) {
  console.error("usage: verify-fleet-section.mjs '<section heading>'");
  process.exit(2);
}

const registryPath = path.join(os.homedir(), ".openwolf", "registry.json");
if (!existsSync(registryPath)) {
  console.error(`FAIL: registry not found at ${registryPath}`);
  process.exit(2);
}

const raw = JSON.parse(readFileSync(registryPath, "utf8"));
const entries = Array.isArray(raw) ? raw : (raw.projects ?? Object.values(raw));
const roots = entries
  .map((e) => (typeof e === "string" ? e : e?.root ?? e?.path ?? e?.dir))
  .filter(Boolean);

// Fail closed on schema drift: an extraction that silently yields fewer paths
// than the registry has entries produces a vacuous zero ("0 outside the root"
// really meaning "0 paths extracted"). bug-068.
if (roots.length !== entries.length) {
  console.error(
    `FAIL: extracted ${roots.length} paths from ${entries.length} registry entries — ` +
    `unrecognized entry shape, refusing to report coverage`
  );
  process.exit(2);
}

if (roots.length === 0) {
  console.error("FAIL: registry parsed but yielded 0 project paths");
  process.exit(2);
}

// --only <root> restricts verification to a single registered project. This
// exists for the CANARY phase of a staged rollout, where exactly one project is
// deliberately ahead of the fleet and a fleet-wide FAIL is the expected state,
// not a signal. The filter is applied against the REGISTRY, so an --only target
// that is not registered is a hard error rather than a silent zero-project pass
// -- otherwise a typo'd path would report "checked=0 ... PASS".
const onlyIdx = process.argv.indexOf("--only");
let scope = roots;
if (onlyIdx !== -1) {
  const target = process.argv[onlyIdx + 1];
  if (!target) {
    console.error("FAIL: --only requires a project root");
    process.exit(2);
  }
  const resolved = path.resolve(target);
  scope = roots.filter((r) => path.resolve(r) === resolved);
  if (scope.length === 0) {
    console.error(`FAIL: --only ${resolved} is not a registered project — refusing to report coverage over 0 projects`);
    process.exit(2);
  }
  console.log(`scope: --only ${resolved} (1 of ${roots.length} registered)`);
}

// Content binding (bug-692): a heading-presence check passes when the heading
// survives but the BODY is stale or reverted. Extract the canonical section
// from the template and compare a normalized hash per project.
// Resolve the template from THIS SCRIPT's location, not process.cwd() (bug-693):
// a cwd-relative path silently degraded to heading-presence-only when run from
// anywhere but the repo root — and heading-presence is the check bug-692 killed.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(scriptDir, "..", "src", "templates", "OPENWOLF.md");
const allowUnbound = process.argv.includes("--allow-unbound");
const nextHeadingRe = /\n## /;

function extractSection(body) {
  const i = body.indexOf(needle);
  if (i === -1) return null;
  const rest = body.slice(i + needle.length);
  const m = rest.match(nextHeadingRe);
  return (needle + (m ? rest.slice(0, m.index) : rest)).trim();
}
const norm = (s) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
const hash = (s) => crypto.createHash("sha256").update(norm(s)).digest("hex");

let canonical = null;
if (existsSync(templatePath)) {
  const sec = extractSection(readFileSync(templatePath, "utf8"));
  if (sec) canonical = hash(sec);
}
if (canonical) {
  console.log(`canonical section hash: ${canonical.slice(0, 16)}… (from template)`);
} else if (allowUnbound) {
  console.log("canonical section hash: UNAVAILABLE — heading-presence only (--allow-unbound)");
} else {
  // Fail closed: reporting coverage without a content binding is the vacuous
  // check this script exists to replace.
  console.error(
    `FAIL: no canonical section for "${needle}" in ${templatePath} — ` +
    `refusing heading-only coverage. Pass --allow-unbound to override deliberately.`
  );
  process.exit(2);
}

let checked = 0;
const missing = [];
const unreadable = [];
const drifted = [];

for (const root of scope) {
  const f = path.join(root, ".wolf", "OPENWOLF.md");
  if (!existsSync(f)) { unreadable.push(`${f} (absent)`); continue; }
  let body;
  try { body = readFileSync(f, "utf8"); }
  catch (err) { unreadable.push(`${f} (${err.code})`); continue; }
  checked += 1;
  if (!body.includes(needle)) { missing.push(root); continue; }
  if (canonical) {
    const sec = extractSection(body);
    if (!sec || hash(sec) !== canonical) drifted.push(root);
  }
}

console.log(`registry=${roots.length} scope=${scope.length} checked=${checked} missing=${missing.length} drifted=${drifted.length} unreadable=${unreadable.length}`);
for (const m of missing) console.log(`  MISSING: ${m}`);
for (const d of drifted) console.log(`  DRIFTED (heading present, body differs): ${d}`);
for (const u of unreadable) console.log(`  UNREADABLE: ${u}`);

// Fail closed: zero-examined is a failure, never a silent pass.
const ok = checked === scope.length && missing.length === 0 && drifted.length === 0;
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
