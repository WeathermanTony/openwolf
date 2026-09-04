import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanupFixture, createHomeFixture } from './lib/fixture-cleanup.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.join(repoRoot, 'src/hooks/complete-review.js');
const stopHook = path.join(repoRoot, 'src/hooks/stop.js');
const stopHookSource = path.join(repoRoot, 'src/hooks/stop.ts');
const postWriteHook = path.join(repoRoot, 'src/hooks/post-write.js');
const postWriteHookSource = path.join(repoRoot, 'src/hooks/post-write.ts');

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

function runPostWriteHook(dir, toolInput) {
  return spawnSync(process.execPath, [postWriteHook], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ tool_name: 'Edit', tool_input: toolInput }),
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

function runCheck(dir, id = 'review-0001') {
  // --check must work WITHOUT --reviewer/--summary (read-only dry run).
  return spawnSync(process.execPath, [helper, id, '--check'], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
}

test('complete-review --check reports CURRENT and mutates nothing when hashes match', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'const answer = 42;\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: sha256('const answer = 42;\n') } }]);

    const before = await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8');
    const result = runCheck(dir);
    assert.equal(result.status, 0, `stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stdout, /CURRENT/);
    assert.doesNotMatch(result.stdout, /STALE/);
    const after = await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8');
    assert.equal(after, before, '--check must not mutate the review log');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('complete-review --check reports STALE with exit 4 when bytes drifted', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'const answer = 42;\n');
    await writeReviewLog(dir, [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: sha256('const answer = 42;\n') } }]);
    // Drift the file after the pending review was recorded.
    await writeFile(file, 'const answer = 43;\n');

    const result = runCheck(dir);
    assert.equal(result.status, 4, `stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stdout, /STALE/);
    const review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending', '--check must leave the review pending');
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

test('complete-review refuses ambiguous duplicate review ids', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'bytes\n');
    const entry = { id: 'review-0008', status: 'pending', files: [file], content_hashes: { [file]: sha256('bytes\n') } };
    await writeReviewLog(dir, [entry, { ...entry }]);
    const before = await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8');

    const result = runHelper(dir, 'review-0008', ['--reviewed-current']);
    assert.equal(result.status, 6);
    assert.match(result.stderr, /matches 2 records; refusing ambiguous mutation/);
    assert.equal(await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8'), before);
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

test('post-write hook writes precise open records and rejects unsupported diff guesses', async () => {
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const target = path.join(dir, 'src', 'account.js');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(path.join(dir, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [] }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
      files_written: [], edit_counts: {}, stop_count: 0,
    }, null, 2));

    const nullSafety = runPostWriteHook(dir, {
      file_path: target,
      old_string: 'export const name = user.name;\n',
      new_string: 'export const name = user?.name;\n',
    });
    assert.equal(nullSafety.status, 0, nullSafety.stderr);
    let log = JSON.parse(await readFile(path.join(dir, '.wolf', 'buglog.json'), 'utf8'));
    assert.equal(log.bugs.length, 1);
    assert.equal(log.bugs[0].error_message, 'Null/undefined access in account.js');
    assert.equal(log.bugs[0].status, 'open');

    for (const edit of [
      { old_string: 'export const color = "blue";\n', new_string: 'export const color = "green";\n' },
      { old_string: 'export const ok = a && b;\n', new_string: 'export const ok = a || b;\n' },
      {
        old_string: 'const one = first();\nconst two = second();\nconst three = third();\n',
        new_string: 'const values = [first(), second(), third()];\nreturn values;\nlog(values);\n',
      },
    ]) {
      const result = runPostWriteHook(dir, { file_path: target, ...edit });
      assert.equal(result.status, 0, result.stderr);
    }
    log = JSON.parse(await readFile(path.join(dir, '.wolf', 'buglog.json'), 'utf8'));
    assert.equal(log.bugs.length, 1, 'string/token changes and refactor-shaped edits are not defect evidence');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('post-write hook ignores unsafe bug suffixes when allocating an auto-detected entry', async () => {
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const target = path.join(dir, 'src', 'feature.js');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'export const value = guarded();\n');
    await writeFile(path.join(dir, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [
      { id: 'bug-0002', file: 'a.js', tags: [], last_seen: '2026-01-01T00:00:00.000Z', fix: '', occurrences: 1 },
      { id: 'bug-0010', file: 'b.js', tags: [], last_seen: '2026-01-01T00:00:00.000Z', fix: '', occurrences: 1 },
      { id: 'bug-invalid', file: 'c.js', tags: [], last_seen: '2026-01-01T00:00:00.000Z', fix: '', occurrences: 1 },
      { id: 'bug-9007199254740992', file: 'd.js', tags: [], last_seen: '2026-01-01T00:00:00.000Z', fix: '', occurrences: 1 },
    ] }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
      files_written: [], edit_counts: {}, stop_count: 0,
    }, null, 2));

    const result = runPostWriteHook(dir, {
      file_path: target,
      old_string: 'export const value = guarded();\n',
      new_string: 'export const value = guarded();\ntry { guarded(); } catch (error) { recover(error); }\n',
    });
    assert.equal(result.status, 0, result.stderr);
    const log = JSON.parse(await readFile(path.join(dir, '.wolf', 'buglog.json'), 'utf8'));
    assert.equal(log.bugs.at(-1).id, 'bug-011', 'unsafe suffixes must not affect max-suffix allocation');
    assert.equal(log.bugs.at(-1).status, 'open', 'auto-detected records begin unverified/open');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function stopHookReviewFixture(dir, files) {
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

test('stop hook simplicity nudge names the most-edited file when it is notable', async () => {
  // Simplicity enabled (default 2500-token threshold), all actionable gates
  // disabled so advisory suppression doesn't apply. files_written sums to
  // 2700 tokens; one file has 6 edits → the lens hint must name it.
  //
  // The per-Stop output budget (max_per_stop: 1) now ranks nudges, and the
  // buglog nudge outranks the advisory simplicity one — hot.py has 6 edits, so
  // the "edited 3+ times without a buglog entry" rule also qualifies and would
  // win the single slot. Seed a buglog entry below so simplicity is the only
  // eligible nudge and this test still measures what it was written to
  // measure: the most-edited-file lens.
  const base = createHomeFixture('ow-simplicity-lens-');
  try {
    const dir = base;
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const hot = path.join(base, 'src', 'hot.py');
    const others = [path.join(base, 'src', 'a.py'), path.join(base, 'src', 'b.py')];
    for (const f of [hot, ...others]) {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, 'x\n');
    }
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: {
      review_hook: { enabled: false },
      quality_gate: { enabled: false },
      claim_calibration: { enabled: false },
      autonomy_continuation: { enabled: false },
      git_discipline: { enabled: false },
      simplicity: { enabled: true },
    } }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
      session_id: 'sess-simplicity-lens',
      started: '2099-06-13T17:00:00.000Z',
      files_read: {},
      files_written: [hot, ...others].map(file => ({ file, at: '2099-06-13T17:00:00.000Z', tokens: 900, action: 'edit' })),
      edit_counts: { [hot]: 6, [others[0]]: 1, [others[1]]: 1 },
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2));
    // Satisfy the buglog rule so it does not compete for the single output slot.
    // The rule suppresses when buglog.json's MTIME is newer than the latest
    // edit to a multi-edit file; this fixture uses year-2099 edit timestamps,
    // so the mtime must be pushed past them explicitly (a real-time mtime is
    // "older" than 2099 and would leave the nudge firing).
    const buglogFixture = path.join(dir, '.wolf', 'buglog.json');
    await writeFile(buglogFixture, JSON.stringify({
      version: 1,
      bugs: [{
        id: 'bug-001', timestamp: '2099-06-13T17:00:00.000Z',
        error_message: 'seeded so the buglog nudge is satisfied',
        file: hot, root_cause: 'test fixture', fix: 'n/a', status: 'resolved',
        tags: ['fixture'], related_bugs: [], occurrences: 1,
        last_seen: '2099-06-13T17:00:00.000Z', commit: null, reduction: null,
      }],
    }, null, 2));
    const past2099 = new Date('2099-06-13T18:00:00.000Z');
    await utimes(buglogFixture, past2099, past2099);
    const transcript = path.join(dir, 'transcript.jsonl');
    await writeFile(transcript, assistantTranscript('Done.'));

    const result = runStopHook(dir, transcript, 'sess-simplicity-lens');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wolfpack simplicity/);
    assert.match(result.stdout, /Most-edited: .*hot\.py \(6 edits/);
  } finally {
    cleanupFixture(base);
  }
});

