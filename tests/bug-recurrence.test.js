import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanupFixture, createTmpFixture } from './lib/fixture-cleanup.js';
import { buildRecurrenceReport } from '../dist/src/buglog/recurrence-report.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'dist/bin/openwolf.js');
const ERROR = 'Connection refused while writing cache';
const FIXED_AT = '2026-09-02T12:00:00Z';
const BEFORE = '2026-09-02T11:59:59Z';
const AFTER = '2026-09-02T12:00:01Z';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function git(project, args, env = {}) {
  const result = spawnSync('git', args, { cwd: project, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const project = createTmpFixture('ow-ledger-test-');
  fs.mkdirSync(path.join(project, '.wolf', 'qa'), { recursive: true });
  fs.mkdirSync(path.join(project, 'transcripts'));
  fs.writeFileSync(path.join(project, '.wolf', 'qa', 'cache.md'), '# Cache fix reduction\n');
  fs.writeFileSync(path.join(project, 'fixed.js'), 'export const fixed = true;\n');
  git(project, ['init', '-q']);
  git(project, ['add', 'fixed.js']);
  git(project, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '-m', 'repair cache'], {
    GIT_AUTHOR_DATE: FIXED_AT, GIT_COMMITTER_DATE: FIXED_AT,
  });
  const commit = git(project, ['rev-parse', 'HEAD']);
  const committedAt = git(project, ['show', '-s', '--format=%cI', 'HEAD']);
  assert.equal(new Date(committedAt).getTime(), new Date(FIXED_AT).getTime());
  const bug = {
    id: 'bug-101', status: 'resolved', error_message: ERROR,
    commit, reduction: '.wolf/qa/cache.md', root_cause: 'Fixture failure', fix: 'Fixture repair',
  };
  const ledger = path.join(project, '.wolf', 'buglog.json');
  const transcripts = path.join(project, 'transcripts');
  fs.writeFileSync(ledger, JSON.stringify({ version: 1, bugs: [bug] }));
  return { project, ledger, transcripts, commit, committedAt, bug };
}

function assistant(project, sessionId, id, timestamp = BEFORE, extra = {}) {
  return {
    type: 'assistant', sessionId, cwd: project, timestamp,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'fixture only' } }] },
    ...extra,
  };
}

function result(project, sessionId, id, timestamp = BEFORE, text = ERROR, extra = {}) {
  return {
    type: 'user', sessionId, cwd: project, ...(timestamp === null ? {} : { timestamp }),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: text }] },
    ...extra,
  };
}

function writeTranscript(directory, name, records) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  return file;
}

function run(project, transcripts, args = []) {
  return spawnSync(process.execPath, [cli, 'bug', 'recurrence', '--transcripts', transcripts, '--json', ...args], {
    cwd: project, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, OPENWOLF_DISABLE_DAEMON: '1' },
  });
}

function jsonRun(project, transcripts, args = [], expectedStatus = 0) {
  const child = run(project, transcripts, args);
  assert.equal(child.status, expectedStatus, `exit ${child.status}: ${child.stderr}\n${child.stdout}`);
  return JSON.parse(child.stdout);
}

function scopedReport(f, options = {}) {
  return buildRecurrenceReport({ projectRoot: f.project, transcriptDir: f.transcripts, ...options });
}

function allIncidents(report) {
  return report.bugs.flatMap((bug) => bug.incidents);
}

function assertNoRawEvidence(report) {
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(ERROR), 'report must not disclose matching output');
  assert.ok(!serialized.includes('fixture only'), 'report must not disclose tool commands');
  assert.ok(!serialized.includes('SECRET_TRANSCRIPT_SENTINEL'), 'report must not disclose transcript content');
}

function withFixture(fn) {
  const f = fixture();
  try { return fn(f); } finally { cleanupFixture(f.project); }
}

