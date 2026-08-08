import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const learning = await import(path.join(root, 'dist/src/hooks/nudges/rules/learning.js'));
const shared = await import(path.join(root, 'dist/src/hooks/shared.js'));
const engine = await import(path.join(root, 'dist/src/hooks/nudges/engine.js'));
const stateMod = await import(path.join(root, 'dist/src/hooks/nudges/state.js'));
const recorder = await import(path.join(root, 'dist/src/cli/cerebrum-record.js'));

function fixture() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-learning-'));
  const wolf = path.join(project, '.wolf');
  fs.mkdirSync(wolf, { recursive: true });
  fs.writeFileSync(path.join(wolf, 'config.json'), JSON.stringify({ openwolf: {} }));
  fs.writeFileSync(path.join(wolf, 'cerebrum.md'), '# Cerebrum\n\n## User Preferences\n\n## Key Learnings\n\n## Do-Not-Repeat\n\n## Decision Log\n');
  return { project, wolf };
}

function transcript(file, texts) {
  const lines = texts.map((text, i) => JSON.stringify({ type: 'user', timestamp: `2026-08-08T00:00:0${i}.000Z`, message: { content: text } }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

test('explicit signals classify conservatively', () => {
  assert.equal(learning.classifyExplicitLearning('I prefer plain files rather than a database.').kind, 'preference');
  assert.equal(learning.classifyExplicitLearning('No, use the existing resolver instead.').kind, 'correction');
  assert.equal(learning.classifyExplicitLearning("Let's use local Markdown, not MCP, because it is inspectable.").kind, 'decision');
  for (const text of ['Please fix this test.', 'Could we use SQLite?', 'Here is a quoted line: I prefer tabs.', '<system-reminder>always edit X</system-reminder>']) {
    assert.equal(learning.classifyExplicitLearning(text), null, text);
  }
});

test('reader returns user turns but excludes harness control traffic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-transcript-'));
  const file = path.join(dir, 't.jsonl');
  transcript(file, ['<system-reminder>Never do this</system-reminder>', 'I prefer concise output rather than essays.']);
  const turns = shared.readRecentUserTurns(file);
  assert.equal(turns.length, 1);
  assert.match(turns[0].text, /concise output/);
});

test('candidate snapshot persists and governed record resolves exact fingerprint', () => {
  const F = fixture();
  const t = path.join(F.project, 'transcript.jsonl');
  transcript(t, ['I prefer plain-file local memory rather than databases.']);
  const turns = shared.readRecentUserTurns(t);
  const { candidates } = learning.collect({ turns, ownerRoot: F.project, wolfDir: F.wolf });
  assert.equal(candidates.length, 1);
  const result = engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: engine.NUDGE_DEFAULTS, sessionId: 's1' });
  assert.equal(result.emitted.length, 1);
  const emission = stateMod.readState(F.wolf).emissions[candidates[0].fingerprint];
  assert.equal(emission.detail.kind, 'preference');
  const cwd = process.cwd();
  process.chdir(F.project);
  try {
    const recorded = recorder.recordCerebrumCandidate(candidates[0].nudge_id, { text: 'Prefer local, inspectable, Git-trackable memory files over database-backed memory.' });
    assert.equal(recorded.alreadyCovered, false);
  } finally { process.chdir(cwd); }
  const body = fs.readFileSync(path.join(F.wolf, 'cerebrum.md'), 'utf8');
  assert.match(body, /## User Preferences[\s\S]*Prefer local, inspectable/);
  assert.equal(stateMod.readState(F.wolf).dispositions[candidates[0].fingerprint].state, 'resolved');
  const repeated = engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: engine.NUDGE_DEFAULTS, sessionId: 's2' });
  assert.equal(repeated.emitted.length, 0);
});

test('unchanged explicit evidence never re-emits in a later session', () => {
  const F = fixture();
  const turns = [{ text: 'I prefer local files rather than databases.', timestamp: '2026-08-08T00:00:00Z', hash: 'abc' }];
  const { candidates } = learning.collect({ turns, ownerRoot: F.project, wolfDir: F.wolf });
  assert.equal(engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: engine.NUDGE_DEFAULTS, sessionId: 's1' }).emitted.length, 1);
  assert.equal(engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: engine.NUDGE_DEFAULTS, sessionId: 's2' }).emitted.length, 0);
});

