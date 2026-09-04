import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cleanupFixture, createTmpFixture } from "./lib/fixture-cleanup.js";

const LEDGER = new URL("../dist/src/ledger/ledger-integrity.js", import.meta.url);
const CLI = new URL("../dist/src/cli/ledger-cmd.js", import.meta.url);

function project() {
  const root = createTmpFixture("ow-ledger-test-");
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

test("reference inventory excludes only direct primary IDs", async () => {
  const root = project();
  write(root, "buglog.json", "bugs", [
    { id: "bug-001", nested: { id: "bug-001" } },
    { id: "bug-001", related: { id: "bug-001" } },
  ]);
  const file = path.join(root, ".wolf", "buglog.json");
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  document.metadata = { id: "bug-001" };
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + "\n");
  const { auditLedger, planLedgerNormalize } = await fresh();
  const audit = auditLedger(root, "bug");
  assert.deepEqual(audit.ambiguousReferences, [{ file: ".wolf/buglog.json", id: "bug-001", count: 3 }], "only bugs[*].id is excluded; nested and root metadata id values remain references");

  fs.writeFileSync(file, JSON.stringify([{ id: "bug-001" }, { id: "bug-001" }], null, 2) + "\n");
  assert.deepEqual(planLedgerNormalize(root, "bug").referenceInventory, [], "bare-array records' own IDs are also primary IDs, not external references");
});

test("normalization accepts bare arrays, preserves root metadata, and records invalid provenance", async () => {
  const root = project();
  const file = path.join(root, ".wolf", "buglog.json");
  const bare = [{ id: "bug-004", x: "first" }, { id: "wrong", x: "invalid" }, { x: "missing" }, { id: "bug-004", x: "duplicate" }];
  fs.writeFileSync(file, JSON.stringify(bare, null, 2) + "\n");
  const { planLedgerNormalize, normalizeLedger, recoverLedgerNormalize } = await fresh();
  const plan = planLedgerNormalize(root, "bug");
  assert.equal(plan.inputShape, "array");
  assert.equal(plan.rootTransition.to, "object");
  assert.deepEqual(plan.invalidIndices, [1, 2]);
  assert.equal(plan.maxSuffix, 4);
  assert.deepEqual(plan.mappings.map((m) => [m.index, m.from, m.to, m.reason]), [
    [1, { present: true, value: "wrong" }, "bug-005", "invalid"],
    [2, { present: false }, "bug-006", "invalid"],
    [3, { present: true, value: "bug-004" }, "bug-007", "duplicate"],
  ]);
  assert.deepEqual(plan.mappings[2].collisionBlock, { id: "bug-004", firstIndex: 0, firstDigest: hash(bare[0]) });
  const result = normalizeLedger(root, "bug", true);
  assert.equal(result.verified, true);
  const normalized = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(normalized.bugs.map((record) => record.id), ["bug-004", "bug-005", "bug-006", "bug-007"]);
  assert.equal(normalized.bugs[1].__openwolf_normalization_provenance.original_id.value, "wrong");
  assert.equal(normalized.bugs[2].__openwolf_normalization_provenance.original_id.present, false);
  assert.equal(normalized.bugs[3].__openwolf_normalization_provenance, undefined, "valid duplicate gets no invalid-ID provenance");
  const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
  assert.equal(receipt.version, 3);
  assert.equal(receipt.backup.sha256, receipt.source_root.sha256);
  assert.equal(recoverLedgerNormalize(root, "bug", result.receiptPath, false, false).applied, false);
  assert.equal(recoverLedgerNormalize(root, "bug", result.receiptPath, true, true).verified, true);
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(bare, null, 2) + "\n", "recovery restores exact backup bytes");
});

test("normalization blocks reserved provenance collisions without mutation", async () => {
  const root = project();
  const file = path.join(root, ".wolf", "buglog.json");
  const raw = JSON.stringify([{ id: "semantic", __openwolf_normalization_provenance: { user: true } }], null, 2) + "\n";
  fs.writeFileSync(file, raw);
  const { planLedgerNormalize, normalizeLedger } = await fresh();
  const plan = planLedgerNormalize(root, "bug");
  assert.match(plan.error, /reserved provenance field/);
  const result = normalizeLedger(root, "bug", true);
  assert.equal(result.applied, false);
  assert.equal(fs.readFileSync(file, "utf8"), raw);
});

