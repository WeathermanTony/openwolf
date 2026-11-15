import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HOOK_PAYLOAD_FILES, HOOK_UTILITY_FILES, HOOK_RUNTIME_MANIFEST } from "../src/cli/hook-manifest.ts";

const repo = path.resolve(import.meta.dirname, "..");
const entries = ["src/hooks/pre-write.js", ".wolf/hooks/pre-write.js", "templates/wolf/hooks/pre-write.js", "dist/src/hooks/pre-write.js"];
const lesson = "Use `atomicWriteJson` with `acquireFileLock` to preserve concurrent writes.";

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-pre-write-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, ".wolf/hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".wolf/cerebrum.md"), `## Do-Not-Repeat\n- [2026-09-13] ${lesson}\n`);
    fs.writeFileSync(path.join(root, ".wolf/config.json"), JSON.stringify({ openwolf: { lesson_recall: { enabled: true } } }));
    return root;
}

function payload(root, content = "atomicWriteJson(value); acquireFileLock(target);") {
    return { session_id: "retirement-test", tool_name: "Write", tool_input: { file_path: path.join(root, "src/writer.ts"), content } };
}

function run(root, input, entry, extra = {}) {
    const result = spawnSync(process.execPath, [...(extra.args ?? []), entry], {
        input: JSON.stringify(input), encoding: "utf8", timeout: 60_000, // generous: the full suite runs many processes in parallel
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...(extra.env ?? {}) },
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    return result;
}

for (const relative of entries) {
    test(`${relative} preserves legacy warnings and lesson identity despite stale opt-in`, t => {
        const root = fixture(t);
        const result = run(root, payload(root), path.join(repo, relative));
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /cerebrum warning/);
        const stats = JSON.parse(fs.readFileSync(path.join(root, ".wolf/cerebrum-stats.json"), "utf8"));
        const id = crypto.createHash("sha1").update(lesson).digest("hex").slice(0, 12);
        assert.deepEqual(Object.keys(stats.lessons), [id]);
        assert.equal(stats.lessons[id].hits, 1);
        assert.equal(fs.existsSync(path.join(root, ".wolf/nudge-state.json")), false);
    });

    test(`${relative} never accesses foreign project state for direct, relative or symlink targets`, t => {
        const root = fixture(t), foreign = fixture(t);
        fs.writeFileSync(path.join(foreign, ".wolf/cerebrum.md"), "## Do-Not-Repeat\n- Use `foreignPrivateAnchor`.\n");
        fs.symlinkSync(foreign, path.join(root, "linked"), "dir");
        const probe = path.join(root, "deny-foreign.mjs");
        fs.writeFileSync(probe, `import fs from "node:fs"; import path from "node:path"; import {syncBuiltinESMExports} from "node:module";
const foreign = process.env.FOREIGN_ROOT;
for (const name of ["readFileSync", "writeFileSync", "appendFileSync", "existsSync", "statSync", "lstatSync", "readdirSync", "openSync", "mkdirSync"]) {
 const original = fs[name]; fs[name] = function(...args) {
  const p = typeof args[0] === "string" ? path.resolve(args[0]) : null;
  if (p && (p === foreign || p.startsWith(foreign + path.sep))) { process.stderr.write("FOREIGN_STATE_ACCESS:" + name + "\\n"); throw Error("Foreign state access"); }
  return original.apply(this, args);
 };
}
syncBuiltinESMExports();`);
        const before = fs.readFileSync(path.join(foreign, ".wolf/cerebrum.md"));
        for (const target of [path.join(foreign, "src/new.ts"), path.relative(root, path.join(foreign, "src/new.ts")), path.join(root, "linked/src/new.ts")]) {
            const input = payload(root, "foreignPrivateAnchor();");
            input.tool_input.file_path = target;
            const result = run(root, input, path.join(repo, relative), { args: ["--import", probe], env: { FOREIGN_ROOT: foreign } });
            assert.equal(result.stdout, "");
            assert.doesNotMatch(result.stderr, /FOREIGN_STATE_ACCESS|foreignPrivateAnchor/);
        }
        assert.deepEqual(fs.readFileSync(path.join(foreign, ".wolf/cerebrum.md")), before);
        assert.equal(fs.existsSync(path.join(foreign, ".wolf/cerebrum-stats.json")), false);
        assert.equal(fs.existsSync(path.join(foreign, ".wolf/nudge-state.json")), false);
    });
}

test("empty edits do not warn or record lesson hits", t => {
    const root = fixture(t);
    const result = run(root, payload(root, "  "), path.join(repo, entries[0]));
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /cerebrum warning/);
    assert.equal(fs.existsSync(path.join(root, ".wolf/cerebrum-stats.json")), false);
});

