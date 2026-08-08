import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEDGER = new URL("../dist/src/ledger/ledger-integrity.js", import.meta.url);
const CLI = new URL("../dist/src/cli/ledger-cmd.js", import.meta.url);

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ledger-test-"));
  fs.mkdirSync(path.join(root, ".wolf"));
  return root;
}
function write(root, name, key, records) {
  fs.writeFileSync(path.join(root, ".wolf", name), JSON.stringify({ version: 1, [key]: records }, null, 2) + "\n");
}
function hash(record) { return crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex"); }
async function fresh() { return import(`${LEDGER.href}?t=${Date.now()}-${Math.random()}`); }

test("deterministic repair preserves first collision, order, and non-ID payloads", async () => {
  const root = project();
  const bugs = [
    { id: "bug-002", message: "first" },
    { id: "bug-002", message: "later" },
    { id: "bug-010", message: "tail" },
    { id: "bug-002", message: "last" },
  ];
  write(root, "buglog.json", "bugs", bugs);
  const { auditLedger, planLedgerRepair, repairLedger } = await fresh();
  const audit = auditLedger(root, "bug");
  assert.equal(audit.classification, "repairable");
  assert.deepEqual(audit.duplicateIds[0].indices, [0, 1, 3]);
  const plan = planLedgerRepair(root, "bug");
  assert.deepEqual(plan.mappings.map((m) => [m.index, m.from, m.to]), [[1, "bug-002", "bug-011"], [3, "bug-002", "bug-012"]]);
  const result = repairLedger(root, "bug", true);
  assert.equal(result.verified, true);
  const after = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "buglog.json"))).bugs;
  assert.deepEqual(after.map((bug) => bug.id), ["bug-002", "bug-011", "bug-010", "bug-012"]);
  assert.deepEqual(after.map(({ id, ...payload }) => hash(payload)), bugs.map(({ id, ...payload }) => hash(payload)));
  assert.ok(fs.existsSync(result.backupPath));
  assert.ok(fs.existsSync(result.receiptPath));
});

test("dry-run and clean rerun are byte-preserving and idempotent", async () => {
  const root = project();
  write(root, "reviewlog.json", "reviews", [{ id: "review-0008", x: 1 }, { id: "review-0008", x: 2 }]);
  const file = path.join(root, ".wolf", "reviewlog.json");
  const before = fs.readFileSync(file, "utf8");
  const { repairLedger } = await fresh();
  const dryRun = repairLedger(root, "review", false);
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.mappings.length, 1);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const applied = repairLedger(root, "review", true);
  assert.equal(applied.verified, true);
  const after = fs.readFileSync(file, "utf8");
  const rerun = repairLedger(root, "review", true);
  assert.equal(rerun.classification, "clean");
  assert.equal(rerun.applied, false);
  assert.equal(fs.readFileSync(file, "utf8"), after);
});

test("malformed ledgers fail closed and ambiguity inventory never rewrites references", async () => {
  const root = project();
  const file = path.join(root, ".wolf", "buglog.json");
  fs.writeFileSync(file, "{ bad");
  const { repairLedger } = await fresh();
  assert.equal(repairLedger(root, "bug", true).classification, "malformed");
  assert.equal(fs.readFileSync(file, "utf8"), "{ bad");
  write(root, "buglog.json", "bugs", [{ id: "bug-001", x: 1 }, { id: "bug-001", x: 2 }]);
  fs.writeFileSync(path.join(root, ".wolf", "memory.md"), "see bug-001 twice: bug-001\n");
  const audit = (await fresh()).auditLedger(root, "bug");
  assert.deepEqual(audit.ambiguousReferences, [{ file: ".wolf/memory.md", id: "bug-001", count: 2 }], "primary record IDs are not historical references");
  const result = repairLedger(root, "bug", true);
  assert.equal(result.verified, true);
  assert.equal(fs.readFileSync(path.join(root, ".wolf", "memory.md"), "utf8"), "see bug-001 twice: bug-001\n");
});

test("fleet dry-run aggregates independently without mutation", async () => {
  const rootA = project(); const rootB = project();
  write(rootA, "buglog.json", "bugs", [{ id: "bug-001" }, { id: "bug-001" }]);
  write(rootA, "reviewlog.json", "reviews", []);
  write(rootB, "buglog.json", "bugs", []); write(rootB, "reviewlog.json", "reviews", []);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ledger-home-"));
  fs.mkdirSync(path.join(home, ".openwolf"));
  fs.writeFileSync(path.join(home, ".openwolf", "registry.json"), JSON.stringify({ version: 1, projects: [
    { root: rootA, name: "a" }, { root: rootB, name: "b" },
  ] }));
  const previous = process.env.HOME; process.env.HOME = home;
  const output = []; const oldLog = console.log; console.log = (value) => output.push(String(value));
  try {
    const { ledgerRepair } = await import(`${CLI.href}?t=${Date.now()}`);
    ledgerRepair({ fleet: true, json: true });
  } finally { console.log = oldLog; process.env.HOME = previous; }
  const report = JSON.parse(output.join("\n"));
  assert.equal(report.counts.projects, 2);
  assert.equal(report.counts.ids_rekeyed, 1);
  assert.equal(report.counts.repaired, 0);
  assert.equal(report.counts.verified, 0, "dry-run never claims mutation verification");
  assert.equal(report.counts.records_preserved, 0, "dry-run never claims preserved written records");
  assert.deepEqual(report.reports[0].ledgers[0].mappings.map((mapping) => mapping.to), ["bug-002"]);
  assert.deepEqual(report.reports[0].ledgers[0].ambiguousReferences, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootA, ".wolf", "buglog.json"))).bugs[1].id, "bug-001");
});
