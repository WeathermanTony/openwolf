import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionStartHook = path.join(repoRoot, "dist", "src", "hooks", "session-start.js");

function runSessionStart(projectRoot, sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [sessionStartHook], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`session-start exited ${code}: ${stderr}`)));
    child.stdin.end(JSON.stringify({ session_id: sessionId, source: "startup" }));
  });
}

test("parallel SessionStart hooks retain all ledger increments and isolate state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-session-start-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(path.join(wolfDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(wolfDir, "cerebrum.md"), "# Cerebrum\n\n- one\n- two\n- three\n");
  fs.writeFileSync(path.join(wolfDir, "buglog.json"), JSON.stringify({ bugs: [{}] }));
  fs.writeFileSync(path.join(wolfDir, "memory.md"), "# Memory\n");
  const activeTmp = path.join(wolfDir, "active-writer.tmp");
  fs.writeFileSync(activeTmp, "in flight");
  const staleTmp = path.join(wolfDir, "abandoned-writer.tmp");
  fs.writeFileSync(staleTmp, "stale");
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(staleTmp, old, old);
  const count = 30;
  try {
    await Promise.all(Array.from({ length: count }, (_, index) => runSessionStart(root, `session-${index}-test`)));
    const ledger = JSON.parse(fs.readFileSync(path.join(wolfDir, "token-ledger.json"), "utf8"));
    assert.equal(ledger.lifetime.total_sessions, count);
    const stateFiles = fs.readdirSync(path.join(wolfDir, "hooks", "sessions")).filter(name => name.endsWith(".json"));
    assert.equal(stateFiles.length, count);
    assert.equal(fs.readFileSync(activeTmp, "utf8"), "in flight");
    assert.equal(fs.existsSync(staleTmp), false);

    await runSessionStart(root, "session-0-test");
    const ledgerAfterResume = JSON.parse(fs.readFileSync(path.join(wolfDir, "token-ledger.json"), "utf8"));
    assert.equal(ledgerAfterResume.lifetime.total_sessions, count);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
