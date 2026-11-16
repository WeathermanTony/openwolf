// A new review lists only files whose current bytes no completed review has
// covered. Before custom.35 each new review in a session re-listed every file
// written in that session (automatetasks review-0069..0073 sent the same three
// memory notes, at the same hashes, to the reviewer five times).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');
const SID = 'review-scope-session';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-review-scope-'));
  fs.mkdirSync(path.join(root, '.wolf', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.wolf', 'config.json'), JSON.stringify({
    version: 1,
    openwolf: { behavior: { mode: 'quiet' }, hook_messages: { reviewer_profile: 'us-only' }, review_hook: { scope_excludes: [] } },
  }));
  run('session-start', root, { session_id: SID });
  return root;
}

function run(name, root, input, args = []) {
  return spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', `${name}.js`), ...args], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: input === undefined ? '' : JSON.stringify(input),
    encoding: 'utf8',
  });
}

const lines = (tag, n = 80) => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = compute(${i}, "${tag}-${i}-padding");`).join('\n');

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  assert.equal(run('post-write', root, { session_id: SID, tool_name: 'Write', tool_input: { file_path: file, content } }).status, 0);
}

const stop = (root) => run('stop', root, { session_id: SID });
const reviews = (root) => JSON.parse(fs.readFileSync(path.join(root, '.wolf', 'reviewlog.json'), 'utf8')).reviews;
const names = (r) => r.files.map((f) => path.basename(f)).sort();

function complete(root, id) {
  const res = run('complete-review', root, undefined, [id, '--reviewed-current', '--reviewer', 'test', '--summary', 'clean']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
}

test('a new review lists only files changed since the last completed review', () => {
  const root = fixture();
  try {
    write(root, 'src/a.ts', lines('a'));
    stop(root);
    complete(root, reviews(root)[0].id);
    write(root, 'src/b.ts', lines('b'));
    const out = stop(root).stdout;
    const log = reviews(root);
    assert.equal(log.length, 2);
    assert.deepEqual(names(log[1]), ['b.ts']);
    assert.deepEqual(Object.keys(log[1].content_hashes).map((f) => path.basename(f)), ['b.ts']);
    assert.match(out, /Files: src\/b\.ts\./);
    assert.doesNotMatch(out, /a\.ts/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a reviewed file that changed again is listed again', () => {
  const root = fixture();
  try {
    write(root, 'src/a.ts', lines('a'));
    stop(root);
    complete(root, reviews(root)[0].id);
    write(root, 'src/a.ts', lines('a2'));
    write(root, 'src/b.ts', lines('b'));
    stop(root);
    assert.deepEqual(names(reviews(root)[1]), ['a.ts', 'b.ts']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reverting to bytes an older review saw still needs a review (A→B→A)', () => {
  const root = fixture();
  try {
    write(root, 'src/a.ts', lines('a'));
    stop(root);
    complete(root, reviews(root)[0].id);
    write(root, 'src/a.ts', lines('a2'));
    stop(root);
    complete(root, reviews(root)[1].id);
    write(root, 'src/a.ts', lines('a'));
    stop(root);
    const log = reviews(root);
    assert.equal(log.length, 3);
    assert.deepEqual(names(log[2]), ['a.ts']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('files covered across several completed reviews raise no new review', () => {
  const root = fixture();
  try {
    write(root, 'src/a.ts', lines('a'));
    stop(root);
    complete(root, reviews(root)[0].id);
    write(root, 'src/b.ts', lines('b'));
    stop(root);
    complete(root, reviews(root)[1].id);
    // Same bytes rewritten: enough new output to cross the size threshold,
    // but nothing a reviewer has not already seen.
    write(root, 'src/a.ts', lines('a'));
    write(root, 'src/b.ts', lines('b'));
    const out = stop(root);
    assert.doesNotMatch(out.stdout + out.stderr, /Wolfpack review \[/);
    assert.equal(reviews(root).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
