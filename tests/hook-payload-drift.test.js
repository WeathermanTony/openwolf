import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hookPayloadDrift } from "../dist/src/cli/update.js";

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-drift-"));
  const build = path.join(base, "build");
  const wolf = path.join(base, ".wolf");
  fs.mkdirSync(build);
  fs.mkdirSync(path.join(wolf, "hooks"), { recursive: true });
  for (const [f, body] of [["shared.js", "a"], ["stop.js", "b"]]) {
    fs.writeFileSync(path.join(build, f), body);
    fs.writeFileSync(path.join(wolf, "hooks", f), body);
  }
  return { base, build, wolf };
}

test("hookPayloadDrift is empty when installed hooks match the build", () => {
  const { base, build, wolf } = setup();
  try { assert.deepEqual(hookPayloadDrift(wolf, build), []); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("hookPayloadDrift names changed and missing installed hooks", () => {
  const { base, build, wolf } = setup();
  try {
    fs.writeFileSync(path.join(wolf, "hooks", "shared.js"), "old");
    fs.rmSync(path.join(wolf, "hooks", "stop.js"));
    assert.deepEqual(hookPayloadDrift(wolf, build).sort(), ["shared.js", "stop.js"]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("hookPayloadDrift reports a missing build instead of claiming a match", () => {
  const { base, wolf } = setup();
  try { assert.deepEqual(hookPayloadDrift(wolf, ""), ["(no hook build found)"]); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("this checkout's installed hooks match its build", () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.deepEqual(hookPayloadDrift(path.join(repo, ".wolf"), path.join(repo, "dist", "src", "hooks")), []);
});