test('real CLI counts distinct direct failures, dedups copied records, and binds exact source bytes', () => withFixture((f) => {
  const records = [
    assistant(f.project, 'session-a', 'tool-1'), result(f.project, 'session-a', 'tool-1'),
    assistant(f.project, 'session-a', 'tool-2', AFTER), result(f.project, 'session-a', 'tool-2', AFTER),
    assistant(f.project, 'session-b', 'tool-3', AFTER), result(f.project, 'session-b', 'tool-3', AFTER),
  ];
  const original = writeTranscript(f.transcripts, 'session-a.jsonl', records);
  writeTranscript(f.transcripts, 'copy.jsonl', records);
  const before = fs.readFileSync(f.ledger);
  const transcriptBefore = fs.readFileSync(original);
  const report = jsonRun(f.project, f.transcripts);
  assert.equal(report.complete, true);
  assert.equal(report.summary.bugs_considered, 1);
  assert.equal(report.summary.evaluable_fixes, 1);
  assert.equal(report.summary.matched_bugs, 1);
  assert.equal(report.summary.distinct_incidents, 3);
  assert.equal(report.summary.distinct_sessions, 2);
  assert.equal(report.summary.post_fix_possible, 2);
  const bug = report.bugs[0];
  assert.equal(bug.id, f.bug.id);
  assert.equal(bug.fix.commit, f.commit);
  assert.equal(new Date(bug.fix.committed_at).getTime(), new Date(f.committedAt).getTime());
  assert.equal(bug.counts.distinct_incidents, 3);
  assert.equal(bug.counts.distinct_sessions, 2);
  assert.equal(bug.counts.pre_fix, 1);
  assert.equal(bug.counts.post_fix_possible, 2);
  assert.equal(bug.counts.undated, 0);
  assert.match(bug.signature.sha256, /^[a-f0-9]{64}$/);
  assert.equal(bug.signature.sha256, hash(ERROR));
  assert.deepEqual(new Set(bug.incidents.map((i) => i.tool_use_id)), new Set(['tool-1', 'tool-2', 'tool-3']));
  for (const incident of bug.incidents) {
    assert.match(incident.id, /\S/);
    assert.equal(incident.tool_name, 'Bash');
    assert.ok(['pre_fix', 'post_fix_possible'].includes(incident.classification));
    assert.equal(incident.classification, incident.tool_use_id === 'tool-1' ? 'pre_fix' : 'post_fix_possible');
    const source = incident.source;
    assert.ok(Number.isSafeInteger(source.byte_offset) && source.byte_offset >= 0);
    assert.ok(Number.isSafeInteger(source.byte_length) && source.byte_length > 0);
    const sourceFile = path.resolve(f.project, source.path);
    assert.ok(sourceFile.startsWith(`${f.transcripts}${path.sep}`));
    const bytes = fs.readFileSync(sourceFile).subarray(source.byte_offset, source.byte_offset + source.byte_length);
    assert.equal(hash(bytes), source.record_sha256);
    const parsed = JSON.parse(bytes.toString('utf8').trim());
    assert.equal(parsed.type, 'user');
    assert.equal(parsed.message.content[0].tool_use_id, incident.tool_use_id);
  }
  assert.ok(report.coverage.files_scanned >= 2);
  assert.ok(report.coverage.duplicate_incidents >= 3);
  assert.ok(Array.isArray(report.diagnostics));
  assertNoRawEvidence(report);
  assert.deepEqual(fs.readFileSync(f.ledger), before);
  assert.deepEqual(fs.readFileSync(original), transcriptBefore);
}));

test('only explicit failed results of direct tools and the exact owning cwd count', () => withFixture((f) => {
  const foreign = createTmpFixture('ow-ledger-test-');
  try {
    fs.mkdirSync(path.join(foreign, '.wolf'));
    fs.mkdirSync(path.join(f.project, 'nested', '.wolf'), { recursive: true });
    const valid = [assistant(f.project, 's', 'valid', AFTER), result(f.project, 's', 'valid', AFTER)];
    const noError = result(f.project, 's', 'not-error', AFTER);
    noError.message.content[0].is_error = false;
    const absentFlag = result(f.project, 's', 'absent-flag', AFTER);
    delete absentFlag.message.content[0].is_error;
    writeTranscript(f.transcripts, 'scope.jsonl', [
      ...valid,
      assistant(f.project, 's', 'not-error', AFTER), noError,
      assistant(f.project, 's', 'absent-flag', AFTER), absentFlag,
      assistant(foreign, 's', 'foreign', AFTER), result(foreign, 's', 'foreign', AFTER),
      assistant(path.join(f.project, 'nested'), 's', 'nested', AFTER), result(path.join(f.project, 'nested'), 's', 'nested', AFTER),
      assistant(f.project, 's', 'sidechain', AFTER, { isSidechain: true, agentId: 'subagent-1' }),
      result(f.project, 's', 'sidechain', AFTER, ERROR, { isSidechain: true, agentId: 'subagent-1' }),
      { type: 'progress', sessionId: 's', cwd: f.project, message: { content: [result(f.project, 's', 'embedded', AFTER).message.content[0]] } },
      { type: 'user', sessionId: 's', cwd: f.project, timestamp: AFTER, message: { role: 'user', content: `Tool failed: ${ERROR}` } },
    ]);
    const report = scopedReport(f);
    assert.equal(report.summary.distinct_incidents, 1);
    assert.deepEqual(allIncidents(report).map((i) => i.tool_use_id), ['valid']);
    assertNoRawEvidence(report);
  } finally { cleanupFixture(foreign); }
}));

