import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logBug } from "../dist/src/buglog/bug-tracker.js";

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
    assert.equal(new Set(log.bugs.map((bug) => bug.id)).size, 3);
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
