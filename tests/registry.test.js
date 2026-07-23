// Tests for bug-440: malformed registry entries (missing root/name) must not
// crash consumers; readRegistry filters them with a warning and the next
// writeRegistry persists the cleanup.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DIST_REGISTRY = new URL("../dist/src/cli/registry.js", import.meta.url);

function withHome(fn) {
  const fixture = fs.mkdtempSync(path.join(os.homedir(), "ow-registry-test-"));
  const prevHome = process.env.HOME;
  process.env.HOME = fixture;
  return Promise.resolve()
    .then(() => fn(fixture))
    .finally(() => {
      process.env.HOME = prevHome;
      fs.rmSync(fixture, { recursive: true, force: true });
    });
}

function seedRegistry(fixture, projects) {
  const dir = path.join(fixture, ".openwolf");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "registry.json"), JSON.stringify({ version: 1, projects }, null, 2));
}

async function importFresh() {
  return import(`${DIST_REGISTRY.href}?t=${Date.now()}-${Math.random()}`);
}

test("readRegistry filters malformed entries instead of crashing consumers (bug-440)", async () => {
  await withHome(async (fixture) => {
    const realRoot = fs.mkdtempSync(path.join(fixture, "proj-"));
    fs.mkdirSync(path.join(realRoot, ".wolf"));
    seedRegistry(fixture, [
      { root: realRoot, name: "good", registered_at: "x", last_updated: "x", version: "1" },
      { name: "missing-root", registered_at: "x" },
      { root: realRoot },
      null,
      "garbage",
    ]);
    const stderr = [];
    const origErr = console.error;
    console.error = (msg) => stderr.push(String(msg));
    try {
      const { getRegisteredProjects } = await importFresh();
      const projects = getRegisteredProjects(false);
      assert.equal(projects.length, 1, "only the well-formed entry survives");
      assert.equal(projects[0].name, "good");
      // The update.ts crash site: path.join(project.root, ".wolf") + p.root.toLowerCase()
      assert.doesNotThrow(() => projects.map((p) => path.join(p.root, ".wolf")));
      assert.doesNotThrow(() => projects.map((p) => p.root.toLowerCase()));
    } finally {
      console.error = origErr;
    }
    assert.ok(stderr.some((m) => m.includes("4 malformed registry entries")), `warning names the drop count, got: ${stderr}`);
  });
});

test("readRegistry tolerates a projects field that is not an array", async () => {
  await withHome(async (fixture) => {
    const dir = path.join(fixture, ".openwolf");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "registry.json"), JSON.stringify({ version: 1, projects: "oops" }));
    const { readRegistry } = await importFresh();
    assert.deepEqual(readRegistry(), { version: 1, projects: [] });
  });
});

test("cleanup of malformed entries persists on the next registry write", async () => {
  await withHome(async (fixture) => {
    const realRoot = fs.mkdtempSync(path.join(fixture, "proj-"));
    seedRegistry(fixture, [
      { root: realRoot, name: "good", registered_at: "x", last_updated: "x", version: "1" },
      { path: "/wrong/key" },
    ]);
    const origErr = console.error;
    console.error = () => {};
    try {
      const { registerProject, readRegistry } = await importFresh();
      registerProject(realRoot, "good", "2"); // triggers writeRegistry with the filtered list
      console.error = origErr;
      const onDisk = JSON.parse(fs.readFileSync(path.join(fixture, ".openwolf", "registry.json"), "utf8"));
      assert.equal(onDisk.projects.length, 1, "malformed entry healed from disk");
      assert.equal(onDisk.projects[0].version, "2");
      const after = readRegistry();
      assert.equal(after.projects.length, 1);
    } finally {
      console.error = origErr;
    }
  });
});
