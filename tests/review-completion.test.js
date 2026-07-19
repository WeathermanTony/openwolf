import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.join(repoRoot, 'src/hooks/complete-review.js');
const stopHook = path.join(repoRoot, 'src/hooks/stop.js');
const stopHookSource = path.join(repoRoot, 'src/hooks/stop.ts');

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-review-complete-'));
  await mkdir(path.join(dir, '.wolf'), { recursive: true });
  return dir;
}

async function writeReviewLog(dir, reviews) {
  await writeFile(path.join(dir, '.wolf', 'reviewlog.json'), JSON.stringify({ version: 1, reviews }, null, 2));
}

async function readReviewLog(dir) {
  return JSON.parse(await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8'));
}

function runHelper(dir, id = 'review-0001', extra = [], reviewer = 'test') {
  return spawnSync(process.execPath, [helper, id, '--reviewer', reviewer, '--summary', 'ok', ...extra], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function assistantTranscript(text) {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  }) + '\n';
}

function runStopHook(dir, transcriptPath, sessionId = 'sess-test') {
  return spawnSync(process.execPath, [stopHook], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath }),
    encoding: 'utf8',
  });
}

async function assertStopSourceAndRuntimeContract() {
  const [source, runtime] = await Promise.all([
    readFile(stopHookSource, 'utf8'),
    readFile(stopHook, 'utf8'),
  ]);
  for (const text of [source, runtime]) {
    assert.match(text, /hookSpecificOutput/);
    assert.match(text, /additionalContext/);
    assert.match(text, /out\.decision\s*=\s*"block"/);
    assert.match(text, /out\.reason\s*=\s*"Wolfpack feedback"/);
    assert.doesNotMatch(text, /out\.reason\s*=\s*additionalContext/);
    assert.doesNotMatch(text, /process\.stderr\.write\(/);
    assert.doesNotMatch(text, /exit 2|exits 2|non-zero exit code|stderr nudges|to stderr|stderr reminder|stderr nudge/);
    assert.match(text, /buglog_warnings:\s*0/);
    assert.match(text, /autonomy_continuation_warnings:\s*0/);
  }
}

function redactSecretsForTest(cmd) {
  if (!cmd) return cmd;
  let out = cmd;
  out = out.replace(/\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASS(?:WORD)?|AUTH|CRED(?:ENTIALS?)?|API_?KEY|URL|URI|DSN|CONN(?:ECTION)?(?:_STR(?:ING)?))[A-Z0-9_]*)=([^\s;&|]+)([\s;&|]|$)/gi, '$1=***REDACTED***$3');
  out = out.replace(/\b([A-Z][A-Z0-9_]*)=(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})([\s;&|]|$)/gi, '$1=***REDACTED***$3');
  return out;
}

test('stop hook redacts secrets without dropping shell separators', () => {
  assert.equal(redactSecretsForTest('OPENAI_API_KEY=secret; codex --version'), 'OPENAI_API_KEY=***REDACTED***; codex --version');
  assert.equal(redactSecretsForTest('TOKEN=abc& next'), 'TOKEN=***REDACTED***& next');
  assert.equal(redactSecretsForTest('AUTH=abc|wc'), 'AUTH=***REDACTED***|wc');
  assert.equal(redactSecretsForTest('SECRET=abc end'), 'SECRET=***REDACTED*** end');
  assert.equal(redactSecretsForTest('PASSWORD=abc'), 'PASSWORD=***REDACTED***');
  assert.equal(redactSecretsForTest('NOTEBOOK=abc'), 'NOTEBOOK=abc');
});

