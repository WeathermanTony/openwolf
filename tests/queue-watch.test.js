import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = await import(path.join(repoRoot, 'src/hooks/shared.js'));
const { detectDroppedQueueMessages, detectMidturnInjections } = shared;

const T0 = '2026-07-19T05:00:00.000Z';
const T1 = '2026-07-19T05:00:05.000Z';
const T2 = '2026-07-19T05:00:10.000Z';
const T3 = '2026-07-19T05:00:20.000Z';

function removeOp(content, timestamp) {
  return { type: 'queue-operation', operation: 'remove', content, timestamp };
}
function userTurn(text, timestamp) {
  return { type: 'user', timestamp, message: { role: 'user', content: text } };
}
function injection(prompt, timestamp) {
  return { type: 'attachment', timestamp, attachment: { type: 'queued_command', prompt } };
}
const INTERRUPT = '[Request interrupted by user]';

async function transcriptFixture(entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-queue-watch-'));
  const file = path.join(dir, 'transcript.jsonl');
  await writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { dir, file };
}

test('drop detector flags a bare remove with no delivery evidence', async () => {
  const { dir, file } = await transcriptFixture([removeOp('please fix the login bug', T0)]);
  try {
    const drops = detectDroppedQueueMessages(file);
    assert.equal(drops.length, 1);
    assert.match(drops[0].preview, /please fix the login bug/);
    assert.equal(drops[0].timestamp, T0);
    assert.match(drops[0].hash, /^[0-9a-f]{16}$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('remove followed by queued_command attachment is normal mid-turn delivery, not a drop', async () => {
  const msg = 'are you still there?';
  const { dir, file } = await transcriptFixture([removeOp(msg, T0), injection(msg, T1)]);
  try {
    assert.deepEqual(detectDroppedQueueMessages(file), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('task-notification removes are routine queue consumption, not drops', async () => {
  const { dir, file } = await transcriptFixture([removeOp('<task-notification>task abc completed</task-notification>', T0)]);
  try {
    assert.deepEqual(detectDroppedQueueMessages(file), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a later exact user turn recovers the drop (user re-pasted)', async () => {
  const msg = 'did you get my earlier message about the deploy?';
  const { dir, file } = await transcriptFixture([removeOp(msg, T0), userTurn(msg, T2)]);
  try {
    assert.deepEqual(detectDroppedQueueMessages(file), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a later user turn sharing only a prefix does NOT recover the drop', async () => {
  const shared80 = 'x'.repeat(80);
  const dropped = shared80 + ' tail-A';
  const later = shared80 + ' tail-B';
  const { dir, file } = await transcriptFixture([removeOp(dropped, T0), userTurn(later, T2)]);
  try {
    const drops = detectDroppedQueueMessages(file);
    assert.equal(drops.length, 1);
    assert.ok(drops[0].preview.startsWith(shared80.slice(0, 40)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a user turn BEFORE the remove does not recover a later drop of the same text', async () => {
  const msg = 'same text sent twice';
  const { dir, file } = await transcriptFixture([userTurn(msg, T0), removeOp(msg, T2)]);
  try {
    assert.equal(detectDroppedQueueMessages(file).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('remove right after an Esc interrupt is an intentional clear, suppressed', async () => {
  const { dir, file } = await transcriptFixture([
    userTurn(INTERRUPT, T0),
    removeOp('half-typed message cleared by esc', T1),
  ]);
  try {
    assert.deepEqual(detectDroppedQueueMessages(file), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a drop BEFORE the interrupt still warns (Esc must not erase earlier loss)', async () => {
  const { dir, file } = await transcriptFixture([
    removeOp('ignored message sent before the esc', T0),
    userTurn(INTERRUPT, T3),
  ]);
  try {
    assert.equal(detectDroppedQueueMessages(file).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the same message dropped twice warns twice with distinct hashes', async () => {
  const msg = 'why are you not answering';
  const { dir, file } = await transcriptFixture([removeOp(msg, T0), removeOp(msg, T2)]);
  try {
    const drops = detectDroppedQueueMessages(file);
    assert.equal(drops.length, 2);
    assert.notEqual(drops[0].hash, drops[1].hash);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('identical content+timestamp remove pairs still hash distinctly (occurrence ordinal)', async () => {
  const msg = 'duplicate stamp';
  const { dir, file } = await transcriptFixture([removeOp(msg, T0), removeOp(msg, T0)]);
  try {
    const drops = detectDroppedQueueMessages(file);
    assert.equal(drops.length, 2);
    assert.notEqual(drops[0].hash, drops[1].hash);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing or malformed transcript yields no drops and no throw', async () => {
  assert.deepEqual(detectDroppedQueueMessages(path.join(tmpdir(), 'ow-no-such-transcript.jsonl')), []);
  const { dir, file } = await transcriptFixture([]);
  try {
    await writeFile(file, 'not json\n{broken\n');
    assert.deepEqual(detectDroppedQueueMessages(file), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('injection detector flags queued_command attachments', async () => {
  const { dir, file } = await transcriptFixture([injection('ping — did you see this?', T1)]);
  try {
    const found = detectMidturnInjections(file);
    assert.equal(found.length, 1);
    assert.match(found[0].preview, /ping/);
    assert.equal(found[0].timestamp, T1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('task-notification attachments are harness-internal, not reminded', async () => {
  const { dir, file } = await transcriptFixture([injection('<task-notification>done</task-notification>', T1)]);
  try {
    assert.deepEqual(detectMidturnInjections(file), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('two identical injections hash distinctly so each reminds once', async () => {
  const msg = 'same nudge twice';
  const { dir, file } = await transcriptFixture([injection(msg, T1), injection(msg, T1)]);
  try {
    const found = detectMidturnInjections(file);
    assert.equal(found.length, 2);
    assert.notEqual(found[0].hash, found[1].hash);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
