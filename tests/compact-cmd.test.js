import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { buildCompactManifest, applyCompactManifest, rollbackCompactTransaction, compactCommand } from "../dist/src/cli/compact-cmd.js";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-compact-"));
  const root = path.join(home, "project");
  const wolf = path.join(root, ".wolf");
  fs.mkdirSync(wolf, { recursive: true });
  fs.mkdirSync(path.join(home, ".openwolf"), { recursive: true });
  fs.writeFileSync(path.join(home, ".openwolf", "registry.json"), JSON.stringify({ version: 1, projects: [{ root, name: "fixture", registered_at: "2020-01-01", last_updated: "2020-01-01", version: "1" }] }));
  fs.writeFileSync(path.join(wolf, "config.json"), JSON.stringify({ openwolf: { size_discipline: { memory: { retention_days: 30 }, buglog: { retention_days: 30 }, reviewlog: { retention_days: 30 }, token_ledger: { max_inline_sessions: 2 } } } }));
  fs.writeFileSync(path.join(wolf, "memory.md"), "# Memory\n\n## Session: 2020-01-01 01:00\nold detail\n## Session: 2099-01-01 01:00\nnew detail\n");
  fs.writeFileSync(path.join(wolf, "buglog.json"), JSON.stringify({ version: 1, bugs: [{ id: "old", last_seen: "2020-01-01", detail: "keep exactly" }, { id: "new", last_seen: "2099-01-01" }, { id: "undated" }] }, null, 2));
  fs.writeFileSync(path.join(wolf, "reviewlog.json"), JSON.stringify({ reviews: [{ id: "pending", status: "pending", ended: "2020-01-01" }, { id: "done", status: "completed", ended: "2020-01-01" }] }, null, 2));
  fs.writeFileSync(path.join(wolf, "token-ledger.json"), JSON.stringify({ sessions: [{ id: "1" }, { id: "2" }, { id: "3" }] }, null, 2));
  fs.writeFileSync(path.join(wolf, "nudge-state.json"), JSON.stringify({ version: 4, dispositions: { keep: { state: "dismissed" } }, leases: { expired: { owner: "1:x", expires_at: "2020-01-01T00:00:00Z" }, active: { owner: "2:y", expires_at: "2099-01-01T00:00:00Z" } }, emissions: { keep: { state: "emitted" } }, lineages: { keep: { rounds: 2 } } }, null, 2));
  fs.mkdirSync(path.join(wolf, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(wolf, "hooks", "_session.json"), JSON.stringify({ session_id: "ambiguous" }));
  fs.writeFileSync(path.join(wolf, "anatomy.md"), "# Anatomy\n");
  for (const dir of ["qa", "designqc-captures", "backups"]) fs.mkdirSync(path.join(wolf, dir), { recursive: true });
  return { home, root, wolf };
}

async function withHome(fn) {
  const old = process.env.HOME;
  const f = fixture();
  process.env.HOME = f.home;
  try { return await fn(f); } finally { process.env.HOME = old; fs.rmSync(f.home, { recursive: true, force: true }); }
}

test("fleet dry-run manifest is stable, conservative, and read-only", async () => withHome(({ wolf }) => {
  const before = fs.readFileSync(path.join(wolf, "memory.md"));
  const first = buildCompactManifest({ now: Date.parse("2026-09-07T12:00:00Z") });
  const second = buildCompactManifest({ now: Date.parse("2026-09-07T12:00:00Z") });
  assert.equal(first.hash, second.hash);
  assert.equal(first.manifest.target.mode, "fleet");
  assert.equal(first.manifest.projects[0].actions.length, 5);
  assert.deepEqual(fs.readFileSync(path.join(wolf, "memory.md")), before);
  const review = first.manifest.projects[0].actions.find(action => action.kind === "reviewlog");
  assert.equal(review.records, 1);
}));

test("uncertain debris surfaces are explicitly protected rather than deleted", async () => withHome(({ root }) => {
  const planned = buildCompactManifest({ root, now: Date.parse("2026-09-07T12:00:00Z") });
  assert.deepEqual(planned.manifest.projects[0].protections.map(item => item.surface).sort(), ["anatomy", "backups", "designqc", "qa", "session-state"]);
}));

test("JSON dry-run emits exactly one parseable JSON document", async () => withHome(async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = value => lines.push(String(value));
  try {
    await compactCommand({ json: true, now: Date.parse("2026-09-07T12:00:00Z") });
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(lines.join("\n"));
  assert.equal(parsed.manifest.target.mode, "fleet");
  assert.match(parsed.hash, /^[a-f0-9]{64}$/);
}));

test("byte drift invalidates a reviewed manifest", async () => withHome(async ({ wolf }) => {
  const planned = buildCompactManifest({ now: Date.parse("2026-09-07T12:00:00Z") });
  fs.appendFileSync(path.join(wolf, "memory.md"), "drift\n");
  await assert.rejects(() => applyCompactManifest(planned.hash, { now: Date.parse("2026-09-07T12:00:00Z") }), /Manifest hash mismatch/);
  assert.equal(fs.existsSync(path.join(wolf, "archive")), false);
}));