test('stop hook simplicity nudge omits the lens hint when edit counts are low', async () => {
  const base = createHomeFixture('ow-simplicity-lens-');
  try {
    const dir = base;
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const files = [path.join(base, 'src', 'a.py'), path.join(base, 'src', 'b.py'), path.join(base, 'src', 'c.py')];
    for (const f of files) {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, 'x\n');
    }
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: {
      review_hook: { enabled: false },
      quality_gate: { enabled: false },
      claim_calibration: { enabled: false },
      autonomy_continuation: { enabled: false },
      git_discipline: { enabled: false },
      simplicity: { enabled: true },
    } }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
      session_id: 'sess-simplicity-plain',
      started: '2099-06-13T17:00:00.000Z',
      files_read: {},
      files_written: files.map(file => ({ file, at: '2099-06-13T17:00:00.000Z', tokens: 900, action: 'edit' })),
      edit_counts: Object.fromEntries(files.map(file => [file, 1])),
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2));
    const transcript = path.join(dir, 'transcript.jsonl');
    await writeFile(transcript, assistantTranscript('Done.'));

    const result = runStopHook(dir, transcript, 'sess-simplicity-plain');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wolfpack simplicity/);
    assert.doesNotMatch(result.stdout, /Most-edited:/);
  } finally {
    cleanupFixture(base);
  }
});

