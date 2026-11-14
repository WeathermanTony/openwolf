import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = await import(path.join(repoRoot, 'src/hooks/shared.js'));
const { detectDroppedQueueMessages, detectMidturnInjections } = shared;
const stopHook = path.join(repoRoot, 'src/hooks/stop.js');

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
function assistantText(text, timestamp) {
  return { type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'text', text }] } };
}
function assistantTool(timestamp) {
  return { type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } };
}
const INTERRUPT = '[Request interrupted by user]';

async function transcriptFixture(entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-queue-watch-'));
  const file = path.join(dir, 'transcript.jsonl');
  await writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { dir, file };
}

async function stopFixture(mode, entries, watch = {}) {
  const result = await transcriptFixture(entries);
  await writeFile(path.join(result.dir, 'package.json'), '{"type":"module"}\n');
  const wolfDir = path.join(result.dir, '.wolf');
  const hooksDir = path.join(wolfDir, 'hooks');
  await mkdir(hooksDir, { recursive: true });
  await writeFile(path.join(wolfDir, 'config.json'), JSON.stringify({ openwolf: { behavior: { mode }, queue_drop_watch: { enabled: true, injection_reminder: true, ...watch } } }));
  await writeFile(path.join(hooksDir, '_session.json'), JSON.stringify({ session_id: 'queue-test', files_read: [], files_written: [], start_time: new Date().toISOString() }));
  return result;
}

function runStop(dir, transcript) {
  return spawnSync(process.execPath, [stopHook], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ session_id: 'queue-test', transcript_path: transcript }),
    encoding: 'utf8',
  });
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

for (const mode of ['quiet', 'standard']) {
  test(`Stop hook in ${mode} mode requires resuming work after injection accounting`, async () => {
    const { dir, file } = await stopFixture(mode, [injection('please also verify the parser', T1)]);
    try {
      const result = runStop(dir, file);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.decision, 'block');
      const feedback = output.hookSpecificOutput.additionalContext;
      assert.match(feedback, /please also verify the parser/);
      assert.match(feedback, /do not ask the user to re-send/i);
      assert.match(feedback, /Then resume your prior task and keep working/i);
      assert.match(feedback, /do not end your turn at the accounting line\.$/i);
      assert.ok(feedback.indexOf('Log:') < feedback.indexOf('Then resume'), 'resume instruction must follow log metadata');

      const repeated = runStop(dir, file);
      assert.equal(repeated.status, 0, repeated.stderr);
      if (repeated.stdout.trim()) {
        const repeatedOutput = JSON.parse(repeated.stdout);
        assert.notEqual(repeatedOutput.decision, 'block', 'same injection must remind only once');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('true queue loss retains the distinct resend warning', async () => {
  const { dir, file } = await stopFixture('quiet', [removeOp('message that never arrived', T0)]);
  try {
    const result = runStop(dir, file);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, 'block');
    const feedback = output.hookSpecificOutput.additionalContext;
    assert.match(feedback, /never reached the model/);
    assert.match(feedback, /ask them to re-send/);
    assert.doesNotMatch(feedback, /Then resume your prior task/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const REPLY = 'Done: the parser now rejects empty input, and its test passes locally.';

test('injection detector marks an injection replied only after substantive assistant text', async () => {
  const { dir, file } = await transcriptFixture([
    assistantText(REPLY, T0),
    injection('first ask', T1),
    assistantTool(T2),
    assistantText('ok', T2),
    injection('second ask', T3),
  ]);
  try {
    const found = detectMidturnInjections(file);
    assert.equal(found.length, 2);
    assert.equal(found[0].replied, false, 'tool calls and a two-letter reply are not a prose reply');
    assert.equal(found[1].replied, false, 'text BEFORE an injection must not count as replying to it');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('injection detector labels peer-session and subagent senders', async () => {
  const { dir, file } = await transcriptFixture([
    injection('<cross-session-message from="uds:/x.sock" from-name="lead">pause</cross-session-message>', T0),
    injection('<agent-message from="abc">found it</agent-message>', T1),
    injection('plain user text', T2),
  ]);
  try {
    assert.deepEqual(detectMidturnInjections(file).map((d) => d.sender), ['peer session', 'subagent', 'user']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Stop hook skips an injection the model already answered, and records it as suppressed', async () => {
  const { dir, file } = await stopFixture('quiet', [injection('please also verify the parser', T1), assistantText(REPLY, T2)]);
  try {
    const result = runStop(dir, file);
    assert.equal(result.status, 0, result.stderr);
    if (result.stdout.trim()) assert.notEqual(JSON.parse(result.stdout).decision, 'block');
    const log = JSON.parse(await readFile(path.join(dir, '.wolf', 'queue-injections.json'), 'utf8'));
    assert.equal(log.injections.length, 1);
    assert.equal(log.injections[0].suppressed, 'assistant_replied');
    assert.equal(log.injections[0].warned_at, undefined);
    assert.equal(log.seen.length, 1, 'a suppressed injection is marked seen so it never reminds later');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Stop hook still reminds when only tool calls followed the injection', async () => {
  const { dir, file } = await stopFixture('quiet', [assistantText(REPLY, T0), injection('please also verify the parser', T1), assistantTool(T2)]);
  try {
    const result = runStop(dir, file);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, 'block');
    assert.match(output.hookSpecificOutput.additionalContext, /1 user message\(s\) arrived mid-turn with no reply from you since/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Stop hook labels non-user senders instead of calling them user messages', async () => {
  const { dir, file } = await stopFixture('quiet', [injection('<agent-message from="abc">found the schema</agent-message>', T1)]);
  try {
    const feedback = JSON.parse(runStop(dir, file).stdout).hookSpecificOutput.additionalContext;
    assert.match(feedback, /1 message\(s\) arrived mid-turn/);
    assert.doesNotMatch(feedback, /user message/);
    assert.match(feedback, /\[subagent\] "<agent-message/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('injection_skip_if_replied=false restores the remind-every-injection behavior', async () => {
  const { dir, file } = await stopFixture('quiet', [injection('please also verify the parser', T1), assistantText(REPLY, T2)], { injection_skip_if_replied: false });
  try {
    assert.equal(JSON.parse(runStop(dir, file).stdout).decision, 'block');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the reply threshold counts all text in one assistant message, not single blocks', async () => {
  const split = { type: 'assistant', timestamp: T2, message: { role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(20) }, { type: 'text', text: 'b'.repeat(20) }] } };
  const short = { type: 'assistant', timestamp: T2, message: { role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(19) }, { type: 'text', text: 'b'.repeat(20) }] } };
  const a = await transcriptFixture([injection('verify parser', T1), split]);
  const b = await transcriptFixture([injection('verify parser', T1), short]);
  try {
    assert.equal(detectMidturnInjections(a.file)[0].replied, true, '20+20 chars in one message is a 40-char reply');
    assert.equal(detectMidturnInjections(b.file)[0].replied, false, '39 chars total stays below the threshold');
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});