test("apply archives exact history, is idempotent, and rollback restores bytes", async () => withHome(async ({ root, wolf }) => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const originals = new Map(["memory.md", "buglog.json", "reviewlog.json", "token-ledger.json", "nudge-state.json"].map(file => [file, fs.readFileSync(path.join(wolf, file))]));
  const planned = buildCompactManifest({ root, now });
  const id = await applyCompactManifest(planned.hash, { root, now });
  const receipt = JSON.parse(fs.readFileSync(path.join(wolf, "compact", "receipts", `${id}.json`), "utf8"));
  const memoryBackup = fs.readFileSync(path.join(receipt.backupDir, "memory.live.bytes"));
  const memoryState = JSON.parse(fs.readFileSync(path.join(receipt.backupDir, "memory.live.state.json"), "utf8"));
  assert.equal(crypto.createHash("sha256").update(memoryBackup).digest("hex"), memoryState.sha256);
  assert.match(fs.readFileSync(path.join(wolf, "archive", "memory-2026-09.md"), "utf8"), /old detail/);
  assert.doesNotMatch(fs.readFileSync(path.join(wolf, "memory.md"), "utf8"), /old detail/);
  const liveReviews = JSON.parse(fs.readFileSync(path.join(wolf, "reviewlog.json"), "utf8")).reviews;
  assert.deepEqual(liveReviews.map(review => review.id), ["pending"]);
  const nudge = JSON.parse(fs.readFileSync(path.join(wolf, "nudge-state.json"), "utf8"));
  assert.deepEqual(Object.keys(nudge.leases), ["active"]);
  assert.equal(nudge.dispositions.keep.state, "dismissed");
  assert.equal(nudge.emissions.keep.state, "emitted");
  assert.equal(nudge.lineages.keep.rounds, 2);
  assert.equal(buildCompactManifest({ root, now }).manifest.totals.actions, 0);
  rollbackCompactTransaction(id);
  for (const [file, bytes] of originals) assert.deepEqual(fs.readFileSync(path.join(wolf, file)), bytes);
}));

test("rollback refuses changed shared archives and preserves later additions", async () => withHome(async ({ root, wolf }) => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const planned = buildCompactManifest({ root, now });
  const id = await applyCompactManifest(planned.hash, { root, now });
  const archive = path.join(wolf, "archive", "memory-2026-09.md");
  fs.appendFileSync(archive, "\n## Session: 2020-02-02 02:00\nlater transaction\n");
  await assert.rejects(async () => rollbackCompactTransaction(id), /Preimage changed/);
  assert.match(fs.readFileSync(archive, "utf8"), /later transaction/);
  assert.doesNotMatch(fs.readFileSync(path.join(wolf, "memory.md"), "utf8"), /old detail/);
}));

test("archive-phase failure is receipted and rollback restores every changed path", async () => withHome(async ({ root, wolf }) => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const originalMemory = fs.readFileSync(path.join(wolf, "memory.md"));
  const planned = buildCompactManifest({ root, now });
  const id = await applyCompactManifest(planned.hash, { root, now, faultInjection: { afterArchiveKind: "memory" } });
  const receipt = JSON.parse(fs.readFileSync(path.join(wolf, "compact", "receipts", `${id}.json`), "utf8"));
  assert.equal(receipt.status, "incomplete");
  assert.match(receipt.error, /Injected failure after memory archive write/);
  assert.equal(receipt.actions.length, 1);
  assert.equal(receipt.actions[0].archiveApplied, true);
  assert.equal(receipt.actions[0].liveApplied, false);
  assert.equal(fs.existsSync(path.join(wolf, "archive", "memory-2026-09.md")), true);
  assert.deepEqual(fs.readFileSync(path.join(wolf, "memory.md")), originalMemory);
  rollbackCompactTransaction(id);
  assert.deepEqual(fs.readFileSync(path.join(wolf, "memory.md")), originalMemory);
  assert.equal(fs.existsSync(path.join(wolf, "archive", "memory-2026-09.md")), false);
}));

test("unreadable compact surfaces block the whole project instead of becoming absent", async () => withHome(({ root, wolf }) => {
  fs.unlinkSync(path.join(wolf, "memory.md"));
  fs.mkdirSync(path.join(wolf, "memory.md"));
  const planned = buildCompactManifest({ root, now: Date.parse("2026-09-07T12:00:00Z") });
  assert.equal(planned.manifest.projects[0].blocked.length, 1);
  assert.equal(planned.manifest.projects[0].actions.length, 0);
}));

test("AI failure is nonfatal and cannot alter deterministic eligibility", async () => withHome(async ({ root, wolf }) => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const planned = buildCompactManifest({ root, now, ai: true });
  const summarizer = { summarize: async () => { throw new Error("offline"); } };
  const id = await applyCompactManifest(planned.hash, { root, now, ai: true, summarizer });
  const receipt = JSON.parse(fs.readFileSync(path.join(wolf, "compact", "receipts", `${id}.json`), "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.ai.succeeded, false);
  assert.match(receipt.ai.error, /offline/);
}));

test("rollback restores a replaced derived AI summary", async () => withHome(async ({ root, wolf }) => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const summaryPath = path.join(wolf, "summaries", "compact-summary.json");
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, "original summary\n");
  const planned = buildCompactManifest({ root, now, ai: true });
  const summarizer = { summarize: async request => ({ text: "derived only", model: request.model }) };
  const id = await applyCompactManifest(planned.hash, { root, now, ai: true, summarizer });
  assert.match(fs.readFileSync(summaryPath, "utf8"), /derived only/);
  rollbackCompactTransaction(id);
  assert.equal(fs.readFileSync(summaryPath, "utf8"), "original summary\n");
}));