test('complete-review completes pending review when stored hashes match current bytes', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'const answer = 42;\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: sha256('const answer = 42;\n') }, nudge_history: { abc: 2 } }]);

    const result = runHelper(dir);
    assert.equal(result.status, 0, result.stderr);

    const log = await readReviewLog(dir);
    const review = log.reviews[0];
    assert.equal(review.status, 'completed');
    assert.equal(review.reviewer, 'test');
    assert.equal(review.review_summary, 'ok');
    assert.equal(review.nudge_history.abc, 2);
    assert.equal(review.content_hashes[file], sha256('const answer = 42;\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});



test('complete-review records reviewed-hash provenance when manifest hash matches', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    const bytes = 'const reviewed = true;\n';
    await writeFile(file, bytes);
    const fileHash = sha256(bytes);
    const manifestHash = sha256(JSON.stringify([[file, fileHash]]));
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: fileHash } }]);

    const result = runHelper(dir, 'review-0001', ['--reviewed-hash', manifestHash], 'hash-reviewer');
    assert.equal(result.status, 0, result.stderr);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'completed');
    assert.equal(review.reviewer, 'hash-reviewer');
    assert.equal(review.receipt.kind, 'reviewed-byte');
    assert.equal(review.receipt.reviewed_hash, manifestHash);
    assert.equal(review.reviewed_hash, manifestHash);
    assert.equal(review.reviewed_hashes[file], fileHash);
    assert.equal(review.review_provenance.kind, 'reviewer-saw-current-bytes');
    assert.equal(review.review_provenance.hashes[file], fileHash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refuses mismatched reviewed-hash and leaves review pending', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    const bytes = 'const reviewed = false;\n';
    await writeFile(file, bytes);
    const fileHash = sha256(bytes);
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: fileHash } }]);

    const result = runHelper(dir, 'review-0001', ['--reviewed-hash', '0'.repeat(64)], 'hash-reviewer');
    assert.equal(result.status, 7);
    assert.match(result.stderr, /REVIEW_HASH_MISMATCH/);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.reviewed_hash, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review accepts arbitrary extensible reviewer labels', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'const provider = "external-ai";\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: sha256('const provider = "external-ai";\n') } }]);

    const result = runHelper(dir, 'review-0001', [], 'external-ai');
    assert.equal(result.status, 0, result.stderr);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'completed');
    assert.equal(review.reviewer, 'external-ai');
    assert.equal(review.review_summary, 'ok');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refuses completion without stored content hashes but allows refresh', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'bytes\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file] }]);

    const result = runHelper(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--refresh/);

    let review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.content_hashes, undefined);

    const refreshed = runHelper(dir, 'review-0001', ['--refresh']);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.content_hashes[file], sha256('bytes\n'));
    assert.equal(review.receipt.hashes[file], sha256('bytes\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refuses stale pending hashes with refresh instructions', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'new bytes\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: sha256('old bytes\n') } }]);

    const result = runHelper(dir);
    assert.equal(result.status, 4);
    assert.match(result.stderr, /REVIEW_STALE/);
    assert.match(result.stderr, /--refresh/);
    assert.match(result.stderr, /review --file <current-path>/);
    assert.match(result.stderr, /--reviewed-current/);
    assert.match(result.stderr, /receipt hashes are not compatible/);
    assert.match(result.stderr, /stored=/);
    assert.match(result.stderr, /current=/);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.content_hashes[file], sha256('old bytes\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refresh updates current-byte receipt without completing', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'new bytes\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: sha256('old bytes\n') } }]);

    const refreshed = runHelper(dir, 'review-0001', ['--refresh']);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.match(refreshed.stdout, /OpenWolf refreshed review-0001/);
    assert.match(refreshed.stdout, /review --file <current-path>/);
    assert.match(refreshed.stdout, /--reviewed-current/);
    assert.match(refreshed.stdout, /receipt hash.*not compatible/i);

    let review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.content_hashes[file], sha256('new bytes\n'));
    assert.equal(review.receipt.kind, 'current-byte');
    assert.equal(review.receipt.hashes[file], sha256('new bytes\n'));

    const unsafe = runHelper(dir, 'review-0001', [], 'test');
    assert.equal(unsafe.status, 4);
    assert.match(unsafe.stderr, /REVIEW_STALE/);
    assert.match(unsafe.stderr, /--reviewed-current/);

    const incompatibleReceiptHash = sha256('companion-receipt-representation');
    const incompatible = runHelper(dir, 'review-0001', ['--reviewed-hash', incompatibleReceiptHash], 'test');
    assert.equal(incompatible.status, 7);
    assert.match(incompatible.stderr, /REVIEW_HASH_MISMATCH/);

    const completed = runHelper(dir, 'review-0001', ['--reviewed-current'], 'test');
    assert.equal(completed.status, 0, completed.stderr);
    review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'completed');
    assert.equal(review.requires_rereview, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refresh records deleted files as tombstones', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'deleted.js');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: sha256('old bytes\n') } }]);

    const refreshed = runHelper(dir, 'review-0001', ['--refresh']);
    assert.equal(refreshed.status, 0, refreshed.stderr);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.content_hashes[file], 'tombstone');
    assert.equal(review.receipt.hashes[file], 'tombstone');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refuses to create missing review entries', async () => {
  const dir = await fixture();
  try {
    await writeReviewLog(dir, []);

    const result = runHelper(dir, 'review-9999');
    assert.notEqual(result.status, 0);

    const log = await readReviewLog(dir);
    assert.equal(log.reviews.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refuses already completed reviews by default', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'bytes\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'completed', files: [file], content_hashes: { [file]: sha256('bytes\n') } }]);

    const result = runHelper(dir);
    assert.notEqual(result.status, 0);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.completed_at, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review allows deleted files as stable tombstones', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'deleted.js');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: 'tombstone' } }]);

    const result = runHelper(dir);
    assert.equal(result.status, 0, result.stderr);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'completed');
    assert.equal(review.content_hashes[file], 'tombstone');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review refuses unreadable non-regular files and leaves review pending', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'directory-target');
    await mkdir(file);
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: 'unreadable' } }]);

    const result = runHelper(dir);
    assert.notEqual(result.status, 0);

    const refresh = runHelper(dir, 'review-0001', ['--refresh']);
    assert.equal(refresh.status, 5);

    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.content_hashes[file], 'unreadable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stop hook nudges autonomy continuation on obvious next-step language', async () => {
  await assertStopSourceAndRuntimeContract();
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const transcript = path.join(dir, 'transcript.jsonl');
    const sessionFile = path.join(dir, '.wolf', 'hooks', '_session.json');
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({
      openwolf: {
        review_hook: { enabled: false },
        quality_gate: { enabled: false },
        claim_calibration: { enabled: false },
        autonomy_continuation: { enabled: true, max_fires_per_session: 1 },
      },
    }, null, 2));
    await writeFile(sessionFile, JSON.stringify({
      session_id: 'sess-autonomy',
      started: '2099-06-13T18:00:00.000Z',
      files_read: {},
      files_written: [],
      edit_counts: {},
      anatomy_hits: 0,
      anatomy_misses: 0,
      repeated_reads_warned: 0,
      cerebrum_warnings: 0,
      buglog_warnings: 0,
      stop_count: 0,
    }, null, 2));
    await writeFile(transcript, assistantTranscript('The next action is to run the focused test now. I can continue with that without a user decision.'));

    const first = runStopHook(dir, transcript, 'sess-autonomy');
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stderr, '');
    const firstPayload = JSON.parse(first.stdout);
    assert.equal(firstPayload.decision, 'block');
    assert.equal(firstPayload.reason, 'Wolfpack feedback');
    assert.doesNotMatch(firstPayload.reason, /Wolfpack autonomy:/);
    assert.match(firstPayload.hookSpecificOutput.additionalContext, /Wolfpack autonomy:/);

    const second = runStopHook(dir, transcript, 'sess-autonomy');
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /Wolfpack autonomy:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function stopHookReviewFixture(files) {
  const dir = await mkdtemp(path.join(homedir(), 'ow-review-scope-'));
  await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
  for (const file of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'x\n');
  }
  await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: {
    review_hook: { enabled: true, min_diff_lines: 1, max_review_rounds: 3 },
    quality_gate: { enabled: false },
    claim_calibration: { enabled: false },
    autonomy_continuation: { enabled: false },
    git_discipline: { enabled: false },
    simplicity: { enabled: false },
  } }, null, 2));
  await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
    session_id: 'sess-review-scope',
    started: '2099-06-13T17:00:00.000Z',
    files_read: {},
    files_written: files.map(file => ({ file, at: '2099-06-13T17:00:00.000Z', tokens: 200, action: 'edit' })),
    edit_counts: Object.fromEntries(files.map(file => [file, 1])),
    anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
    cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
  }, null, 2));
  const transcript = path.join(dir, 'transcript.jsonl');
  await writeFile(transcript, assistantTranscript('Done.'));
  return { dir, transcript };
}

