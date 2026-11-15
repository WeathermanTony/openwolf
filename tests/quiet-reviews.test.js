import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');
const loaderPath = path.join(repo, 'scripts', 'ancestor-hook.mjs');
const { findCoveringAncestor, loadTrustedRoots } = await import(loaderPath);
const ALL = { has: () => true };

function fixture(behavior, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-quiet-review-'));
  fs.mkdirSync(path.join(root, '.wolf', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.wolf', 'config.json'), JSON.stringify({
    version: 1,
    // Fixtures live under /tmp, which the review gate skips by default.
    openwolf: { behavior, hook_messages: { reviewer_profile: 'us-only' }, ...extra, review_hook: { scope_excludes: [], ...(extra.review_hook ?? {}) } },
  }));
  return root;
}

function runHook(name, root, input) {
  return spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', `${name}.js`)], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

function codeLines(n, tag = 'x') {
  return Array.from({ length: n }, (_, i) => `export const ${tag}${i} = computeSomething(${i}, "${tag}-${i}-padding");`).join('\n');
}

function write(root, rel, content, sid = 'quiet-review-session') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return runHook('post-write', root, { session_id: sid, tool_name: 'Write', tool_input: { file_path: file, content } });
}

function stop(root, sid = 'quiet-review-session') {
  return runHook('stop', root, { session_id: sid });
}

function reviews(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.wolf', 'reviewlog.json'), 'utf8')).reviews ?? []; }
  catch { return []; }
}

function sessionWrites(root, sid = 'quiet-review-session') {
  return JSON.parse(fs.readFileSync(path.join(root, '.wolf', 'hooks', 'sessions', `${sid}.json`), 'utf8')).files_written;
}