async function reviewBaselineFixture({ sessionTokens, coveredTokens, coveredBasis }) {
  // Fixture for bug-441: a completed review from THIS session already covers
  // coveredTokens of output; only (sessionTokens - coveredTokens) is new work.
  const base = createHomeFixture('ow-review-baseline-');
  const dir = base;
  await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
  const target = path.join(base, 'src', 'feature.ts');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'export const x = 1;\n');
  await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: {
    review_hook: { enabled: true, min_diff_lines: 40, nudge_only: true },
    quality_gate: { enabled: false },
    claim_calibration: { enabled: false },
    autonomy_continuation: { enabled: false },
    git_discipline: { enabled: false },
    simplicity: { enabled: false },
  } }, null, 2));
  await writeFile(path.join(dir, '.wolf', 'reviewlog.json'), JSON.stringify({ version: 1, reviews: [{
    id: 'review-0001',
    session_id: 'sess-baseline',
    status: 'completed',
    files: [target],
    covered_tokens: coveredTokens,
    // Omitted when coveredBasis is undefined, reproducing a pre-bug-498 entry.
    ...(coveredBasis ? { covered_tokens_basis: coveredBasis } : {}),
    content_hashes: {},
  }] }, null, 2));
  await writeFile(path.join(dir, '.wolf', 'hooks', '_session.json'), JSON.stringify({
    session_id: 'sess-baseline',
    started: '2099-06-13T17:00:00.000Z',
    files_read: {},
    files_written: [{ file: target, at: '2099-06-13T17:00:00.000Z', tokens: sessionTokens, action: 'edit' }],
    edit_counts: { [target]: 1 },
    anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
    cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
  }, null, 2));
  const transcript = path.join(dir, 'transcript.jsonl');
  await writeFile(transcript, assistantTranscript('Done.'));
  return { dir, transcript, target };
}

