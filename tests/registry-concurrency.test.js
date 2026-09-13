import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const registryModule = pathToFileURL(path.resolve("dist/src/cli/registry.js")).href;

function runRegister(home, root, index) {
  const script = `import { registerProject } from ${JSON.stringify(registryModule)}; registerProject(${JSON.stringify(root)}, ${JSON.stringify(`project-${index}`)}, "test");`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`register exited ${code}: ${stderr}`)));
  });
}

test("parallel registry registrations retain every project", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-registry-home-"));
  const count = 40;
  try {
    await Promise.all(Array.from({ length: count }, (_, index) => runRegister(home, `/tmp/wolf-project-${index}`, index)));
    const registry = JSON.parse(fs.readFileSync(path.join(home, ".openwolf", "registry.json"), "utf8"));
    assert.equal(registry.projects.length, count);
    assert.equal(new Set(registry.projects.map(project => project.root)).size, count);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("registry mutation preserves malformed existing bytes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-registry-malformed-"));
  const registryDir = path.join(home, ".openwolf");
  const registryPath = path.join(registryDir, "registry.json");
  fs.mkdirSync(registryDir);
  const malformed = "{ malformed registry bytes }";
  fs.writeFileSync(registryPath, malformed);
  try {
    await assert.rejects(runRegister(home, "/tmp/new-project", 1), /Refusing to replace malformed or unreadable/);
    assert.equal(fs.readFileSync(registryPath, "utf8"), malformed);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