test('quiet_reviews asks for a US-only review after a large write in quiet mode', () => {
  const root = fixture({ mode: 'quiet', quiet_reviews: true });
  try {
    runHook('session-start', root, { session_id: 'quiet-review-session' });
    assert.equal(write(root, 'src/big.ts', codeLines(80)).status, 0);
    assert.ok(sessionWrites(root)[0].tokens > 0, 'quiet_reviews records real write sizes');
    const result = stop(root);
    assert.equal(result.status, 0, result.stderr);
    const out = result.stdout + result.stderr;
    assert.match(out, /Wolfpack review \[/);
    assert.match(out, /gov\/US-only — US-based provider companions only \(Claude, Fable, ChatGPT, Astra, Grok\)/);
    const log = reviews(root);
    assert.equal(log.length, 1);
    assert.equal(log[0].status, 'pending');
    // Quiet mode still skips the other standard bookkeeping.
    assert.equal(fs.existsSync(path.join(root, '.wolf', 'memory.md')), false);
    assert.equal(fs.existsSync(path.join(root, '.wolf', 'anatomy.md')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('plain quiet mode still asks for no review and records zero sizes', () => {
  const root = fixture({ mode: 'quiet' });
  try {
    runHook('session-start', root, { session_id: 'quiet-review-session' });
    write(root, 'src/big.ts', codeLines(80));
    assert.equal(sessionWrites(root)[0].tokens, 0);
    const result = stop(root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /Wolfpack review/);
    assert.equal(reviews(root).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('quiet_reviews stays silent for a small change', () => {
  const root = fixture({ mode: 'quiet', quiet_reviews: true });
  try {
    runHook('session-start', root, { session_id: 'quiet-review-session' });
    write(root, 'src/small.ts', codeLines(3));
    const result = stop(root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /Wolfpack review/);
    assert.equal(reviews(root).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('quiet_reviews adds up repeated writes to one file', () => {
  const root = fixture({ mode: 'quiet', quiet_reviews: true });
  try {
    runHook('session-start', root, { session_id: 'quiet-review-session' });
    const one = write(root, 'src/grow.ts', codeLines(20, 'a'));
    assert.equal(one.status, 0);
    const firstTokens = sessionWrites(root)[0].tokens;
    write(root, 'src/grow.ts', codeLines(20, 'b'));
    write(root, 'src/grow.ts', codeLines(20, 'c'));
    const writes = sessionWrites(root);
    assert.equal(writes.length, 1, 'quiet mode keeps one entry per file');
    assert.ok(writes[0].tokens >= firstTokens * 2.5, `expected accumulated tokens, got ${writes[0].tokens} vs first ${firstTokens}`);
    const result = stop(root);
    assert.match(result.stdout + result.stderr, /Wolfpack review \[/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('quiet_reviews honours always_review_paths for a one-line edit', () => {
  const root = fixture({ mode: 'quiet', quiet_reviews: true }, { review_hook: { always_review_paths: ['**/creds/**'] } });
  try {
    runHook('session-start', root, { session_id: 'quiet-review-session' });
    write(root, 'scripts/creds/load.ps1', '$x = 1\n');
    const result = stop(root);
    assert.match(result.stdout + result.stderr, /sensitive path\(s\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('quiet_reviews does not repeat the reminder for already-covered work', () => {
  const root = fixture({ mode: 'quiet', quiet_reviews: true });
  try {
    runHook('session-start', root, { session_id: 'quiet-review-session' });
    write(root, 'src/big.ts', codeLines(80));
    assert.match(stop(root).stdout + '', /Wolfpack review \[/);
    const second = stop(root);
    assert.doesNotMatch(second.stdout + second.stderr, /Wolfpack review \[/);
    assert.equal(reviews(root).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function trustHome(base, roots) {
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.openwolf'), { recursive: true });
  fs.writeFileSync(path.join(home, '.openwolf', 'ancestor-roots.json'), JSON.stringify({ roots }));
  return home;
}

function edit(root, rel, toolInput, toolName = 'Edit', sid = 'quiet-review-session') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  return runHook('post-write', root, { session_id: sid, tool_name: toolName, tool_input: { file_path: file, ...toolInput } });
}

for (const mode of ['quiet', 'standard']) {
  test(`${mode}: a large deletion still reaches the review size threshold`, () => {
    const root = fixture({ mode, quiet_reviews: true });
    try {
      runHook('session-start', root, { session_id: 'quiet-review-session' });
      assert.equal(edit(root, 'src/old.ts', { old_string: codeLines(80), new_string: '' }).status, 0);
      assert.ok(sessionWrites(root)[0].tokens > 0, 'deletion is sized by the removed text');
      const result = stop(root);
      assert.match(result.stdout + result.stderr, /Wolfpack review \[/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test(`${mode}: a MultiEdit is sized from its edits`, () => {
    const root = fixture({ mode, quiet_reviews: true });
    try {
      runHook('session-start', root, { session_id: 'quiet-review-session' });
      const edits = [
        { old_string: 'a', new_string: codeLines(40, 'm') },
        { old_string: codeLines(40, 'n'), new_string: 'b' },
      ];
      assert.equal(edit(root, 'src/multi.ts', { edits }, 'MultiEdit').status, 0);
      const t = sessionWrites(root)[0].tokens;
      const single = (() => { const r = fixture({ mode }); try { runHook('session-start', r, { session_id: 'quiet-review-session' }); write(r, 'src/one.ts', codeLines(40, 'm')); return sessionWrites(r)[0].tokens; } finally { fs.rmSync(r, { recursive: true, force: true }); } })();
      assert.ok(t >= single * 1.8, `MultiEdit tokens ${t} should cover both edits (single ${single})`);
      assert.match(stop(root).stdout, /Wolfpack review \[/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('ancestor loader runs when installed under a path with spaces', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf ancestor space-'));
  try {
    const loaderCopy = path.join(base, 'has space', 'ancestor-hook.mjs');
    fs.mkdirSync(path.dirname(loaderCopy), { recursive: true });
    fs.copyFileSync(loaderPath, loaderCopy);
    fs.mkdirSync(path.join(base, 'work', '.wolf', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(base, 'work', '.wolf', 'config.json'), JSON.stringify({ openwolf: { behavior: { cover_subfolders: true } } }));
    const marker = path.join(base, 'ran');
    fs.writeFileSync(path.join(base, 'work', '.wolf', 'hooks', 'stop.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes');\n`);
    const sub = path.join(base, 'work', 'sub');
    fs.mkdirSync(sub);
    const home = trustHome(base, [path.join(base, 'work')]);
    const r = spawnSync(process.execPath, [loaderCopy, 'stop'], { cwd: sub, env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: sub }, input: '', encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(marker), true, r.stderr);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

function tree() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-ancestor-'));
  const mk = (rel, cfg) => {
    fs.mkdirSync(path.join(base, rel, '.wolf', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(base, rel, '.wolf', 'config.json'), JSON.stringify(cfg));
  };
  return { base, mk };
}

test('ancestor loader picks the nearest opted-in .wolf', () => {
  const { base, mk } = tree();
  try {
    mk('work', { openwolf: { behavior: { mode: 'quiet', cover_subfolders: true } } });
    fs.mkdirSync(path.join(base, 'work', 'zoom', 'deep'), { recursive: true });
    assert.equal(findCoveringAncestor(path.join(base, 'work', 'zoom', 'deep'), ALL), path.join(base, 'work'));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('ancestor loader stops at a nearer .wolf that has not opted in', () => {
  const { base, mk } = tree();
  try {
    mk('', { openwolf: { behavior: { mode: 'quiet', cover_subfolders: true } } });
    mk('work', { openwolf: { behavior: { mode: 'quiet' } } });
    fs.mkdirSync(path.join(base, 'work', 'zoom'), { recursive: true });
    assert.equal(findCoveringAncestor(path.join(base, 'work', 'zoom'), ALL), null);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('ancestor loader does nothing when the session folder has its own .wolf', () => {
  const { base, mk } = tree();
  try {
    mk('work', { openwolf: { behavior: { mode: 'quiet', cover_subfolders: true } } });
    mk('work/audit', { openwolf: { behavior: { mode: 'quiet' } } });
    assert.equal(findCoveringAncestor(path.join(base, 'work', 'audit'), ALL), null);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('ancestor loader treats an unreadable config as not opted in', () => {
  const { base, mk } = tree();
  try {
    mk('work', {});
    fs.writeFileSync(path.join(base, 'work', '.wolf', 'config.json'), '{not json');
    fs.mkdirSync(path.join(base, 'work', 'zoom'), { recursive: true });
    assert.equal(findCoveringAncestor(path.join(base, 'work', 'zoom'), ALL), null);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('ancestor loader runs the ancestor hook with CLAUDE_PROJECT_DIR set to the ancestor', () => {
  const { base, mk } = tree();
  try {
    mk('work', { openwolf: { behavior: { mode: 'quiet', cover_subfolders: true } } });
    const marker = path.join(base, 'marker.json');
    fs.writeFileSync(path.join(base, 'work', '.wolf', 'hooks', 'stop.js'),
      `import fs from 'node:fs';\nlet input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({dir:process.env.CLAUDE_PROJECT_DIR,from:process.env.WOLFPACK_ANCESTOR_SESSION_DIR,input})));\n`);
    fs.writeFileSync(path.join(base, 'work', '.wolf', 'hooks', 'package.json'), '{"type":"module"}');
    const sub = path.join(base, 'work', 'zoom');
    fs.mkdirSync(sub, { recursive: true });
    const home = trustHome(base, [path.join(base, 'work')]);
    const r = spawnSync(process.execPath, [loaderPath, 'stop'], {
      cwd: sub, env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: sub }, input: '{"session_id":"s1"}', encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const seen = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(seen.dir, path.join(base, 'work'));
    assert.equal(seen.from, sub);
    assert.equal(seen.input, '{"session_id":"s1"}');
    // Unknown hook names are ignored.
    fs.rmSync(marker);
    spawnSync(process.execPath, [loaderPath, '../../evil'], { cwd: sub, env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: sub }, input: '', encoding: 'utf8' });
    assert.equal(fs.existsSync(marker), false);
    // An opted-in ancestor that is not on the user's allowlist never runs.
    const untrusted = trustHome(path.join(base, 'other'), []);
    spawnSync(process.execPath, [loaderPath, 'stop'], { cwd: sub, env: { ...process.env, HOME: untrusted, CLAUDE_PROJECT_DIR: sub }, input: '', encoding: 'utf8' });
    assert.equal(fs.existsSync(marker), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('ancestor loader ignores an opted-in .wolf that is not on the allowlist', () => {
  const { base, mk } = tree();
  try {
    mk('work', { openwolf: { behavior: { mode: 'quiet', cover_subfolders: true } } });
    fs.mkdirSync(path.join(base, 'work', 'zoom'), { recursive: true });
    const sub = path.join(base, 'work', 'zoom');
    assert.equal(findCoveringAncestor(sub, new Set()), null);
    assert.equal(findCoveringAncestor(sub, loadTrustedRoots(trustHome(base, [path.join(base, 'elsewhere')]))), null);
    assert.equal(findCoveringAncestor(sub, loadTrustedRoots(trustHome(base, [path.join(base, 'work')]))), path.join(base, 'work'));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('allowlist loader drops relative entries and survives bad JSON', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-allow-'));
  try {
    fs.mkdirSync(path.join(base, 'real'));
    const home = trustHome(base, ['relative/path', 42, path.join(base, 'real'), path.join(base, 'missing')]);
    assert.deepEqual([...loadTrustedRoots(home)], [fs.realpathSync(path.join(base, 'real'))]);
    fs.writeFileSync(path.join(home, '.openwolf', 'ancestor-roots.json'), '{bad');
    assert.equal(loadTrustedRoots(home).size, 0);
    assert.equal(loadTrustedRoots(path.join(base, 'nohome')).size, 0);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