test('stop hook review trigger measures new work since last review, not session-cumulative output', async () => {
  // 1040 cumulative tokens with 1000 already covered → ~2 new lines < 40:
  // the 1-line-comment-edit case from the Grok feedback must NOT spawn a review.
  // The baseline carries the scoped marker, so it is in the same units as this
  // session's scoped attribution and is subtracted.
  const { dir, transcript } = await reviewBaselineFixture({
    sessionTokens: 1040, coveredTokens: 1000, coveredBasis: 'scoped-writes',
  });
  try {
    const result = runStopHook(dir, transcript, 'sess-baseline');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Wolfpack review/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stop hook review nudge fires on new-work delta and records covered_tokens', async () => {
  // 2000 cumulative with 1000 covered → 1000 new tokens ≈ 59 lines ≥ 40 → fires.
  const { dir, transcript } = await reviewBaselineFixture({
    sessionTokens: 2000, coveredTokens: 1000, coveredBasis: 'scoped-writes',
  });
  try {
    const result = runStopHook(dir, transcript, 'sess-baseline');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wolfpack review/);
    assert.match(result.stdout, /~59 new lines since last review/);
    const log = JSON.parse(await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8'));
    const pending = log.reviews.find(r => r.status === 'pending');
    assert.ok(pending, 'a new pending review should exist');
    assert.equal(pending.covered_tokens, 2000, 'pending covers all session output so far');
    assert.equal(pending.covered_tokens_basis, 'scoped-writes',
      'the stored value is a scoped sum and must be labeled as one');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// An UNMARKED baseline predates scoped attribution and holds session-TOTAL
// tokens, which include scope-excluded writes and are therefore >= the scoped
// sum. Subtracting one from the other can clamp to 0 and permanently disable
// the size trigger -- a silent gate death. The hook cannot tell a "safe" legacy
// entry (no excluded writes, so the two bases coincide) from an unsafe one,
// because legacy entries do not record their basis. So it refuses the baseline
// and over-nudges visibly instead.
//
// This behavior existed since bug-498 but was UNREACHABLE while attribution was
// inert (the tokens/tokens_estimated field mismatch). Fixing that made it live.
test('stop hook refuses an unmarked legacy baseline rather than mixing token scales', async () => {
  const { dir, transcript } = await reviewBaselineFixture({ sessionTokens: 2000, coveredTokens: 1000 });
  try {
    const result = runStopHook(dir, transcript, 'sess-baseline');
    assert.equal(result.status, 0, result.stderr);
    // 2000 scoped tokens, legacy baseline refused → 118 lines, not 59.
    assert.match(result.stdout, /~118 new lines since last review/,
      'an unmarked baseline must be dropped, not subtracted across bases');
    const log = JSON.parse(await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8'));
    const pending = log.reviews.find(r => r.status === 'pending');
    assert.ok(pending, 'a new pending review should exist');
    assert.equal(pending.covered_tokens_basis, 'scoped-writes',
      'the new entry records its own basis so the next session need not guess');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stop hook ignores unsafe review suffixes when allocating a pending review', async () => {
  const { dir, transcript } = await reviewBaselineFixture({ sessionTokens: 2000, coveredTokens: 1000, coveredBasis: 'scoped-writes' });
  try {
    const reviewLogPath = path.join(dir, '.wolf', 'reviewlog.json');
    const seeded = await readReviewLog(dir);
    seeded.reviews.push(
      { id: 'review-0002', status: 'completed', files: [] },
      { id: 'review-0010', status: 'completed', files: [] },
      { id: 'review-invalid', status: 'completed', files: [] },
      { id: 'review-9007199254740992', status: 'completed', files: [] },
    );
    await writeFile(reviewLogPath, JSON.stringify(seeded, null, 2));

    const result = runStopHook(dir, transcript, 'sess-baseline');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wolfpack review/);
    const log = await readReviewLog(dir);
    assert.equal(log.reviews.at(-1).id, 'review-0011', 'unsafe suffixes must not affect max-suffix allocation');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stop hook review nudge excludes Windows scratchpad and Temp paths', async () => {
  // Fixture must live outside /tmp — **/tmp/** would otherwise exclude every
  // path vacuously and prove nothing about the Windows patterns.
  const base = createHomeFixture('ow-review-scope-');
  const scratchFiles = [
    path.join(base, 'AppData', 'Local', 'Temp', 'claude', 'sess', 'scratchpad', 'note.txt'),
    path.join(base, 'work', 'scratchpad', 'draft.txt'),
  ];
  const { dir, transcript } = await stopHookReviewFixture(base, scratchFiles);
  try {
    const result = runStopHook(dir, transcript, 'sess-review-scope');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Wolfpack review/);
  } finally {
    cleanupFixture(base);
  }
});

test('stop hook review nudge still fires for production files outside scratch paths', async () => {
  const base = createHomeFixture('ow-review-scope-');
  const { dir, transcript } = await stopHookReviewFixture(base, [path.join(base, 'src', 'engine.py')]);
  try {
    const result = runStopHook(dir, transcript, 'sess-review-scope');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wolfpack review/);
  } finally {
    cleanupFixture(base);
  }
});

test('stop hook review nudge still fires for a real checkout under a Windows-Temp-shaped path', async () => {
  // The Temp exclusion is scoped to the claude/ scratch root only; a project
  // living elsewhere under AppData/Local/Temp keeps its review obligations.
  const base = createHomeFixture('ow-review-scope-');
  const { dir, transcript } = await stopHookReviewFixture(base, [
    path.join(base, 'AppData', 'Local', 'Temp', 'project', 'src', 'auth', 'session.ts'),
  ]);
  try {
    const result = runStopHook(dir, transcript, 'sess-review-scope');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wolfpack review/);
  } finally {
    cleanupFixture(base);
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
    assert.match(text, /revision tracking helps beyond code/);
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

test('stop hook reports git-not-found instead of advising git init when git is unresolvable', async () => {
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
      session_id: 'sess-git-missing',
      started: '2099-06-13T17:00:00.000Z',
      files_read: {},
      files_written: [{ file: target, at: '2099-06-13T17:00:00.000Z', tokens: 200, action: 'edit' }],
      edit_counts: { [target]: 1 },
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2));
    const transcript = path.join(dir, 'transcript.jsonl');
    await writeFile(transcript, assistantTranscript('Done.'));

    // Strip PATH so bare "git" cannot resolve (the Windows stale-shell case):
    // the hook must NOT advise `git init` on a repo it simply cannot see.
    const result = spawnSync(process.execPath, [stopHook], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: '/nonexistent', WOLFPACK_GIT_BIN: '' },
      input: JSON.stringify({ session_id: 'sess-git-missing', transcript_path: transcript }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /git not found on hook PATH/);
    assert.match(text, /git-not-found/);
    assert.doesNotMatch(text, /initialize a git repo/);
    assert.doesNotMatch(text, /run `git init`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stop hook suppresses git-init nudge when a commit landed this session', async () => {
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
      session_id: 'sess-git-commit',
      started: '2099-06-13T17:00:00.000Z',
      files_read: {},
      files_written: [{ file: target, at: '2099-06-13T17:00:00.000Z', tokens: 200, action: 'edit' }],
      edit_counts: { [target]: 1 },
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2));
    const transcript = path.join(dir, 'transcript.jsonl');
    // Commit activity proves a repo exists even though this fixture is not one —
    // the init advice must be suppressed while the rest of the gate still works.
    await writeFile(transcript, JSON.stringify({
      type: 'assistant',
      message: { content: [
        { type: 'tool_use', name: 'Bash', input: { command: "git add README.md && git commit -m 'wip'" } },
        { type: 'text', text: 'Committed.' },
      ] },
    }) + '\n');

    const result = runStopHook(dir, transcript, 'sess-git-commit');
    assert.equal(result.status, 0, result.stderr);
    const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.doesNotMatch(text, /initialize a git repo/);
    assert.doesNotMatch(text, /run `git init`/);
    // Safety items must survive the init suppression (fixture lives under /tmp,
    // so the status-block materiality gate is vacuously off; the cached-diff
    // item is the transcript-based proof the gate still fired).
    assert.match(text, /inspect `git diff --cached`/);
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
      assert.match(text, /--file 'auth\/feature\.js'/);
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
    assert.match(text, /--file 'auth\/\$\(touch ow-review-pwn\)'"'"'s\.js'/);
    assert.match(text, /node '\.wolf\/hooks\/complete-review\.js'/);
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
    assert.doesNotMatch(firstPayload.reason, /files edited 3\+ times/);
    assert.match(firstPayload.hookSpecificOutput.additionalContext, /files edited 3\+ times/);

    await writeFile(transcript, assistantTranscript('Buglog nudge is a false positive: these edits were not bug fixes, so no buglog entry warranted.'));
    const acknowledged = runStopHook(dir, transcript, 'sess-buglog');
    assert.equal(acknowledged.status, 0, acknowledged.stderr);
    assert.doesNotMatch(acknowledged.stdout, /files edited 3\+ times/);

    const stored = JSON.parse(await readFile(sessionFile, 'utf8'));
    assert.equal(Object.keys(stored.buglog_false_positive_acks).length, 1);

    // bug-497: the ack signature is keyed on the FILE SET, not on the edit
    // count or timestamp. This assertion previously required the nudge to
    // RE-FIRE at 4 edits — encoding the defect: an acknowledgement expired on
    // the next edit, so the same file and the same non-bug minted a fresh
    // signature every turn and the per-session cap was the only bound.
    //
    // What the user asserts by acking is a claim about the file ("repeatedly
    // editing this isn't a bug fix"). That claim does not expire because they
    // edited it again.
    stored.files_written.push({ file: target, at: '2099-06-13T17:05:00.000Z' });
    stored.edit_counts[target] = 4;
    await writeFile(sessionFile, JSON.stringify(stored, null, 2));
    await writeFile(transcript, assistantTranscript('I changed another feature.'));

    const changed = runStopHook(dir, transcript, 'sess-buglog');
    assert.equal(changed.status, 0, changed.stderr);
    assert.doesNotMatch(changed.stdout, /files edited 3\+ times/, 'ack must survive a further edit to the same file');

    // Negative control: the ack is scoped to the acked file set, not a blanket
    // session mute. A genuinely NEW multi-edit file changes the signature and
    // must re-nudge — otherwise this fix would trade a false positive for a
    // silent false negative.
    const second = path.join(dir, 'other.js');
    await writeFile(second, 'export const other = true;\n');
    stored.files_written.push({ file: second, at: '2099-06-13T17:10:00.000Z' });
    stored.edit_counts[second] = 3;
    await writeFile(sessionFile, JSON.stringify(stored, null, 2));
    await writeFile(transcript, assistantTranscript('I changed a different feature.'));

    const widened = runStopHook(dir, transcript, 'sess-buglog');
    assert.equal(widened.status, 0, widened.stderr);
    const widenedPayload = JSON.parse(widened.stdout);
    assert.equal(widenedPayload.decision, 'block');
    assert.match(widenedPayload.hookSpecificOutput.additionalContext, /files edited 3\+ times/, 'a new file in the multi-edit set must re-nudge');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// bug-496: the buglog multi-edit nudge filtered only by path globs, never by
// file type, so editing a prose document three times triggered "log any bugs
// fixed." The obligation is a code concept: three edits to a .md is authoring,
// not debugging.
//
// The gate is project-derived rather than a fixed language list, so these tests
// pin BOTH directions — prose suppressed, code still nudged — and the explicit
// -config path that makes an unforeseen language (PowerShell) work untouched.
test('buglog nudge suppresses prose files but still fires on code', async () => {
  await assertStopSourceAndRuntimeContract();
  const dir = await fixture();
  try {
    await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
    const transcript = path.join(dir, 'transcript.jsonl');
    const sessionFile = path.join(dir, '.wolf', 'hooks', '_session.json');
    const editAt = '2099-06-13T17:00:00.000Z';
    const prose = path.join(dir, 'CHANGE-REQUEST.md');
    await writeFile(prose, '# CR\n');
    await writeFile(path.join(dir, '.wolf', 'config.json'), JSON.stringify({ openwolf: { quality_gate: { buglog_scan_excludes: [] } } }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [] }, null, 2));
    await utimes(path.join(dir, '.wolf', 'buglog.json'), new Date('2099-06-13T16:00:00.000Z'), new Date('2099-06-13T16:00:00.000Z'));
    const mkSession = (target) => JSON.stringify({
      session_id: 'sess-ext', started: editAt, files_read: {},
      files_written: [{ file: target, at: editAt }],
      edit_counts: { [target]: 3 },
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
      cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    }, null, 2);

    await writeFile(sessionFile, mkSession(prose));
    await writeFile(transcript, assistantTranscript('I revised the change request.'));
    const proseRun = runStopHook(dir, transcript, 'sess-ext');
    assert.equal(proseRun.status, 0, proseRun.stderr);
    assert.doesNotMatch(proseRun.stdout, /files edited 3\+ times/, 'editing prose 3x must not create a bug-fix obligation');

    // Negative control: the SAME fixture with a code file must still nudge, or
    // the fix would be a silent false negative rather than a fix.
    const code = path.join(dir, 'feature.js');
    await writeFile(code, 'export const feature = true;\n');
    await writeFile(sessionFile, mkSession(code));
    await writeFile(transcript, assistantTranscript('I changed a feature.'));
    const codeRun = runStopHook(dir, transcript, 'sess-ext');
    assert.equal(codeRun.status, 0, codeRun.stderr);
    const payload = JSON.parse(codeRun.stdout);
    assert.match(payload.hookSpecificOutput.additionalContext, /files edited 3\+ times/, 'code files must still carry the obligation');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buglog obligation extensions are configurable for unforeseen languages', async () => {
  const { detectObligationExtensions, carriesBugfixObligation } = await import('../src/hooks/shared.js');

  // Explicit config is honored verbatim and never triggers project detection.
  let scanned = false;
  const configured = detectObligationExtensions(['ps1', '.PSM1'], () => { scanned = true; return ['x.ts']; });
  assert.equal(scanned, false, 'explicit config must not fall back to detection');
  assert.deepEqual([...configured].sort(), ['.ps1', '.psm1'], 'forms normalize to lowercase dotted');

  // Detection intersects a known registry with what the repo actually contains.
  // Frequency must NOT decide: .md is 5/6 of this fixture and must still lose.
  const detected = detectObligationExtensions(null, () => ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'one.ps1']);
  assert.ok(detected.has('.ps1'), 'a PowerShell project gets .ps1 with no config');
  assert.ok(!detected.has('.md'), 'prose must not become an obligation by being common');

  // Unknown/empty project falls back to the full registry: a false positive is
  // visible and ackable, a false negative is silent. Fail loud.
  assert.ok(detectObligationExtensions(null, () => []).size > 40, 'empty project keeps the nudge alive');
  assert.ok(detectObligationExtensions(null, () => { throw new Error('no git'); }).size > 40, 'git failure keeps the nudge alive');

  // Explicit [] is an opt-out, NOT a request to detect — it must not silently
  // invert into its opposite.
  const optOut = detectObligationExtensions([], () => ['x.ts']);
  assert.equal(optOut.size, 0);
  assert.equal(carriesBugfixObligation('/p/a.md', { extensions: optOut }), true, '[] disables the type gate, excludes-only');

  // Excludes still win over extension, and .wolf hooks remain in scope (unlike
  // isCodeFile, whose .wolf exclusion would blind the nudge on Wolfpack itself).
  const exts = detectObligationExtensions(null, () => ['a.ts', 'b.js']);
  const excludeRegexes = [/\/tmp\//, /\.test\./];
  assert.equal(carriesBugfixObligation('/tmp/x.ts', { extensions: exts, excludeRegexes }), false);
  assert.equal(carriesBugfixObligation('/p/a.test.ts', { extensions: exts, excludeRegexes }), false);
  assert.equal(carriesBugfixObligation('/p/.wolf/hooks/stop.js', { extensions: exts, excludeRegexes }), true);
});

// bug-498 follow-on: attribution must be complete before it is trusted.
// Found by self-check while the companion reviews were running.
//
// The review size trigger sums per-write tokens for in-scope files. The first
// implementation set its "use scoped attribution" flag from ANY write carrying
// a tokens field — including excluded ones. A session whose only in-scope write
// predates per-write token recording, but which also contains an excluded write
// that has the field, took the scoped path, summed 0, and reported 0 lines:
// the size trigger silently disabled with no error.
//
// This is a pure-logic test of the decision rule (no hook subprocess) because
// the hazard is arithmetic, not I/O: it is about WHICH basis gets chosen.
test('review size trigger falls back when in-scope attribution is incomplete', () => {
  const norm = (f) => f.replace(/\\/g, '/').toLowerCase();
  const excluded = [/\/tmp\//];
  // Drive the REAL production write shape. `sessionEntry.writes` is built in
  // stop.ts by mapping session.files_written to {file, tokens_estimated, action}
  // -- the persisted ledger schema. An earlier version of this test built writes
  // with a `tokens` field instead, matching the (wrong) field name the
  // implementation read. Both sides shared one mistaken model, so 103 tests
  // passed while scoped attribution never ran in production even once.
  //
  // Tests that re-declare the rule can only confirm their author. This mapper
  // is the same transformation the hook performs, so a field-name divergence
  // between producer and consumer now fails the suite instead of hiding in it.
  const asSessionWrites = (files_written) =>
    files_written.map((w) => ({ file: w.file, tokens_estimated: w.tokens, action: w.action ?? 'Edit' }));
  const decide = (files_written, sessionTotal) => {
    const writes = asSessionWrites(files_written);
    const inScope = new Set(writes.map((w) => w.file).filter((f) => !excluded.some((re) => re.test(f))).map(norm));
    const scopedWrites = writes.filter((w) => inScope.has(norm(w.file)));
    // Mirrors writeTokens/hasUsableTokens in stop.ts maybeNudgeReview.
    const tokOf = (w) => (typeof w.tokens_estimated === 'number' ? w.tokens_estimated : w.tokens);
    const hasTok = (w) => {
      const t = tokOf(w);
      return typeof t === 'number' && Number.isFinite(t) && t >= 0;
    };
    const complete = scopedWrites.length > 0 && scopedWrites.some(hasTok) && scopedWrites.every(hasTok)
      && scopedWrites.reduce((a, w) => a + (hasTok(w) ? tokOf(w) : 0), 0) > 0;
    const tokens = complete ? scopedWrites.reduce((a, w) => a + tokOf(w), 0) : sessionTotal;
    return { complete, lines: Math.max(0, Math.round(tokens / 17)) };
  };

  // The defect: only in-scope write lacks tokens, an EXCLUDED write has them.
  const bug = decide([{ file: '/p/src/b.ts' }, { file: '/tmp/x.mjs', tokens: 40000 }], 51000);
  assert.equal(bug.complete, false, 'an excluded write must not make attribution look complete');
  assert.ok(bug.lines >= 40, 'must fall back and still fire rather than silently reporting 0');

  // Negative controls — complete attribution must stay accurate in BOTH
  // directions, or the fix would just re-enable the original over-reporting.
  const small = decide([{ file: '/p/src/a.ts', tokens: 85 }, { file: '/tmp/x.mjs', tokens: 40000 }], 51000);
  assert.equal(small.complete, true);
  assert.equal(small.lines, 5, 'a 5-line in-scope edit must not inherit the session total');
  assert.ok(small.lines < 40, 'small in-scope edits must not fire');

  const large = decide([{ file: '/p/src/a.ts', tokens: 3400 }], 51000);
  assert.equal(large.complete, true);
  assert.ok(large.lines >= 40, 'a genuinely large in-scope change must still fire');

  // Partially-migrated session: undercount is refused in favor of the total.
  const partial = decide([{ file: '/p/src/a.ts', tokens: 900 }, { file: '/p/src/b.ts' }], 51000);
  assert.equal(partial.complete, false, 'a partial token set must not be trusted');
  assert.ok(partial.lines >= 40, 'partial data over-reports (visible) rather than under-reports (silent)');

  // Malformed values must fail toward firing, not toward a silent 0. Negative
  // is unreachable from estimateTokens (Math.ceil of a non-negative length) but
  // a corrupted _session.json would shrink the sum, and a shrinking sum fails
  // toward a dead gate.
  for (const bad of [NaN, Infinity, -500]) {
    const r = decide([{ file: '/p/src/a.ts', tokens: bad }], 51000);
    assert.equal(r.complete, false, `tokens=${bad} must not count as usable attribution`);
    assert.ok(r.lines >= 40, `tokens=${bad} must fall back and fire, not silently report 0`);
  }

  // ...but a legitimate 0 (an emptied file) is real data, not a malformed
  // value, and must still be trusted. Guarding must not overreach.
  // A pure DELETION records tokens: 0 -- estimateTokens measures
  // `content || new_string`, and an Edit that removes a block has an empty
  // new_string. So "every in-scope write is a deletion" is a REAL state, and it
  // must not silently skip the gate: deleting 500 lines is exactly the change
  // that most needs review. Found by minimax review of review-0077.
  const allZero = decide([{ file: '/p/src/a.ts', tokens: 0 }], 5000);
  assert.equal(allZero.complete, false, 'a zero-token sum tells us nothing; do not trust it');
  assert.ok(allZero.lines >= 40, 'an all-deletion session must fall back and fire, not go silent');

  // ...but guard the SUM, not the individual value. A deletion alongside a real
  // edit is still accurate attribution and must NOT fall back to the session
  // total -- otherwise the original over-reporting bug returns.
  const mixed = decide([{ file: '/p/src/a.ts', tokens: 0 }, { file: '/p/src/b.ts', tokens: 100 }], 51000);
  assert.equal(mixed.complete, true, 'a zero write among real ones is valid data');
  assert.equal(mixed.lines, 6, 'must use scoped attribution, not the 51000-token session total');
});

// kimi review, review-0077: the two hooks call ONE shared obligation predicate
// but naturally hold different path forms -- post-write has the absolute path,
// the Stop hook has project-relative edit_counts keys. Excludes are ^…$-anchored
// globs matching a single form, so the shared predicate returned OPPOSITE
// answers for the same file: a project under /tmp had post-write suppressed by
// the `/tmp/**` exclude while the Stop hook still fired.
test('obligation excludes match regardless of which path form the caller holds', async () => {
  const { carriesBugfixObligation, globToRegex } =
    await import(path.join(repoRoot, '.wolf/hooks/shared.js'));
  const exts = new Set(['.sh', '.ts']);
  const ask = (p, alt) => carriesBugfixObligation(p, {
    excludeRegexes: ['/tmp/**', 'src/scratch/**'].map(globToRegex),
    extensions: exts,
    altPaths: alt,
  });

  // Absolute-form exclude (/tmp/**) must suppress BOTH callers.
  assert.equal(ask('/tmp/demo/src/a.sh'), false, 'absolute caller: /tmp/** applies');
  assert.equal(ask('src/a.sh', ['/tmp/demo/src/a.sh']), false,
    'relative caller must also see the absolute-form exclude');

  // Relative-form exclude (src/scratch/**) must suppress BOTH callers.
  assert.equal(ask('src/scratch/x.sh'), false, 'relative caller: src/scratch/** applies');
  assert.equal(ask('/home/u/proj/src/scratch/x.sh', ['src/scratch/x.sh']), false,
    'absolute caller must also see the relative-form exclude');

  // A file matching NEITHER exclude must still carry the obligation, in both
  // forms -- the fix must not become a blanket mute.
  assert.equal(ask('/home/u/proj/src/a.sh', ['src/a.sh']), true);
  assert.equal(ask('src/a.sh', ['/home/u/proj/src/a.sh']), true);
});

// The test above still MIRRORS the rule, so it cannot catch a future divergence
// between the write producer and the attribution consumer -- which is exactly
// the defect that slipped through (chatgpt arbitration, review-0077): writes are
// built with `tokens_estimated`, attribution read `w.tokens`, so
// attributionComplete was ALWAYS false on the live path and the entire scoped
// attribution feature was inert in production while its unit tests passed.
//
// This asserts the structural invariant against the SHIPPED bytes instead of a
// reimplementation, so renaming either side fails the suite.
test('attribution consumer reads the same token field the write producer emits', async () => {
  const src = await readFile(path.join(repoRoot, 'src/hooks/stop.ts'), 'utf-8');

  // Producer: the session-entry mapper.
  const producer = /const writes = session\.files_written\.map\(\(w\) => \(\{[\s\S]*?\}\)\);/.exec(src);
  assert.ok(producer, 'could not locate the sessionEntry.writes producer -- update this test');
  const producedField = /(\w+):\s*w\.tokens\b/.exec(producer[0]);
  assert.ok(producedField, 'producer no longer maps a token field');
  const fieldName = producedField[1];

  // Consumer: the attribution accessor in maybeNudgeReview.
  const consumer = /const writeTokens = \(w\) =>[\s\S]*?;/.exec(src);
  assert.ok(consumer, 'could not locate the attribution token accessor -- update this test');
  assert.ok(
    consumer[0].includes(`w.${fieldName}`),
    `attribution reads a different field than the producer emits (producer: "${fieldName}"). `
    + 'This makes attributionComplete always false and silently disables scoped attribution.',
  );
});

// chatgpt arbitration, review-0077 (second finding): covered_tokens and its
// basis marker were written as two independent statements, letting the stored
// value and its label disagree in BOTH directions -- each ending in a baseline
// subtracted across incommensurable scales, 0 effective lines, and a silently
// dead size trigger.
test('covered_tokens baseline and its basis marker can never disagree', () => {
  const SCOPED = 'scoped-writes';
  const SESSION = 'session-total';
  // Mirrors advanceCoveredTokens in stop.ts.
  const advance = (entry, cumulative, complete) => {
    const incoming = complete ? SCOPED : SESSION;
    const stored = entry.covered_tokens_basis
      ?? (typeof entry.covered_tokens === 'number' ? SESSION : null);
    if (stored === incoming && typeof entry.covered_tokens === 'number') {
      entry.covered_tokens = Math.max(entry.covered_tokens, cumulative);
    } else {
      entry.covered_tokens = cumulative;
    }
    entry.covered_tokens_basis = incoming;
    return entry;
  };
  const read = (entry, cumulative, complete) => {
    const want = complete ? SCOPED : SESSION;
    const covered = entry.covered_tokens_basis === want ? entry.covered_tokens : 0;
    return Math.max(0, Math.round((cumulative - covered) / 17));
  };

  // Direction 1: a stored SCOPED marker must not survive a fallback turn.
  const d1 = advance({ covered_tokens: 100, covered_tokens_basis: SCOPED }, 10000, false);
  assert.equal(d1.covered_tokens_basis, SESSION, 'a fallback turn must relabel the baseline it stored');
  assert.equal(d1.covered_tokens, 10000);
  assert.ok(read(d1, 800, true) >= 40, 'a later scoped turn must not subtract a session-total baseline');

  // Direction 2: Math.max must not retain an older session-total value while
  // the current scoped turn stamps SCOPED over it.
  const d2 = advance({ covered_tokens: 51000 }, 85, true);
  assert.equal(d2.covered_tokens, 85, 'an incommensurable stored value must be replaced, not max-ed');
  assert.equal(d2.covered_tokens_basis, SCOPED);
  assert.ok(read(d2, 3400, true) >= 40, 'a 200-line scoped change must still fire');

  // Same-basis advance keeps monotonic behavior -- the fix must not disable it.
  const same = advance({ covered_tokens: 500, covered_tokens_basis: SCOPED }, 300, true);
  assert.equal(same.covered_tokens, 500, 'same-basis baselines still advance monotonically');
  assert.equal(read(same, 600, true), 6, 'and are still subtracted');
});