test('missing timestamp is undated despite a newer file mtime; timestamp at commit is pre-fix', () => withFixture((f) => {
  const atCommit = assistant(f.project, 's', 'boundary', FIXED_AT);
  const atCommitResult = result(f.project, 's', 'boundary', FIXED_AT);
  const undated = result(f.project, 's', 'undated', null);
  const undatedUse = assistant(f.project, 's', 'undated');
  delete undatedUse.timestamp;
  const file = writeTranscript(f.transcripts, 'times.jsonl', [atCommit, atCommitResult, undatedUse, undated]);
  fs.utimesSync(file, new Date('2026-10-01'), new Date('2026-10-01'));
  const report = scopedReport(f);
  assert.equal(report.bugs[0].counts.pre_fix, 1);
  assert.equal(report.bugs[0].counts.undated, 1);
  assert.equal(report.bugs[0].counts.post_fix_possible, 0);
  assert.equal(report.bugs[0].incidents.find((i) => i.tool_use_id === 'undated').occurred_at, null);
}));

test('literal override is bug-scoped, whitespace-normalized, and does not normalize numbers', () => withFixture((f) => {
  const phrase = 'timeout 42 while opening socket';
  writeTranscript(f.transcripts, 'literal.jsonl', [
    assistant(f.project, 's', 'literal', AFTER), result(f.project, 's', 'literal', AFTER, 'timeout  42\nwhile opening socket'),
    assistant(f.project, 's', 'changed-number', AFTER), result(f.project, 's', 'changed-number', AFTER, 'timeout 43 while opening socket'),
    assistant(f.project, 's', 'regex-like', AFTER), result(f.project, 's', 'regex-like', AFTER, 'timeout.* while opening socket'),
  ]);
  const defaultReport = scopedReport(f);
  assert.equal(defaultReport.summary.distinct_incidents, 0);
  const report = jsonRun(f.project, f.transcripts, ['--bug', f.bug.id, '--match', phrase]);
  assert.equal(report.summary.distinct_incidents, 1);
  assert.deepEqual(allIncidents(report).map((i) => i.tool_use_id), ['literal']);
  assert.equal(report.bugs[0].signature.sha256, hash(phrase));
  assertNoRawEvidence(report);
}));

test('archived resolved bugs participate; open bug requires explicit selection and cannot imply a verified fix', () => withFixture((f) => {
  fs.mkdirSync(path.join(f.project, '.wolf', 'archive'));
  const open = { id: 'bug-202', status: 'open', error_message: 'Different explicit test failure', commit: null, reduction: null };
  fs.writeFileSync(f.ledger, JSON.stringify({ version: 1, bugs: [open] }));
  fs.writeFileSync(path.join(f.project, '.wolf', 'archive', 'buglog-2026-09.json'), JSON.stringify([f.bug]));
  writeTranscript(f.transcripts, 'archive.jsonl', [
    assistant(f.project, 's', 'archived', AFTER), result(f.project, 's', 'archived', AFTER),
    assistant(f.project, 's', 'open', AFTER), result(f.project, 's', 'open', AFTER, open.error_message),
  ]);
  const defaultReport = scopedReport(f);
  assert.equal(defaultReport.summary.bugs_considered, 1);
  assert.deepEqual(defaultReport.bugs.map((b) => b.id), [f.bug.id]);
  assert.equal(defaultReport.summary.post_fix_possible, 1);
  const requested = jsonRun(f.project, f.transcripts, ['--bug', 'bug-202']);
  assert.equal(requested.summary.distinct_incidents, 1);
  assert.equal(requested.summary.post_fix_possible, 0);
  assert.equal(requested.bugs[0].counts.unverified_fix, 1);
  assert.equal(requested.bugs[0].incidents[0].classification, 'unverified_fix');
}));

