import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postReadHook = path.join(repoRoot, "dist", "src", "hooks", "post-read.js");

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-hook-state-"));
  fs.mkdirSync(path.join(root, ".wolf", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".wolf", "anatomy.md"), "# anatomy.md\n");
  return root;
}

function runHook(projectRoot, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [postReadHook], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`hook exited ${code}: ${stderr}`)));
    child.stdin.end(JSON.stringify(payload));
  });
}

test("post-read rejects sibling-prefix paths", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-containment-"));
  const root = path.join(parent, "project");
  const sibling = path.join(parent, "project-private");
  fs.mkdirSync(path.join(root, ".wolf", "hooks"), { recursive: true });
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(root, ".wolf", "anatomy.md"), "# anatomy.md\n");
  const outside = path.join(sibling, "secret.ts");
  fs.writeFileSync(outside, "export const secret = true;\n");
  try {
    await runHook(root, {
      session_id: "containment-test",
      tool_input: { file_path: outside },
      tool_output: { content: "export const secret = true;" },
    });
    assert.equal(fs.existsSync(path.join(root, ".wolf", "hooks", "sessions", "containment-test.json")), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("parallel post-read hooks retain every update", async () => {
  const root = makeProject();
  const count = 40;
  try {
    await Promise.all(Array.from({ length: count }, async (_, index) => {
      const file = path.join(root, `file-${index}.ts`);
      fs.writeFileSync(file, `export const value${index} = ${index};\n`);
      await runHook(root, {
        session_id: "parallel-session",
        tool_input: { file_path: file },
        tool_output: { content: `export const value${index} = ${index};` },
      });
    }));
    const statePath = path.join(root, ".wolf", "hooks", "sessions", "parallel-session.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(Object.keys(state.files_read).length, count);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("different session IDs keep independent read state", async () => {
  const root = makeProject();
  try {
    const first = path.join(root, "first.ts");
    const second = path.join(root, "second.ts");
    fs.writeFileSync(first, "export const first = true;\n");
    fs.writeFileSync(second, "export const second = true;\n");
    await Promise.all([
      runHook(root, { session_id: "session-one", tool_input: { file_path: first }, tool_output: { content: "first" } }),
      runHook(root, { session_id: "session-two", tool_input: { file_path: second }, tool_output: { content: "second" } }),
    ]);
    const one = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hooks", "sessions", "session-one.json"), "utf8"));
    const two = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hooks", "sessions", "session-two.json"), "utf8"));
    assert.deepEqual(Object.keys(one.files_read), [first.replaceAll("\\", "/")]);
    assert.deepEqual(Object.keys(two.files_read), [second.replaceAll("\\", "/")]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
