import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const manifestModule = pathToFileURL(path.join(repoRoot, "src", "cli", "hook-manifest.ts")).href;
const sharedModule = pathToFileURL(path.join(repoRoot, "src", "hooks", "shared.ts")).href;
const nudgeModule = pathToFileURL(path.join(repoRoot, "dist", "src", "cli", "nudge-cmd.js")).href;
const initModule = pathToFileURL(path.join(repoRoot, "dist", "src", "cli", "init.js")).href;
const preWriteHook = path.join(repoRoot, "src", "hooks", "pre-write.js");
const manifest = await import(manifestModule);
const { generateTemplate, writeTemplateFile } = await import(initModule);

function runHealthMutation(projectRoot, expression) {
  const script = `import { recordHookHealth } from ${JSON.stringify(sharedModule)}; ${expression}`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`health mutation exited ${code}: ${stderr}`)));
  });
}

test("canonical manifest matches template settings and names the complete payload", () => {
  const template = JSON.parse(fs.readFileSync(path.join(repoRoot, "templates", "claude", "settings.json"), "utf8"));
  assert.deepEqual(template, manifest.HOOK_SETTINGS);
  assert.deepEqual([...manifest.HOOK_ENTRY_FILES], manifest.HOOK_REGISTRATIONS.map(item => item.entry));
  assert.ok(manifest.HOOK_HELPER_FILES.includes("complete-review.js"));
  assert.ok(manifest.HOOK_PAYLOAD_FILES.includes("complete-review.js"));
  assert.ok(manifest.HOOK_PAYLOAD_FILES.includes("nudges/project-scope.js"));
  assert.deepEqual([...manifest.HOOK_UTILITY_FILES], ["size-discipline.js"]);
  assert.deepEqual(manifest.missingHookRegistrations(template), []);
});

