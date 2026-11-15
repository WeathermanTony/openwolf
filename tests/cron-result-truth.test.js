import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "bin", "openwolf.js");

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-cron-result-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir);
  fs.writeFileSync(path.join(wolfDir, "config.json"), JSON.stringify({
    openwolf: {
      dashboard: { port: 59999 },
      daemon: { auth_token: null },
      cron: { enabled: false, heartbeat_interval_minutes: 30 },
    },
  }));
  fs.writeFileSync(path.join(wolfDir, "cron-manifest.json"), JSON.stringify({ version: 1, tasks: [] }));
  fs.writeFileSync(path.join(wolfDir, "cron-state.json"), JSON.stringify({
    last_heartbeat: null,
    engine_status: "stopped",
    execution_log: [],
    dead_letter_queue: [],
    upcoming: [],
  }));
  return root;
}

test("cron run exits nonzero and does not claim success for an unknown task", () => {
  assert.ok(fs.existsSync(cliPath), "build the CLI before running this test");
  const root = makeProject();
  try {
    const run = spawnSync(process.execPath, [cliPath, "cron", "run", "definitely-missing"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000, // ~1.3 s alone; the parallel full suite once pushed it past 10 s
    });
    const output = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 1, run.error ? `spawn failed: ${run.error.message} (signal ${run.signal})` : output);
    assert.match(output, /task ID was not found/i);
    assert.doesNotMatch(output, /executed successfully/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
