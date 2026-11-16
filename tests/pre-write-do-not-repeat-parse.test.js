import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const entries = ["src/hooks/pre-write.js", ".wolf/hooks/pre-write.js", "templates/wolf/hooks/pre-write.js", "dist/src/hooks/pre-write.js"];

function fixture(t, cerebrum) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-dnr-parse-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, ".wolf/hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".wolf/cerebrum.md"), cerebrum);
    return root;
}

function write(root, entry, content) {
    const input = { session_id: "dnr-parse", tool_name: "Write", tool_input: { file_path: path.join(root, "src/x.ts"), content } };
    const result = spawnSync(process.execPath, [entry], {
        input: JSON.stringify(input), encoding: "utf8", timeout: 60_000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    return result.stderr;
}

const subheaded = [
    "## Key Learnings", "- unrelated", "",
    "## Do-Not-Repeat", "", "### Old lessons", "- Never call `legacyFetchAll` in hooks.", "",
    "### Newer lessons", "- Avoid `unboundedRecursiveScan` on mounted drives.", "",
    "## Decision Log", "- Use `decisionOnlyAnchor` here.", "",
].join("\n");

for (const relative of entries) {
    const entry = path.join(repo, relative);

    test(`${relative} reads lessons under ### subheadings of Do-Not-Repeat`, t => {
        const root = fixture(t, subheaded);
        assert.match(write(root, entry, "legacyFetchAll();"), /cerebrum warning/);
        assert.match(write(root, entry, "unboundedRecursiveScan(dir);"), /cerebrum warning/);
    });

    test(`${relative} stops at the next ## heading, not inside Decision Log`, t => {
        const root = fixture(t, subheaded);
        assert.doesNotMatch(write(root, entry, "decisionOnlyAnchor();"), /cerebrum warning/);
    });

    test(`${relative} ignores short or letterless patterns`, t => {
        const root = fixture(t, "## Do-Not-Repeat\n- Never write \"the\" or `|` or `a` or `12345` here.\n");
        assert.doesNotMatch(write(root, entry, "the value | a 12345"), /cerebrum warning/);
    });

    test(`${relative} does not start at a ### Do-Not-Repeat inside another section`, t => {
        const root = fixture(t, "## Key Learnings\n### Do-Not-Repeat style note\n- Prefer `notALessonAnchor`.\n");
        assert.doesNotMatch(write(root, entry, "notALessonAnchor();"), /cerebrum warning/);
    });
}

for (const relative of entries) {
    const entry = path.join(repo, relative);
    test(`${relative} keeps short explicit "never use" names but not filler words`, t => {
        const root = fixture(t, "## Do-Not-Repeat\n- Never use eval on input.\n- Never use the old cache.\n");
        assert.match(write(root, entry, "eval(x)"), /cerebrum warning/);
        assert.doesNotMatch(write(root, entry, "the value"), /cerebrum warning/);
    });
}

for (const relative of entries) {
    const entry = path.join(repo, relative);
    test(`${relative} accepts a Do-Not-Repeat heading indented up to three spaces`, t => {
        const root = fixture(t, "  ## Do-Not-Repeat\n- Never call `legacyFetchAll` in hooks.\n   ## Decision Log\n- Use `decisionOnlyAnchor` here.\n");
        assert.match(write(root, entry, "legacyFetchAll();"), /cerebrum warning/);
        assert.doesNotMatch(write(root, entry, "decisionOnlyAnchor();"), /cerebrum warning/);
    });
}

for (const relative of entries) {
    const entry = path.join(repo, relative);
    test(`${relative} keeps short backticked code names, quoted or after "never use"`, t => {
        const root = fixture(t, "## Do-Not-Repeat\n- Never use `eval` on input.\n- Do not call `rax` directly.\n- Watch \"win\" and \"the\" claims.\n");
        assert.match(write(root, entry, "eval(input)"), /cerebrum warning/);
        assert.match(write(root, entry, "mov rax, 1"), /cerebrum warning/);
        assert.doesNotMatch(write(root, entry, "the win"), /cerebrum warning/);
    });
}

for (const relative of entries) {
    const entry = path.join(repo, relative);
    test(`${relative} accepts identifiers with digits after "never use"`, t => {
        const root = fixture(t, "## Do-Not-Repeat\n- Never use md5 for password hashing.\n");
        assert.match(write(root, entry, "md5(password)"), /cerebrum warning/);
    });
}

for (const relative of entries) {
    const entry = path.join(repo, relative);
    test(`${relative} keeps code keywords such as any and new`, t => {
        const root = fixture(t, "## Do-Not-Repeat\n- Never use `any` in exported TypeScript APIs.\n- Never use new for resource objects.\n- Never use the legacy path.\n");
        assert.match(write(root, entry, "export const payload: any = input;"), /cerebrum warning/);
        assert.match(write(root, entry, "const r = new Resource();"), /cerebrum warning/);
        assert.doesNotMatch(write(root, entry, "read the value"), /cerebrum warning/);
    });
}

for (const relative of entries) {
    const entry = path.join(repo, relative);
    test(`${relative} keeps short unquoted and backticked names (rm, fs, 3DES)`, t => {
        const root = fixture(t, "## Do-Not-Repeat\n- Never use rm on the workspace.\n- Never use 3DES.\n- Do not import `fs` here.\n- Never use a global.\n");
        assert.match(write(root, entry, "rm -rf workspace"), /cerebrum warning/);
        assert.match(write(root, entry, "cipher = 3DES"), /cerebrum warning/);
        assert.match(write(root, entry, "import fs from 'node:fs'"), /cerebrum warning/);
        assert.doesNotMatch(write(root, entry, "a value"), /cerebrum warning/);
    });
}