test("every executable hook resolves its static imports under self-check", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-hook-selfcheck-"));
  fs.mkdirSync(path.join(root, ".wolf", "hooks"), { recursive: true });
  try {
    for (const file of [...manifest.HOOK_ENTRY_FILES, ...manifest.HOOK_HELPER_FILES]) {
      const result = spawnSync(process.execPath, [path.join(repoRoot, "src", "hooks", file), "--selfcheck"], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${file}: ${result.stderr}`);
      assert.match(result.stdout, /^ok /, file);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hook health mutations retain concurrent failures and success resets the streak", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-hook-health-"));
  fs.mkdirSync(path.join(root, ".wolf", "hooks"), { recursive: true });
  try {
    const count = 30;
    await Promise.all(Array.from({ length: count }, () => runHealthMutation(root, 'recordHookHealth("post-read", new Error("boom"));')));
    const healthPath = path.join(root, ".wolf", "hooks", "_health.json");
    let health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
    assert.equal(health.hooks["post-read"].consecutive_failures, count);
    assert.match(health.hooks["post-read"].last_error_message, /boom/);

    await runHealthMutation(root, 'recordHookHealth("post-read");');
    health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
    assert.equal(health.hooks["post-read"].consecutive_failures, 0);
    assert.equal(typeof health.hooks["post-read"].last_success, "string");
    assert.equal("last_error" in health.hooks["post-read"], false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hook health refuses to replace malformed existing bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-hook-health-malformed-"));
  const hooksDir = path.join(root, ".wolf", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const healthPath = path.join(hooksDir, "_health.json");
  const malformed = "{ malformed health }";
  fs.writeFileSync(healthPath, malformed);
  try {
    await runHealthMutation(root, 'if (recordHookHealth("stop", new Error("boom")) !== false) process.exitCode = 2;');
    assert.equal(fs.readFileSync(healthPath, "utf8"), malformed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("matching legacy session state remains readable while SessionStart prefers keyed state", async () => {
  const { getSessionFilePath } = await import(sharedModule);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-session-compatibility-"));
  const hooksDir = path.join(root, "hooks");
  const sessionsDir = path.join(hooksDir, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionId = "legacy-session";
  const legacyPath = path.join(hooksDir, "_session.json");
  const keyedPath = path.join(sessionsDir, `${sessionId}.json`);
  try {
    fs.writeFileSync(legacyPath, JSON.stringify({ session_id: sessionId, stop_count: 4 }));
    assert.equal(getSessionFilePath(root, sessionId), legacyPath);
    assert.equal(getSessionFilePath(root, sessionId, true), keyedPath);

    fs.writeFileSync(keyedPath, JSON.stringify({ session_id: sessionId, stop_count: 0 }));
    assert.equal(getSessionFilePath(root, sessionId), keyedPath);
    assert.equal(getSessionFilePath(root, "different-session"), path.join(sessionsDir, "different-session.json"));
    assert.equal(getSessionFilePath(root, "bad/id"), legacyPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("session discovery prefers the harness id and otherwise uses the newest session file", async () => {
  const { currentSessionId } = await import(nudgeModule);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-session-discovery-"));
  const sessionsDir = path.join(root, "hooks", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, "older.json"), JSON.stringify({ session_id: "older-session" }));
  await new Promise(resolve => setTimeout(resolve, 10));
  fs.writeFileSync(path.join(sessionsDir, "newer.json"), JSON.stringify({ session_id: "newer-session" }));
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  try {
    delete process.env.CLAUDE_CODE_SESSION_ID;
    assert.equal(currentSessionId(root), "newer-session");
    process.env.CLAUDE_CODE_SESSION_ID = "harness-session";
    assert.equal(currentSessionId(root), "harness-session");
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pre-write persists a matched Do-Not-Repeat lesson hit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-pre-write-lesson-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(path.join(wolfDir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(wolfDir, "cerebrum.md"), [
    "# Cerebrum",
    "",
    "## Do-Not-Repeat",
    "",
    "- [2026-09-13] Never use eval",
    "",
    "## Decision Log",
    "",
  ].join("\n"));
  try {
    const result = spawnSync(process.execPath, [preWriteHook], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ tool_input: { content: "eval(input)" } }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /cerebrum warning/i);
    const stats = JSON.parse(fs.readFileSync(path.join(wolfDir, "cerebrum-stats.json"), "utf8"));
    const lessons = Object.values(stats.lessons);
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].hits, 1);
    assert.match(lessons[0].text, /Never use eval/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("nested WolfPack QA reductions are ignored by every shipped nested policy in isolation", () => {
  const templatePolicy = fs.readFileSync(path.join(repoRoot, "src", "templates", ".gitignore"), "utf8");
  const policies = [
    ["template", templatePolicy],
    ["embedded fallback", null],
  ];
  for (const [label, policy] of policies) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-nested-ignore-"));
    const wolfDir = path.join(root, ".wolf");
    const emptyGlobalExcludes = path.join(root, "empty-global-excludes");
    fs.mkdirSync(path.join(wolfDir, "qa", "nested"), { recursive: true });
    fs.writeFileSync(emptyGlobalExcludes, "");
    const installedPolicy = path.join(wolfDir, ".gitignore");
    if (policy === null) {
      generateTemplate(installedPolicy, ".gitignore");
      assert.equal(fs.readFileSync(installedPolicy, "utf8"), templatePolicy);
    } else {
      fs.writeFileSync(installedPolicy, policy);
    }
    try {
      const init = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
      assert.equal(init.status, 0, init.stderr);
      const checkIgnore = candidate => spawnSync(
        "git",
        ["-c", `core.excludesFile=${emptyGlobalExcludes}`, "check-ignore", "-q", candidate],
        { cwd: root, encoding: "utf8" }
      );
      for (const candidate of [".wolf/qa/reduction.md", ".wolf/qa/nested/reduction.md"]) {
        const result = checkIgnore(candidate);
        assert.equal(result.status, 0, `${label} ${candidate}: ${result.stderr}`);
      }
      for (const durable of [".wolf/qa/_README.md", ".wolf/qa/_template.md"]) {
        const result = checkIgnore(durable);
        assert.equal(result.status, 1, `${label} ${durable}`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("missing required overwrite templates fail closed without replacing installed bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-required-template-"));
  const templatesDir = path.join(root, "templates");
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(templatesDir);
  fs.mkdirSync(wolfDir);
  try {
    for (const file of ["PROTOCOL-UPGRADE-2026-06.md", "reframe-frameworks.md"]) {
      const destination = path.join(wolfDir, file);
      const installed = `installed ${file}\n`;
      fs.writeFileSync(destination, installed);
      assert.throws(
        () => writeTemplateFile(templatesDir, wolfDir, file),
        /Required Wolfpack template missing/
      );
      assert.equal(fs.readFileSync(destination, "utf8"), installed);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
