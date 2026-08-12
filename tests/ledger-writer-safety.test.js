import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logBug, readBugLog } from "../dist/src/buglog/bug-tracker.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-ledger-writer-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir);
  fs.writeFileSync(path.join(wolfDir, "buglog.json"), JSON.stringify({ version: 1, bugs: entries }, null, 2));
  return { root, wolfDir };
}

function entry(id, message) {
  return {
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    error_message: message,
    file: "src/a.ts",
    root_cause: "cause",
    fix: "fix",
    tags: ["test"],
    related_bugs: [],
    occurrences: 1,
    last_seen: "2026-01-01T00:00:00.000Z",
    commit: null,
    reduction: null,
  };
}

test("logBug allocates above max suffix rather than array length", () => {
  const { root, wolfDir } = fixture([entry("bug-002", "first"), entry("bug-099", "second")]);
  try {
    logBug(wolfDir, {
      error_message: "completely unrelated third defect",
      file: "src/b.ts",
      root_cause: "other cause",
      fix: "other fix",
      tags: ["test"],
    });
    const log = JSON.parse(fs.readFileSync(path.join(wolfDir, "buglog.json"), "utf8"));
    assert.equal(log.bugs.at(-1).id, "bug-100");
    assert.equal(log.bugs.at(-1).status, "open");
    assert.equal(new Set(log.bugs.map((bug) => bug.id)).size, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("short generic messages do not absorb distinct longer defects", () => {
  const { root, wolfDir } = fixture([entry("bug-001", "timeout")]);
  try {
    logBug(wolfDir, {
      error_message: "connection timeout while saving order to the orders database",
      file: "src/orders.ts",
      root_cause: "database connection expired",
      fix: "retry transaction",
      tags: ["database"],
    });
    const log = JSON.parse(fs.readFileSync(path.join(wolfDir, "buglog.json"), "utf8"));
    assert.equal(log.bugs.length, 2);
    assert.equal(log.bugs[0].occurrences, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy records are readable with an in-memory open status default", () => {
  const { root, wolfDir } = fixture([entry("bug-001", "legacy")]);
  try {
    const log = readBugLog(wolfDir);
    assert.equal(log.bugs[0].status, "open");
    const persisted = JSON.parse(fs.readFileSync(path.join(wolfDir, "buglog.json"), "utf8"));
    assert.equal(Object.hasOwn(persisted.bugs[0], "status"), false, "read compatibility does not bulk-rewrite history");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("similarity update mutates the scored duplicate occurrence, not first ID match", () => {
  const first = entry("bug-007", "unrelated alpha failure");
  const second = entry("bug-007", "database connection timeout while saving order");
  const { root, wolfDir } = fixture([first, second]);
  try {
    logBug(wolfDir, {
      error_message: "database connection timeout while saving order",
      file: "src/db.ts",
      root_cause: "timeout",
      fix: "retry",
      tags: ["test"],
    });
    const log = JSON.parse(fs.readFileSync(path.join(wolfDir, "buglog.json"), "utf8"));
    assert.equal(log.bugs[0].occurrences, 1);
    assert.equal(log.bugs[1].occurrences, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent canonical writers preserve every row with unique contiguous IDs", async () => {
  const { root, wolfDir } = fixture([entry("bug-099", "baseline")]);
  const driver = path.join(root, "writer.mjs");
  const modulePath = path.join(repoRoot, "dist/src/buglog/bug-tracker.js").replace(/\\/g, "/");
  fs.writeFileSync(driver, `import { logBug } from ${JSON.stringify(modulePath)};\nlogBug(process.argv[2], { error_message: process.argv[3], file: process.argv[4], root_cause: 'concurrent cause', fix: 'concurrent fix', tags: ['concurrency'] });\n`);
  try {
    const count = 8;
    const messages = [
      "alphabravocharlie", "deltaechofoxtrot", "golfhotelindia", "julietkilolima",
      "mikenovemberoscar", "papaquebecromeo", "sierratangouniform", "victorwhiskeyzulu",
    ];
    const children = Array.from({ length: count }, (_, i) => new Promise((resolve) => {
      const child = spawn(process.execPath, [driver, wolfDir, messages[i], `src/concurrent-${i}.ts`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (status) => resolve({ status, stderr }));
    }));
    const results = await Promise.all(children);
    for (const result of results) assert.equal(result.status, 0, result.stderr);

    const log = JSON.parse(fs.readFileSync(path.join(wolfDir, "buglog.json"), "utf8"));
    assert.equal(log.bugs.length, count + 1, "no writer row is lost");
    const newIds = log.bugs.slice(1).map((bug) => Number(bug.id.slice(4))).sort((a, b) => a - b);
    assert.deepEqual(newIds, Array.from({ length: count }, (_, i) => 100 + i));
    assert.equal(new Set(log.bugs.map((bug) => bug.id)).size, count + 1);
    assert.ok(log.bugs.slice(1).every((bug) => bug.status === "open"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