test('conflicting identical incident identities are skipped, diagnosed and never double counted', () => withFixture((f) => {
  writeTranscript(f.transcripts, 'first.jsonl', [assistant(f.project, 'same-session', 'same', AFTER), result(f.project, 'same-session', 'same', AFTER)]);
  writeTranscript(f.transcripts, 'conflict.jsonl', [assistant(f.project, 'same-session', 'same', BEFORE), result(f.project, 'same-session', 'same', BEFORE, `${ERROR} SECRET_TRANSCRIPT_SENTINEL`)]);
  const report = scopedReport(f);
  assert.equal(report.summary.distinct_incidents, 0);
  assert.ok(report.diagnostics.length > 0);
  assertNoRawEvidence(report);
}));

test('bounded tail scan reports incomplete coverage without promoting skipped prefixes', () => withFixture((f) => {
  const file = path.join(f.transcripts, 'large.jsonl');
  const first = JSON.stringify(result(f.project, 's', 'prefix', AFTER));
  const suffix = [assistant(f.project, 's', 'tail', AFTER), result(f.project, 's', 'tail', AFTER)].map(JSON.stringify).join('\n');
  fs.writeFileSync(file, `${first}\n${'x'.repeat(9000)}\n${suffix}\n`);
  const report = jsonRun(f.project, f.transcripts, ['--max-file-bytes', '2048'], 2);
  assert.equal(report.complete, false);
  assert.ok(report.coverage.truncated_files >= 1);
  assert.equal(report.summary.distinct_incidents, 1);
  assert.deepEqual(allIncidents(report).map((i) => i.tool_use_id), ['tail']);
  const source = allIncidents(report)[0].source;
  const bytes = fs.readFileSync(source.path).subarray(source.byte_offset, source.byte_offset + source.byte_length);
  assert.equal(hash(bytes), source.record_sha256);
  assert.equal(JSON.parse(bytes.toString('utf8')).message.content[0].tool_use_id, 'tail');
  assertNoRawEvidence(report);
}));

test('malformed and symlink transcript sources degrade coverage, never execute or emit their contents', () => withFixture((f) => {
  fs.writeFileSync(path.join(f.transcripts, 'invalid.jsonl'), '{ invalid SECRET_TRANSCRIPT_SENTINEL\n');
  const external = createTmpFixture('ow-ledger-test-');
  try {
    const target = writeTranscript(external, 'outside.jsonl', [assistant(f.project, 'outside', 'outside', AFTER), result(f.project, 'outside', 'outside', AFTER)]);
    fs.symlinkSync(target, path.join(f.transcripts, 'linked.jsonl'));
    const report = scopedReport(f);
    assert.equal(report.complete, false);
    assert.equal(report.summary.distinct_incidents, 0);
    assert.ok(report.coverage.malformed_records >= 1);
    assertNoRawEvidence(report);
  } finally { cleanupFixture(external); }
}));