test("normalization preserves canonical object root metadata and hash guard rejects changed live bytes", async () => {
  const root = project();
  const file = path.join(root, ".wolf", "reviewlog.json");
  fs.writeFileSync(file, JSON.stringify({ version: 9, preserved: { x: 1 }, reviews: [{ id: "review-1", p: 1 }, { id: "review-1", p: 2 }] }, null, 2) + "\n");
  const { normalizeLedger, recoverLedgerNormalize } = await fresh();
  const result = normalizeLedger(root, "review", true);
  assert.equal(result.verified, true);
  const normalized = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(normalized.preserved, { x: 1 });
  assert.deepEqual(normalized.reviews.map((r) => r.id), ["review-1", "review-0002"]);
  fs.appendFileSync(file, " ");
  const recovery = recoverLedgerNormalize(root, "review", result.receiptPath, true, true);
  assert.match(recovery.error, /target hash/);
});

test("normalization through a symlinked project root recovers against canonical receipt paths", async () => {
  const root = project();
  const linkedRoot = `${root}-link`;
  fs.symlinkSync(root, linkedRoot);
  const file = path.join(root, ".wolf", "buglog.json");
  const raw = JSON.stringify([{ id: "semantic" }], null, 2) + "\n";
  fs.writeFileSync(file, raw);
  const { normalizeLedger, recoverLedgerNormalize } = await fresh();
  const normalized = normalizeLedger(linkedRoot, "bug", true);
  assert.equal(normalized.verified, true);
  const receipt = JSON.parse(fs.readFileSync(normalized.receiptPath, "utf8"));
  assert.equal(receipt.project_root, fs.realpathSync(root));
  assert.equal(receipt.file, fs.realpathSync(file));
  assert.equal(receipt.backup.path, fs.realpathSync(normalized.backupPath));
  try {
    const recovered = recoverLedgerNormalize(linkedRoot, "bug", normalized.receiptPath, true, true);
    assert.equal(recovered.verified, true);
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  } finally {
    fs.rmSync(linkedRoot, { force: true });
  }
});

test("recovery rejects symlink receipts and backups", async () => {
  const root = project();
  const file = path.join(root, ".wolf", "buglog.json");
  fs.writeFileSync(file, JSON.stringify([{ id: "wrong" }], null, 2) + "\n");
  const { normalizeLedger, recoverLedgerNormalize } = await fresh();
  const result = normalizeLedger(root, "bug", true);
  const link = path.join(root, ".wolf", "backups", "receipt-link.json");
  fs.symlinkSync(result.receiptPath, link);
  const receiptLinkResult = recoverLedgerNormalize(root, "bug", link, true, true);
  assert.match(receiptLinkResult.error, /regular file/);
  const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
  const backupLink = path.join(path.dirname(result.backupPath), "backup-link.json");
  fs.renameSync(result.backupPath, backupLink);
  fs.symlinkSync(backupLink, result.backupPath);
  const backupLinkResult = recoverLedgerNormalize(root, "bug", result.receiptPath, true, true);
  assert.match(backupLinkResult.error, /backup must be a regular file/);
  assert.match(fs.readFileSync(file, "utf8"), /"id": "bug-000"/);
  assert.match(fs.readFileSync(file, "utf8"), /"value": "wrong"/, "failed recoveries leave the normalized ledger untouched");
});

test("fleet dry-run aggregates independently without mutation", async () => {
  const rootA = project(); const rootB = project();
  write(rootA, "buglog.json", "bugs", [{ id: "bug-001" }, { id: "bug-001" }]);
  write(rootA, "reviewlog.json", "reviews", []);
  write(rootB, "buglog.json", "bugs", []); write(rootB, "reviewlog.json", "reviews", []);
  const home = createTmpFixture("ow-ledger-home-");
  fs.mkdirSync(path.join(home, ".openwolf"));
  fs.writeFileSync(path.join(home, ".openwolf", "registry.json"), JSON.stringify({ version: 1, projects: [
    { root: rootA, name: "a" }, { root: rootB, name: "b" },
  ] }));
  const previous = process.env.HOME; process.env.HOME = home;
  const output = []; const oldLog = console.log; console.log = (value) => output.push(String(value));
  try {
    const { ledgerRepair } = await import(`${CLI.href}?t=${Date.now()}`);
    ledgerRepair({ fleet: true, json: true });
  } finally {
    console.log = oldLog;
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    cleanupFixture(home);
  }
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
