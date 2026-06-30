import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    assert.match(text, /out\.reason\s*=\s*"OpenWolf feedback"/);
    assert.doesNotMatch(text, /out\.reason\s*=\s*additionalContext/);
    assert.doesNotMatch(text, /process\.stderr\.write\(/);
  }
}

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

    let review = (await readReviewLog(dir)).reviews[0];
    assert.equal(review.status, 'pending');
    assert.equal(review.content_hashes[file], sha256('new bytes\n'));
    assert.equal(review.receipt.kind, 'current-byte');
    assert.equal(review.receipt.hashes[file], sha256('new bytes\n'));

    const unsafe = runHelper(dir, 'review-0001', [], 'test');
    assert.equal(unsafe.status, 4);
    assert.match(unsafe.stderr, /REVIEW_STALE/);
    assert.match(unsafe.stderr, /--reviewed-current/);

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
    assert.equal(firstPayload.reason, 'OpenWolf feedback');
    assert.doesNotMatch(firstPayload.reason, /OpenWolf autonomy:/);
    assert.match(firstPayload.hookSpecificOutput.additionalContext, /OpenWolf autonomy:/);

    const second = runStopHook(dir, transcript, 'sess-autonomy');
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /OpenWolf autonomy:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
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
    assert.equal(firstPayload.reason, 'OpenWolf feedback');
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