test('invalid options fail closed; conflicting IDs degrade default coverage but reject explicit selection', () => withFixture((f) => {
  const invalidOptions = [
    ['--match', ERROR], ['--bug', f.bug.id, '--match', 'short'],
    ['--max-files', '0'], ['--max-file-bytes', '-1'],
    ['--max-total-bytes', '1.5'], ['--max-files', '9007199254740992'],
    ['--bug', 'bug-nonexistent'],
  ];
  for (const options of invalidOptions) {
    const child = run(f.project, f.transcripts, options);
    assert.equal(child.status, 1, `${options.join(' ')}: ${child.stderr}\n${child.stdout}`);
  }
  const unaffected = { ...f.bug, id: 'bug-102', error_message: 'Separate stable archive failure' };
  fs.writeFileSync(f.ledger, JSON.stringify({ version: 1, bugs: [f.bug, unaffected] }));
  const twin = { ...f.bug, error_message: 'Another resolved failure in archive' };
  fs.mkdirSync(path.join(f.project, '.wolf', 'archive'));
  fs.writeFileSync(path.join(f.project, '.wolf', 'archive', 'buglog-2026-08.json'), JSON.stringify({ version: 1, bugs: [twin] }));
  writeTranscript(f.transcripts, 'ambiguity.jsonl', [
    assistant(f.project, 's', 'ambiguous', AFTER), result(f.project, 's', 'ambiguous', AFTER),
    assistant(f.project, 's', 'safe', AFTER), result(f.project, 's', 'safe', AFTER, unaffected.error_message),
  ]);
  const before = fs.readFileSync(f.ledger);
  const report = jsonRun(f.project, f.transcripts, [], 2);
  assert.equal(report.complete, false);
  assert.ok(report.ledger_coverage.ambiguous_ids.includes(f.bug.id));
  assert.deepEqual(report.bugs.map((b) => b.id), [unaffected.id]);
  assert.equal(report.summary.distinct_incidents, 1);
  assert.deepEqual(allIncidents(report).map((i) => i.tool_use_id), ['safe']);
  assert.ok(report.diagnostics.length > 0);
  assertNoRawEvidence(report);
  assert.equal(run(f.project, f.transcripts, ['--bug', f.bug.id]).status, 1);
  assert.deepEqual(fs.readFileSync(f.ledger), before);
}));

test('identical live/archive decision tuples coalesce without inflating unique incidents', () => withFixture((f) => {
  fs.mkdirSync(path.join(f.project, '.wolf', 'archive'));
  fs.writeFileSync(path.join(f.project, '.wolf', 'archive', 'buglog-2026-08.json'), JSON.stringify([f.bug]));
  writeTranscript(f.transcripts, 'single.jsonl', [assistant(f.project, 's', 'once', AFTER), result(f.project, 's', 'once', AFTER)]);
  const report = jsonRun(f.project, f.transcripts);
  assert.equal(report.complete, true);
  assert.deepEqual(report.ledger_coverage.ambiguous_ids, []);
  assert.equal(report.summary.bugs_considered, 1);
  assert.equal(report.summary.distinct_incidents, 1);
  assert.equal(report.bugs[0].counts.distinct_incidents, 1);
  assert.deepEqual(allIncidents(report).map((i) => i.tool_use_id), ['once']);
}));

test('ledger decision tuple rejects one-field conflicts but coalesces changing observation metadata', () => withFixture((f) => {
  fs.mkdirSync(path.join(f.project, '.wolf', 'archive'));
  const archived = path.join(f.project, '.wolf', 'archive', 'buglog-2026-08.json');
  writeTranscript(f.transcripts, 'decision.jsonl', [assistant(f.project, 's', 'call', AFTER), result(f.project, 's', 'call', AFTER)]);
  for (const [field, value] of [
    ['file', 'different.js'],
    ['commit', f.commit.slice(0, 7)],
    ['reduction', '.wolf/qa/other.md'],
    ['status', 'open'],
    ['error_message', 'Different recorded failure text'],
  ]) {
    fs.writeFileSync(archived, JSON.stringify({ version: 1, bugs: [{ ...f.bug, [field]: value }] }));
    const report = jsonRun(f.project, f.transcripts, [], 2);
    assert.equal(report.complete, false, `${field} conflict must degrade coverage`);
    assert.ok(report.ledger_coverage.ambiguous_ids.includes(f.bug.id), `${field} conflict must name its ID`);
    assert.equal(report.summary.distinct_incidents, 0, `${field} conflict must not count evidence`);
    assert.ok(!report.bugs.some((bug) => bug.id === f.bug.id));
    assert.equal(run(f.project, f.transcripts, ['--bug', f.bug.id]).status, 1, `${field} explicit selection must fail`);
  }
  fs.writeFileSync(archived, JSON.stringify([{ ...f.bug, occurrences: 99, last_seen: '2026-10-03T00:00:00Z' }]));
  const coalesced = jsonRun(f.project, f.transcripts);
  assert.equal(coalesced.complete, true);
  assert.deepEqual(coalesced.ledger_coverage.ambiguous_ids, []);
  assert.equal(coalesced.ledger_coverage.coalesced_copies, 1);
  assert.equal(coalesced.summary.distinct_incidents, 1);
  assert.equal(coalesced.bugs[0].counts.distinct_incidents, 1);
}));