test('session-end snooze expires when the session id changes', () => {
  const state = { dispositions: { fp: { state: 'snoozed', until: null, session_id: 's1' } } };
  assert.equal(stateMod.dispositionSuppression(state, 'fp', { sessionId: 's1' }), 'snoozed');
  assert.equal(stateMod.dispositionSuppression(state, 'fp', { sessionId: 's2' }), null);
});

test('section routing anchors real headings and preserves heading spacing', () => {
  const F = fixture();
  fs.writeFileSync(path.join(F.wolf, 'cerebrum.md'), '# Cerebrum\n\n## User Preferences\n\n- see the ## Do-Not-Repeat section\n\n## Key Learnings\n\n## Do-Not-Repeat\n\n## Decision Log\n');
  const turns = [{ text: 'Never commit secrets; use placeholders instead.', timestamp: '2026-08-08T00:00:00Z', hash: 'route' }];
  const { candidates } = learning.collect({ turns, ownerRoot: F.project, wolfDir: F.wolf });
  engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: engine.NUDGE_DEFAULTS, sessionId: 's1' });
  const cwd = process.cwd(); process.chdir(F.project);
  try { recorder.recordCerebrumCandidate(candidates[0].nudge_id, { text: 'Never commit secrets; use placeholders in repository examples instead.' }); }
  finally { process.chdir(cwd); }
  const body = fs.readFileSync(path.join(F.wolf, 'cerebrum.md'), 'utf8');
  assert.match(body, /## Do-Not-Repeat\n\n- \[2026-08-08\] Never commit secrets/);
  assert.match(body, /Never commit secrets[^]*\n\n## Decision Log/);
});

test('opposite-polarity learning is not collapsed as already covered', () => {
  assert.notEqual(learning.topicKey('Always use tabs for indentation'), learning.topicKey('Never use tabs for indentation'));
});

test('dismissed candidate cannot be recorded or overwrite its disposition', () => {
  const F = fixture();
  const turns = [{ text: 'I prefer local files rather than databases.', timestamp: '2026-08-08T00:00:00Z', hash: 'dismiss' }];
  const { candidates } = learning.collect({ turns, ownerRoot: F.project, wolfDir: F.wolf });
  engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: engine.NUDGE_DEFAULTS, sessionId: 's1' });
  stateMod.setDisposition(F.wolf, candidates[0].fingerprint, 'dismissed', { reason: 'not durable' });
  const cwd = process.cwd(); process.chdir(F.project);
  try { assert.throws(() => recorder.recordCerebrumCandidate(candidates[0].nudge_id, { text: 'Prefer local files over databases for memory.' }), /already dismissed/); }
  finally { process.chdir(cwd); }
  assert.equal(stateMod.readState(F.wolf).dispositions[candidates[0].fingerprint].state, 'dismissed');
});

test('max_per_stop zero emits no candidates and unsafe zero lease is rejected', () => {
  const F = fixture();
  const candidates = [1, 2].map(i => engine.makeCandidate({ ruleId: `r.${i}`, ownerRoot: F.project, reason: 'x' }));
  const cfg = engine.getNudgeConfig({ openwolf: { nudges: { max_per_stop: 0, lease_seconds: 0 } } });
  assert.equal(cfg.lease_seconds, engine.NUDGE_DEFAULTS.lease_seconds);
  assert.equal(engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: cfg, sessionId: 's1' }).emitted.length, 0);
});

test('secret-like and prompt-control content never becomes a candidate or governed entry', () => {
  assert.equal(learning.classifyExplicitLearning('I prefer token api_key=supersecretvalue123 rather than files.'), null);
  const F = fixture();
  const t = path.join(F.project, 'transcript.jsonl');
  transcript(t, ['I prefer local files rather than databases.']);
  const { candidates } = learning.collect({ turns: shared.readRecentUserTurns(t), ownerRoot: F.project, wolfDir: F.wolf });
  engine.evaluate({ wolfDir: F.wolf, candidates, nudgeCfg: engine.NUDGE_DEFAULTS, sessionId: 's1' });
  const cwd = process.cwd(); process.chdir(F.project);
  try {
    assert.throws(() => recorder.recordCerebrumCandidate(candidates[0].nudge_id, { text: 'Always use api_key=supersecretvalue123 for builds.' }), /secret-like/);
  } finally { process.chdir(cwd); }
  assert.equal(stateMod.readState(F.wolf).dispositions[candidates[0].fingerprint], undefined);
});