test("existing same-file buglog advice is retained", t => {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, ".wolf/buglog.json"), JSON.stringify({ version: 1, bugs: [{
        id: "bug-001", file: "src/writer.ts", tags: ["race"], error_message: "Concurrent writer race", root_cause: "Missing lock", fix: "Preserve locking",
    }] }));
    const result = run(root, payload(root, "fixRace();"), path.join(repo, entries[0]));
    assert.match(result.stderr, /buglog: 1 past bug/);
    assert.equal(result.stdout, "");
});

for (const relative of entries) {
    test(`${relative} matches normalized project paths, not a same-basename sibling`, t => {
        const root = fixture(t);
        const bug = { tags: ["race"], error_message: "Concurrent writer race", root_cause: "Missing lock", fix: "Preserve locking" };
        fs.writeFileSync(path.join(root, ".wolf/buglog.json"), JSON.stringify({ version: 1, bugs: [
            { ...bug, id: "bug-001", file: "legacy/writer.ts" },
            { ...bug, id: "bug-002", file: "src/../src/writer.ts" },
            { ...bug, id: "bug-003", file: "writer.ts" },
            { ...bug, id: "bug-004", file: "" },
            { ...bug, id: "bug-005", file: null },
        ] }));
        for (const target of [path.join(root, "src/writer.ts"), "src/writer.ts"]) {
            const input = payload(root, "race();");
            input.tool_input.file_path = target;
            const result = run(root, input, path.join(repo, relative));
            assert.match(result.stderr, /buglog: 1 past bug/);
            assert.match(result.stderr, /\[bug-002\]/);
            assert.doesNotMatch(result.stderr, /\[bug-00[1345]\]/);
        }
    });

    test(`${relative} does not suggest driving-project bugs for a foreign same-basename target`, t => {
        const root = fixture(t), foreign = fixture(t);
        fs.writeFileSync(path.join(root, ".wolf/buglog.json"), JSON.stringify({ version: 1, bugs: [{
            id: "bug-001", file: "src/writer.ts", tags: ["race"], error_message: "Concurrent writer race", root_cause: "Missing lock", fix: "Preserve locking",
        }] }));
        const input = payload(root, "race();");
        input.tool_input.file_path = path.join(foreign, "src/writer.ts");
        const result = run(root, input, path.join(repo, relative));
        assert.doesNotMatch(result.stderr, /buglog/);
        assert.equal(result.stdout, "");
    });
}

test("completed stdin clears its fallback timer instead of keeping the hook alive four seconds", () => {
    const moduleUrl = new URL("../src/hooks/shared.js", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import {readStdin} from ${JSON.stringify(moduleUrl)}; process.stdout.write(await readStdin());`],
        { input: '{"closed":true}', encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    assert.equal(result.stdout, '{"closed":true}');
});

test("portable manifest loads legacy pre-write without the retired helper", t => {
    const root = fixture(t), wolf = path.join(root, ".wolf");
    for (const file of HOOK_PAYLOAD_FILES) {
        const target = path.join(wolf, "hooks", file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(repo, "dist/src/hooks", file), target);
    }
    fs.writeFileSync(path.join(wolf, "hooks/package.json"), '{"type":"module"}');
    fs.mkdirSync(path.join(wolf, "utils"));
    for (const file of HOOK_UTILITY_FILES) fs.copyFileSync(path.join(repo, "dist/src/utils", file), path.join(wolf, "utils", file));
    fs.writeFileSync(path.join(wolf, "utils/package.json"), '{"type":"module"}');
    assert.equal(HOOK_RUNTIME_MANIFEST.hooks.includes("lesson-recall.js"), false);
    assert.equal(fs.existsSync(path.join(wolf, "hooks/lesson-recall.js")), false);
    const result = run(root, payload(root), path.join(wolf, "hooks/pre-write.js"));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cerebrum warning/);
});

test("scaffolds and compiled/runtime copies omit the retired integration", () => {
    for (const file of ["src/config/default-config.json", "src/templates/config.json", "templates/wolf/config.json"]) {
        assert.equal("lesson_recall" in JSON.parse(fs.readFileSync(path.join(repo, file), "utf8")).openwolf, false);
    }
    for (const file of [".wolf/hooks/manifest.json", "templates/wolf/hooks/manifest.json"]) {
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, file), "utf8")), HOOK_RUNTIME_MANIFEST);
    }
    const normalize = text => text.replace(/\n\/\/# sourceMappingURL=.*\n?$/, "\n");
    const compiled = normalize(fs.readFileSync(path.join(repo, entries[3]), "utf8"));
    for (const file of entries.slice(0, 3)) assert.equal(normalize(fs.readFileSync(path.join(repo, file), "utf8")), compiled, file);
    assert.doesNotMatch(compiled, /lesson.recall|recallLessons|resolveOwningProject|learning\.recall/);
    for (const file of ["src/hooks/lesson-recall.ts", "src/hooks/lesson-recall.js", ".wolf/hooks/lesson-recall.js", "templates/wolf/hooks/lesson-recall.js", "dist/src/hooks/lesson-recall.js"]) {
        assert.equal(fs.existsSync(path.join(repo, file)), false, file);
    }
});