test('unsupported current-owner transcript structures report parser coverage rather than silently no-matching', () => withFixture((f) => {
  const wrongShape = assistant(f.project, 's', 'shape');
  wrongShape.message.content = { type: 'tool_use', id: 'shape', name: 'Bash' };
  const wrongRole = assistant(f.project, 's', 'role');
  wrongRole.message.role = 'user';
  const nullBlock = assistant(f.project, 's', 'null');
  nullBlock.message.content = [null];
  const untaggedBlock = assistant(f.project, 's', 'untagged');
  untaggedBlock.message.content = [{ text: 'untagged content' }];
  const serverTool = assistant(f.project, 's', 'server');
  serverTool.message.content = [{ type: 'server_tool_use', id: 'server', name: 'web_search' }];
  writeTranscript(f.transcripts, 'unsupported.jsonl', [wrongShape, wrongRole, nullBlock, untaggedBlock, serverTool]);
  const report = jsonRun(f.project, f.transcripts, [], 2);
  assert.equal(report.complete, false);
  assert.equal(report.summary.distinct_incidents, 0);
  assert.ok(report.coverage.unsupported_records >= 5);
  const codes = new Set(report.diagnostics.map((d) => d.code));
  assert.ok(codes.has('unsupported-message-shape'));
  assert.ok(codes.has('unsupported-content-block'));
  assertNoRawEvidence(report);
}));

test('unsupported foreign-project records do not degrade owner coverage', () => withFixture((f) => {
  const foreign = createTmpFixture('ow-ledger-test-');
  try {
    fs.mkdirSync(path.join(foreign, '.wolf'));
    const wrongShape = assistant(foreign, 'foreign-session', 'shape');
    wrongShape.message.content = { type: 'tool_use', id: 'shape', name: 'Bash' };
    const wrongRole = assistant(foreign, 'foreign-session', 'role');
    wrongRole.message.role = 'user';
    const serverTool = assistant(foreign, 'foreign-session', 'server');
    serverTool.message.content = [{ type: 'server_tool_use', id: 'server', name: 'web_search' }];
    writeTranscript(f.transcripts, 'foreign.jsonl', [wrongShape, wrongRole, serverTool]);
    const report = jsonRun(f.project, f.transcripts);
    assert.equal(report.complete, true);
    assert.equal(report.summary.distinct_incidents, 0);
    assert.ok(report.coverage.foreign_records >= 3);
    assert.deepEqual(report.diagnostics, []);
    assertNoRawEvidence(report);
  } finally { cleanupFixture(foreign); }
}));

test('excluded session and file-count cap produce honest independent coverage', () => withFixture((f) => {
  writeTranscript(f.transcripts, 'one.jsonl', [assistant(f.project, 'skip-me', 'one', AFTER), result(f.project, 'skip-me', 'one', AFTER)]);
  writeTranscript(f.transcripts, 'two.jsonl', [assistant(f.project, 'keep-me', 'two', AFTER), result(f.project, 'keep-me', 'two', AFTER)]);
  const excluded = jsonRun(f.project, f.transcripts, ['--exclude-session', 'skip-me']);
  assert.equal(excluded.complete, true);
  assert.equal(excluded.summary.distinct_incidents, 1);
  assert.deepEqual(allIncidents(excluded).map((i) => i.session_id), ['keep-me']);
  const capped = jsonRun(f.project, f.transcripts, ['--max-files', '1'], 2);
  assert.equal(capped.complete, false);
  assert.equal(capped.coverage.files_scanned, 1);
  assert.ok(capped.summary.distinct_incidents <= 1);
}));

test('identical scan inputs yield stable report counts and incident identities', () => withFixture((f) => {
  writeTranscript(f.transcripts, 'stable.jsonl', [assistant(f.project, 'stable-session', 'stable-call', AFTER), result(f.project, 'stable-session', 'stable-call', AFTER)]);
  const first = jsonRun(f.project, f.transcripts);
  const second = jsonRun(f.project, f.transcripts);
  assert.equal(first.complete, true);
  assert.equal(first.summary.distinct_incidents, 1);
  assert.deepEqual(second.summary, first.summary);
  assert.deepEqual(allIncidents(second).map((i) => i.id), allIncidents(first).map((i) => i.id));
  assert.deepEqual(second.coverage, first.coverage);
}));