test('stop hook review nudge excludes Windows scratchpad and Temp paths', async () => {
  // Fixture must live outside /tmp — **/tmp/** would otherwise exclude every
  // path vacuously and prove nothing about the Windows patterns.
  const base = await mkdtemp(path.join(homedir(), 'ow-review-scope-'));
  const scratchFiles = [
    path.join(base, 'AppData', 'Local', 'Temp', 'claude', 'sess', 'scratchpad', 'note.txt'),
    path.join(base, 'work', 'scratchpad', 'draft.txt'),
  ];
  const { dir, transcript } = await stopHookReviewFixture(scratchFiles);
  try {
    const result = runStopHook(dir, transcript, 'sess-review-scope');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Wolfpack review/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('stop hook review nudge still fires for production files outside scratch paths', async () => {
  const base = await mkdtemp(path.join(homedir(), 'ow-review-scope-'));
  const { dir, transcript } = await stopHookReviewFixture([path.join(base, 'src', 'engine.py')]);
  try {
    const result = runStopHook(dir, transcript, 'sess-review-scope');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wolfpack review/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('stop hook nudges git-init when project is not a git repository', async () => {
  await assertStopSourceAndRuntimeContract();
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const target = path.join(dir, 'README.md');
    await writeFile(target, '# Research notes\n');
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: {
      review_hook: { enabled: false },
      quality_gate: { enabled: false },
      claim_calibration: { enabled: false },
      autonomy_continuation: { enabled: false },
      git_discipline: { enabled: true, max_fires_per_session: 3, min_written_files: 1, min_changed_lines: 1 },
    } }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
      session_id: 'sess-git-init',
      started: '2099-06-13T17:00:00.000Z',
      files_read: {},
      files_written: [{ file: target, at: '2099-06-13T17:00:00.000Z', tokens: 200, action: 'edit' }],
      edit_counts: { [target]: 1 },
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2));
    const transcript = path.join(dir, 'transcript.jsonl');
    await writeFile(transcript, assistantTranscript('Done.'));

    const result = runStopHook(dir, transcript, 'sess-git-init');
    assert.equal(result.status, 0, result.stderr);
    const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /initialize a git repo to track revisions/);
    assert.match(text, /not-a-git-repo/);
    assert.match(text, /run `git init`/);
    assert.match(text, /Git is useful for tracking revisions in documents, research, and code/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stop hook omits git-init nudge when project is already a git repository', async () => {
  await assertStopSourceAndRuntimeContract();
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    await mkdir(path.join(dir, 'src'), { recursive: true });
    const target = path.join(dir, 'src', 'feature.js');
    await writeFile(target, 'export const secured = true;\n');
    // Initialize a real git repo
    spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: {
      review_hook: { enabled: false },
      quality_gate: { enabled: false },
      claim_calibration: { enabled: false },
      autonomy_continuation: { enabled: false },
      git_discipline: { enabled: true, max_fires_per_session: 3, min_written_files: 1, min_changed_lines: 1, scope_excludes: [] },
    } }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
      session_id: 'sess-git-exists',
      started: '2099-06-13T17:00:00.000Z',
      files_read: {},
      files_written: [{ file: target, at: '2099-06-13T17:00:00.000Z', tokens: 200, action: 'edit' }],
      edit_counts: { [target]: 1 },
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2));
    const transcript = path.join(dir, 'transcript.jsonl');
    await writeFile(transcript, assistantTranscript('Done.'));

    const result = runStopHook(dir, transcript, 'sess-git-exists');
    assert.equal(result.status, 0, result.stderr);
    const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.doesNotMatch(text, /initialize a git repo to track revisions/);
    assert.doesNotMatch(text, /not-a-git-repo/);
    assert.doesNotMatch(text, /run `git init`/);
    assert.match(text, /git status\/diff summary/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stop hook emits bounded companion guidance for every verbosity and reviewer profile', async () => {
  await assertStopSourceAndRuntimeContract();
  const cases = [
    ['compact', 'us-only', /Critical flaws only/, /gov\/US-only/],
    ['standard', 'open', /evidence and a falsifier/, /Profile: open/],
    ['verbose', 'budget', /companion owns staging/, /Profile: budget/],
  ];
  for (const [verbosity, profile, contractPattern, profilePattern] of cases) {
    const dir = await fixture();
    try {
      await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
      const target = path.join(dir, 'auth', 'feature.js');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'export const secured = true;\n');
      await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({
        openwolf: {
          review_hook: {
            enabled: true,
            min_diff_lines: 1,
            scope_excludes: [],
            codex_command: 'codex exec --full-auto --secret should-never-appear',
            nudge_only: true,
          },
          hook_messages: { verbosity, reviewer_profile: profile, max_files: 3 },
          quality_gate: { enabled: false },
          claim_calibration: { enabled: false },
          autonomy_continuation: { enabled: false },
          git_discipline: { enabled: false },
        },
      }, null, 2));
      await writeFile(path.join(dir, '.wolf', 'reviewlog.json'), JSON.stringify({ version: 1, reviews: [] }, null, 2));
      await writeFile(path.join(dir, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [] }, null, 2));
      await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
        session_id: `sess-${verbosity}-${profile}`,
        started: '2099-06-13T17:00:00.000Z',
        files_read: {},
        files_written: [{ file: target, at: '2099-06-13T17:00:00.000Z', tokens: 200, action: 'edit' }],
        edit_counts: { [target]: 1 },
        anatomy_hits: 0,
        anatomy_misses: 0,
        repeated_reads_warned: 0,
        cerebrum_warnings: 0,
        buglog_warnings: 0,
        stop_count: 0,
      }, null, 2));
      const transcript = path.join(dir, 'transcript.jsonl');
      await writeFile(transcript, assistantTranscript('Implemented the requested review change.'));

      const result = runStopHook(dir, transcript, `sess-${verbosity}-${profile}`);
      assert.equal(result.status, 0, result.stderr);
      const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      assert.match(text, /provider companion review --file/);
      assert.match(text, /--file '\/.*auth\/feature\.js'/);
      assert.match(text, /\[--diff <patch>\]/);
      assert.match(text, contractPattern);
      assert.match(text, profilePattern);
      assert.doesNotMatch(text, /codex exec|should-never-appear/i);
      assert.doesNotMatch(text, /git clone|scan the repository/i);
      if (verbosity === 'verbose') assert.match(text, /Do not run direct Codex commands, discover the broad repo, or manually mkdir\/cp\/rm/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('stop hook shell-quotes companion file arguments', async () => {
  await assertStopSourceAndRuntimeContract();
  const fixtureRoot = await fixture();
  const dir = path.join(fixtureRoot, "project $(touch helper-pwn) 'quoted'");
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const target = path.join(dir, "auth", "$(touch ow-review-pwn)'s.js");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'export const safe = true;\n');
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: {
      review_hook: { enabled: true, min_diff_lines: 1, scope_excludes: [], nudge_only: true },
      hook_messages: { verbosity: 'compact', reviewer_profile: 'us-only' },
      quality_gate: { enabled: false }, claim_calibration: { enabled: false },
      autonomy_continuation: { enabled: false }, git_discipline: { enabled: false },
    } }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'reviewlog.json'), JSON.stringify({ version: 1, reviews: [] }));
    await writeFile(path.join(dir, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [] }));
    await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
      session_id: 'sess-shell-quote', started: '2099-06-13T17:00:00.000Z', files_read: {},
      files_written: [{ file: target, at: '2099-06-13T17:00:00.000Z', tokens: 200, action: 'edit' }],
      edit_counts: { [target]: 1 }, anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2));
    const transcript = path.join(dir, 'transcript.jsonl');
    await writeFile(transcript, assistantTranscript('Implemented a safe review change.'));
    const result = runStopHook(dir, transcript, 'sess-shell-quote');
    assert.equal(result.status, 0, result.stderr);
    const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /--file '\/.*\$\(touch ow-review-pwn\)'"'"'s\.js'/);
    assert.match(text, /node '\/.*project \$\(touch helper-pwn\) '"'"'quoted'"'"'\/\.wolf\/hooks\/complete-review\.js'/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('stop hook suppresses repeated buglog nudges after explicit false-positive acknowledgement', async () => {
  await assertStopSourceAndRuntimeContract();
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const target = path.join(dir, 'feature.js');
    const transcript = path.join(dir, 'transcript.jsonl');
    const sessionFile = path.join(dir, '.wolf', 'hooks', '_session.json');
    const editAt = '2099-06-13T17:00:00.000Z';
    await writeFile(target, 'export const feature = true;\n');
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: { quality_gate: { buglog_scan_excludes: [] } } }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [] }, null, 2));
    await utimes(path.join(dir, '.wolf', 'buglog.json'), new Date('2099-06-13T16:00:00.000Z'), new Date('2099-06-13T16:00:00.000Z'));
    await writeFile(sessionFile, JSON.stringify({
      session_id: 'sess-buglog',
      started: editAt,
      files_read: {},
      files_written: [{ file: target, at: editAt }],
      edit_counts: { [target]: 3 },
      anatomy_hits: 0,
      anatomy_misses: 0,
      repeated_reads_warned: 0,
      cerebrum_warnings: 0,
      buglog_warnings: 0,
      stop_count: 0,
    }, null, 2));
    await writeFile(transcript, assistantTranscript('I changed a feature.'));

    const first = runStopHook(dir, transcript, 'sess-buglog');
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stderr, '');
    const firstPayload = JSON.parse(first.stdout);
    assert.equal(firstPayload.decision, 'block');
    assert.equal(firstPayload.reason, 'Wolfpack feedback');
    assert.doesNotMatch(firstPayload.reason, /Files edited 3\+ times/);
    assert.match(firstPayload.hookSpecificOutput.additionalContext, /Files edited 3\+ times/);

    await writeFile(transcript, assistantTranscript('Buglog nudge is a false positive: these edits were not bug fixes, so no buglog entry warranted.'));
    const acknowledged = runStopHook(dir, transcript, 'sess-buglog');
    assert.equal(acknowledged.status, 0, acknowledged.stderr);
    assert.doesNotMatch(acknowledged.stdout, /Files edited 3\+ times/);

    const stored = JSON.parse(await readFile(sessionFile, 'utf8'));
    assert.equal(Object.keys(stored.buglog_false_positive_acks).length, 1);

    stored.files_written.push({ file: target, at: '2099-06-13T17:05:00.000Z' });
    stored.edit_counts[target] = 4;
    await writeFile(sessionFile, JSON.stringify(stored, null, 2));
    await writeFile(transcript, assistantTranscript('I changed another feature.'));

    const changed = runStopHook(dir, transcript, 'sess-buglog');
    assert.equal(changed.status, 0, changed.stderr);
    const changedPayload = JSON.parse(changed.stdout);
    assert.equal(changedPayload.decision, 'block');
    assert.match(changedPayload.hookSpecificOutput.additionalContext, /Files edited 3\+ times/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
