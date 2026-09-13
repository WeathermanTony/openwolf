import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const cronModule = pathToFileURL(path.resolve("dist/src/daemon/cron-engine.js")).href;

function runUpdate(wolfDir, index) {
  const script = `import { updateCronState } from ${JSON.stringify(cronModule)}; await updateCronState(${JSON.stringify(wolfDir)}, state => { state.execution_log.push({ task_id: ${JSON.stringify(`task-${index}`)}, status: "success", timestamp: new Date().toISOString(), duration_ms: ${index} }); });`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`update exited ${code}: ${stderr}`)));
  });
}

test("parallel cron-state writers retain every update", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-cron-state-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir);
  const count = 40;
  try {
    await Promise.all(Array.from({ length: count }, (_, index) => runUpdate(wolfDir, index)));
    const state = JSON.parse(fs.readFileSync(path.join(wolfDir, "cron-state.json"), "utf8"));
    assert.equal(state.execution_log.length, count);
    assert.equal(new Set(state.execution_log.map(entry => entry.task_id)).size, count);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cron-state mutation preserves malformed existing bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-cron-malformed-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir);
  const statePath = path.join(wolfDir, "cron-state.json");
  const malformed = "{ malformed cron state }";
  fs.writeFileSync(statePath, malformed);
  try {
    await assert.rejects(runUpdate(wolfDir, 1), /Refusing to replace malformed or unreadable cron state/);
    assert.equal(fs.readFileSync(statePath, "utf8"), malformed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