test('empty successful result and success with error prose are never inferred failures', () => withFixture((f) => {
  const empty = result(f.project, 's', 'empty-success', AFTER, '');
  empty.message.content[0].is_error = false;
  const prose = result(f.project, 's', 'prose-success', AFTER, `Error: ${ERROR}`);
  prose.message.content[0].is_error = false;
  writeTranscript(f.transcripts, 'success.jsonl', [
    assistant(f.project, 's', 'empty-success', AFTER), empty,
    assistant(f.project, 's', 'prose-success', AFTER), prose,
  ]);
  const report = jsonRun(f.project, f.transcripts);
  assert.equal(report.complete, true);
  assert.equal(report.summary.distinct_incidents, 0);
  assert.equal(report.coverage.successful_results, 2);
  assert.deepEqual(allIncidents(report), []);
  assertNoRawEvidence(report);
}));

test('missing or invalid fix proof cannot promote an after-date incident to post-fix', () => withFixture((f) => {
  writeTranscript(f.transcripts, 'after.jsonl', [assistant(f.project, 's', 'after', AFTER), result(f.project, 's', 'after', AFTER)]);
  const proofVariants = [
    { commit: null, reduction: f.bug.reduction },
    { commit: 'deadbee', reduction: f.bug.reduction },
    { commit: f.commit, reduction: null },
    { commit: f.commit, reduction: '../outside-project.md' },
  ];
  for (const proof of proofVariants) {
    fs.writeFileSync(f.ledger, JSON.stringify({ version: 1, bugs: [{ ...f.bug, ...proof }] }));
    const report = scopedReport(f, { bugId: f.bug.id });
    assert.equal(report.summary.distinct_incidents, 1);
    assert.equal(report.summary.evaluable_fixes, 0);
    assert.equal(report.summary.post_fix_possible, 0);
    assert.equal(report.bugs[0].fix.status, 'unverified');
    assert.equal(report.bugs[0].counts.unverified_fix, 1);
    assert.equal(report.bugs[0].incidents[0].classification, 'unverified_fix');
  }
}));

test('unsupported tool content degrades coverage but ordinary conversation is a complete no-match', () => withFixture((f) => {
  const conversation = { type: 'user', sessionId: 's', cwd: f.project, timestamp: AFTER, message: { role: 'user', content: 'What failed in this build?' } };
  const file = writeTranscript(f.transcripts, 'conversation.jsonl', [conversation]);
  const clean = jsonRun(f.project, f.transcripts);
  assert.equal(clean.complete, true);
  assert.equal(clean.summary.distinct_incidents, 0);
  assert.deepEqual(clean.diagnostics, []);
  const unsupported = result(f.project, 's', 'unsupported', AFTER);
  unsupported.message.content[0].content = [{ type: 'image', data: ERROR }];
  fs.writeFileSync(file, [conversation, assistant(f.project, 's', 'unsupported', AFTER), unsupported].map(JSON.stringify).join('\n') + '\n');
  const report = jsonRun(f.project, f.transcripts, [], 2);
  assert.equal(report.complete, false);
  assert.equal(report.summary.distinct_incidents, 0);
  assert.ok(report.coverage.unsupported_records >= 1);
  assert.ok(report.diagnostics.some((d) => d.code === 'unsupported-error-content'));
  assertNoRawEvidence(report);
}));

test('orphan explicit failed tool_result is not an incident and reports incomplete attribution', () => withFixture((f) => {
  writeTranscript(f.transcripts, 'orphan.jsonl', [result(f.project, 's', 'orphan', AFTER)]);
  const report = jsonRun(f.project, f.transcripts, [], 2);
  assert.equal(report.complete, false);
  assert.equal(report.summary.distinct_incidents, 0);
  assert.equal(report.coverage.unattributed_results, 1);
  assert.ok(report.diagnostics.some((d) => d.code === 'unattributed-failure'));
  assert.deepEqual(allIncidents(report), []);
  assertNoRawEvidence(report);
}));
