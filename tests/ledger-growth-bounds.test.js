/**
 * Regression suite for unbounded-ledger growth.
 *
 * Two mechanisms are covered, both added after a fleet project measured a
 * 206 KB cerebrum.md (66% Decision Log) and a buglog where 182 of 187 entries
 * were stuck at status=open with no resolved entry carrying proof:
 *
 *   1. rotateDatedBulletsInSection — the missing consumer for
 *      size_discipline.cerebrum.retention_days, which was plumbed through
 *      getSizeDisciplineConfig alongside every other sub-key but had no caller.
 *   2. closeBug — proof-bound closure, so the status field stays meaningful.
 *
 * Held to this suite's standard: fixtures are throwaway, and the positive
 * controls assert the mechanism ACTUALLY rotated/closed something. A no-op
 * that returns success proves nothing, which is precisely how an unconsumed
 * config key survives review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTmpFixture } from './lib/fixture-cleanup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const { rotateDatedBulletsInSection } = await import(
  path.join(repoRoot, 'src/utils/size-discipline.js')
);
const { closeBug } = await import(path.join(repoRoot, 'dist/src/buglog/bug-tracker.js'));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-17T00:00:00Z');

const getBulletDate = (line) => {
  const m = line.match(/^[-*]\s+(?:[*_`]{1,3}\s*)?\[?\(?(\d{4}-\d{2}-\d{2})\)?\]?/);
  return m ? `${m[1]}T00:00:00Z` : undefined;
};

function fixture() {
  const dir = createTmpFixture('ow-ledger-growth-');
  fs.mkdirSync(path.join(dir, '.wolf'), { recursive: true });
  return dir;
}

function section(txt, name) {
  const lines = txt.split('\n');
  const s = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (s === -1) return null;
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { e = i; break; }
  }
  return lines.slice(s, e).join('\n');
}
const bullets = (s) => (s || '').split('\n').filter((l) => /^[-*]\s+/.test(l));

function writeCerebrum(dir, decisionBullets) {
  const body = [
    '# Cerebrum',
    '',
    '## User Preferences',
    '',
    '- Always use tabs.',
    '',
    '## Do-Not-Repeat',
    '',
    '- [2020-01-01] Never force-push main.',
    '',
    '## Decision Log',
    '',
    ...decisionBullets,
    '',
  ].join('\n');
  const f = path.join(dir, '.wolf', 'cerebrum.md');
  fs.writeFileSync(f, body);
  return f;
}

const ROTATE_OPTS = (file) => ({
  file,
  sectionHeaderPattern: /^## Decision Log\s*$/,
  getBulletDate,
  retentionDays: 180,
  now: NOW,
});

test('rotates aged Decision Log bullets into the archive', () => {
  const dir = fixture();
  const old1 = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
  const old2 = new Date(NOW - 300 * DAY).toISOString().slice(0, 10);
  const fresh = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
  const file = writeCerebrum(dir, [
    `- [${old1}] Ancient decision one.`,
    `- ${old2}: Ancient decision two, alternate date style.`,
    `- [${fresh}] Recent decision.`,
  ]);

  const res = rotateDatedBulletsInSection(ROTATE_OPTS(file));

  // Positive control: the mechanism must actually have moved entries.
  assert.equal(res.archived, 2, 'expected both aged bullets archived');
  assert.ok(res.archivePath, 'expected an archive path');
  assert.ok(fs.existsSync(res.archivePath), 'archive file must exist on disk');

  const after = fs.readFileSync(file, 'utf-8');
  const kept = bullets(section(after, 'Decision Log'));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /Recent decision/);

  const archived = bullets(fs.readFileSync(res.archivePath, 'utf-8'));
  assert.equal(archived.length, 2);
  // Both date styles must rotate; a parser that handles only one silently
  // pins half the log live forever.
  assert.ok(archived.some((l) => /Ancient decision one/.test(l)));
  assert.ok(archived.some((l) => /alternate date style/.test(l)));
});

test('never rotates the governing sections or undated bullets', () => {
  const dir = fixture();
  const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
  const file = writeCerebrum(dir, [
    `- [${old}] Aged, eligible.`,
    '- Undated convention that must never age out.',
  ]);
  const before = fs.readFileSync(file, 'utf-8');

  const res = rotateDatedBulletsInSection(ROTATE_OPTS(file));
  assert.equal(res.archived, 1);

  const after = fs.readFileSync(file, 'utf-8');
  // Do-Not-Repeat carries a 2020 date; section-granular rotation would have
  // eaten it. Bullet-granular rotation must leave it byte-identical.
  for (const name of ['User Preferences', 'Do-Not-Repeat']) {
    assert.equal(section(after, name), section(before, name), `${name} must be untouched`);
  }
  const kept = bullets(section(after, 'Decision Log'));
  assert.deepEqual(kept, ['- Undated convention that must never age out.']);
});

test('rotation conserves content and is idempotent', () => {
  const dir = fixture();
  const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
  const file = writeCerebrum(dir, [
    `- [${old}] Multi-line entry.`,
    '  Continuation line that belongs to it.',
    '',
    `- [${old}] Second aged entry.`,
  ]);
  const beforeBullets = bullets(section(fs.readFileSync(file, 'utf-8'), 'Decision Log'));

  const res = rotateDatedBulletsInSection(ROTATE_OPTS(file));
  assert.equal(res.archived, 2);

  const archiveTxt = fs.readFileSync(res.archivePath, 'utf-8');
  // Continuation lines must travel with their bullet, or multi-line entries
  // get silently truncated on rotation.
  assert.match(archiveTxt, /Continuation line that belongs to it/);

  const after = fs.readFileSync(file, 'utf-8');
  const all = new Set(
    [...bullets(section(after, 'Decision Log')), ...bullets(archiveTxt)].map((s) => s.trim()),
  );
  for (const b of beforeBullets) {
    assert.ok(all.has(b.trim()), `bullet lost entirely: ${b}`);
  }

  const second = rotateDatedBulletsInSection(ROTATE_OPTS(file));
  assert.equal(second.archived, 0, 'second run must be a no-op');
});

test('rotation is a no-op when the section is absent or retention disabled', () => {
  const dir = fixture();
  const file = path.join(dir, '.wolf', 'cerebrum.md');
  fs.writeFileSync(file, '# Cerebrum\n\n## User Preferences\n\n- Tabs.\n');
  const before = fs.readFileSync(file, 'utf-8');
  assert.equal(rotateDatedBulletsInSection(ROTATE_OPTS(file)).archived, 0);
  assert.equal(fs.readFileSync(file, 'utf-8'), before);

  const dir2 = fixture();
  const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
  const file2 = writeCerebrum(dir2, [`- [${old}] Aged.`]);
  const before2 = fs.readFileSync(file2, 'utf-8');
  const res = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file2), retentionDays: 0 });
  assert.equal(res.archived, 0, 'retentionDays=0 must disable rotation, not archive everything');
  assert.equal(fs.readFileSync(file2, 'utf-8'), before2);
});

test('size bound evicts oldest-first when nothing is old enough to expire', () => {
  const dir = fixture();
  // 40 decisions, each one day apart -- every one far inside a 180-day window,
  // so the age bound alone would archive NOTHING while the file is 2x budget.
  const decisions = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(NOW - (i + 1) * DAY).toISOString().slice(0, 10);
    decisions.push(`- [${d}] Decision ${i} ${'x'.repeat(400)}`);
  }
  const file = writeCerebrum(dir, decisions);

  const ageOnly = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file) });
  assert.equal(ageOnly.archived, 0, 'precondition: age bound alone must be a no-op here');

  const res = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file), maxBytes: 8192 });
  assert.ok(res.archived > 0, 'size bound must evict when over budget');
  assert.equal(res.trigger, 'size');
  assert.ok(fs.statSync(file).size <= 8192, 'file must end up under budget');

  // Oldest-first: the newest decision survives, the oldest does not.
  const live = fs.readFileSync(file, 'utf-8');
  assert.match(live, /Decision 0 /, 'newest entry must be kept');
  assert.doesNotMatch(live, /Decision 39 /, 'oldest entry must be evicted first');
});

test('size bound is a no-op under budget, and age still fires over it', () => {
  const dir = fixture();
  const fresh = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
  const file = writeCerebrum(dir, [`- [${fresh}] Recent.`]);
  const before = fs.readFileSync(file, 'utf-8');
  const res = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file), maxBytes: 1024 * 1024 });
  assert.equal(res.archived, 0);
  assert.equal(fs.readFileSync(file, 'utf-8'), before);

  // Generous budget must not disable the age sweep.
  const dir2 = fixture();
  const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
  const file2 = writeCerebrum(dir2, [`- [${old}] Ancient.`, `- [${fresh}] Recent.`]);
  const res2 = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file2), maxBytes: 1024 * 1024 });
  assert.equal(res2.archived, 1);
  assert.equal(res2.trigger, 'age');
});

test('size bound works with no age bound, and never evicts undated entries', () => {
  const dir = fixture();
  const decisions = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(NOW - (i + 1) * DAY).toISOString().slice(0, 10);
    decisions.push(`- [${d}] Decision ${i} ${'x'.repeat(400)}`);
  }
  const file = writeCerebrum(dir, decisions);
  const res = rotateDatedBulletsInSection({
    file, sectionHeaderPattern: /^## Decision Log\s*$/, getBulletDate,
    maxBytes: 8192, now: NOW,
  });
  assert.ok(res.archived > 0, 'maxBytes alone must be sufficient configuration');
  assert.ok(fs.statSync(file).size <= 8192);

  // An undated entry cannot be proven stale, so it is never size-evicted even
  // when that leaves the file over budget.
  const dir2 = fixture();
  const file2 = writeCerebrum(dir2, [`- Undated standing convention ${'y'.repeat(9000)}`]);
  const res2 = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file2), maxBytes: 1024 });
  assert.equal(res2.archived, 0);
  assert.match(fs.readFileSync(file2, 'utf-8'), /Undated standing convention/);
});

test('refuses a sweep it cannot complete', () => {
  const dir = fixture();
  // A single huge governing entry puts the file over budget on its own, so no
  // amount of Decision Log eviction can reach the target. Stripping the log bare
  // would cost every decision and still miss -- the worst possible trade.
  const fresh = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
  const file = writeCerebrum(dir, [`- [${fresh}] Decision ${'x'.repeat(200)}`]);
  const bloat = `\n## Key Learnings\n\n- ${'z'.repeat(20000)}\n`;
  fs.appendFileSync(file, bloat);
  const before = fs.readFileSync(file, 'utf-8');

  const res = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file), maxBytes: 4096 });
  assert.equal(res.archived, 0, 'must not evict when the budget is unreachable');
  assert.equal(fs.readFileSync(file, 'utf-8'), before, 'file must be untouched');
});

test('parses the date spellings that appear in real ledgers', () => {
  const dir = fixture();
  const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
  // Five spellings measured across 97 fleet projects. A parser handling only
  // the bracketed/colon forms read 46% of real entries as undated, so they
  // could never rotate -- invisible in unit tests written in the parser's own
  // preferred style, which is exactly how this shipped the first time.
  const file = writeCerebrum(dir, [
    `- [${old}] Bracketed.`,
    `- ${old}: Colon.`,
    `- **${old} — Bold em-dash.`,
    `- **[${old}]** Bold bracketed.`,
    `- **(${old})** Bold parenthesised.`,
  ]);
  const res = rotateDatedBulletsInSection(ROTATE_OPTS(file));
  assert.equal(res.archived, 5, 'every real-world date spelling must be eligible');
});

test('does not treat a mid-sentence or indented date as a bullet date', () => {
  const dir = fixture();
  const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
  const file = writeCerebrum(dir, [
    `- Refers to ${old} in passing, but is itself undated.`,
    `- **Bold prose** mentioning ${old} later.`,
  ]);
  const before = fs.readFileSync(file, 'utf-8');
  const res = rotateDatedBulletsInSection(ROTATE_OPTS(file));
  // Loosening the parser must not make prose evictable.
  assert.equal(res.archived, 0, 'a date must START the bullet to count');
  assert.equal(fs.readFileSync(file, 'utf-8'), before);
});

test('reports an unreachable budget instead of failing silently', () => {
  const dir = fixture();
  // Weight sits in a governing section, so no amount of Decision Log eviction
  // reaches the budget. Measured fleet-wide, 12 of 14 over-budget projects are
  // in exactly this state -- a silent no-op there is indistinguishable from a
  // broken mechanism, which is how the original scaling report got filed.
  const fresh = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
  const file = writeCerebrum(dir, [`- [${fresh}] Decision ${'x'.repeat(200)}`]);
  fs.appendFileSync(file, `\n## Key Learnings\n\n- ${'z'.repeat(20000)}\n`);

  const res = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file), maxBytes: 4096 });
  assert.equal(res.archived, 0, 'must still decline the futile sweep');
  assert.ok(res.overBudget, 'must report WHY nothing happened');
  assert.equal(res.overBudget.maxBytes, 4096);
  assert.ok(res.overBudget.floorBytes > 4096, 'floor must exceed the budget');
  assert.ok(
    res.overBudget.eligibleBytes < res.overBudget.bytes - res.overBudget.floorBytes + 1,
    'eligible bytes must exclude the untouchable floor',
  );
});

test('does not report overBudget when rotation succeeds or is unnecessary', () => {
  // Reachable: eviction gets under budget, so there is nothing to escalate.
  const dir = fixture();
  const decisions = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(NOW - (i + 1) * DAY).toISOString().slice(0, 10);
    decisions.push(`- [${d}] Decision ${i} ${'x'.repeat(400)}`);
  }
  const file = writeCerebrum(dir, decisions);
  const res = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file), maxBytes: 8192 });
  assert.ok(res.archived > 0);
  assert.equal(res.overBudget, null, 'a successful sweep must not nag');

  // Already under budget: also nothing to escalate.
  const dir2 = fixture();
  const fresh = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
  const file2 = writeCerebrum(dir2, [`- [${fresh}] Recent.`]);
  const res2 = rotateDatedBulletsInSection({ ...ROTATE_OPTS(file2), maxBytes: 1024 * 1024 });
  assert.equal(res2.archived, 0);
  assert.equal(res2.overBudget, null);
});

function writeBuglog(dir, bugs) {
  const f = path.join(dir, '.wolf', 'buglog.json');
  fs.writeFileSync(f, JSON.stringify({ version: 1, bugs }, null, 2));
  return f;
}
const mkBug = (id, over = {}) => ({
  id, timestamp: '2026-01-01T00:00:00Z', error_message: `failure ${id}`,
  file: 'a.js', root_cause: 'rc', fix: 'f', tags: [], related_bugs: [],
  occurrences: 1, last_seen: '2026-01-01T00:00:00Z',
  commit: null, reduction: null, status: 'open', ...over,
});

test('closeBug binds resolution to proof', () => {
  const dir = fixture();
  const f = writeBuglog(dir, [mkBug('bug-001')]);
  const wolf = path.join(dir, '.wolf');

  const res = closeBug(wolf, 'bug-001', { commit: 'abc1234', reduction: '.wolf/qa/f.md' });
  assert.equal(res.ok, true);

  const entry = JSON.parse(fs.readFileSync(f, 'utf-8')).bugs[0];
  assert.equal(entry.status, 'resolved');
  assert.equal(entry.commit, 'abc1234');
  assert.equal(entry.reduction, '.wolf/qa/f.md');
});

test('closeBug refuses proofless closure without mutating the log', () => {
  const dir = fixture();
  const f = writeBuglog(dir, [mkBug('bug-001')]);
  const before = fs.readFileSync(f, 'utf-8');

  const res = closeBug(path.join(dir, '.wolf'), 'bug-001', {});
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'missing-proof');
  assert.deepEqual(res.missing, ['commit', 'reduction']);
  // A refused close that still wrote would be worse than no check at all.
  assert.equal(fs.readFileSync(f, 'utf-8'), before, 'log must be byte-identical after refusal');

  const partial = closeBug(path.join(dir, '.wolf'), 'bug-001', { commit: 'abc' });
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missing, ['reduction'], 'partial proof is still insufficient');
});

test('closeBug --force records the gap it was forced through', () => {
  const dir = fixture();
  const f = writeBuglog(dir, [mkBug('bug-001')]);
  const res = closeBug(path.join(dir, '.wolf'), 'bug-001', { force: true });
  assert.equal(res.ok, true);
  assert.deepEqual(res.missing, ['commit', 'reduction'], 'forced close must report what is missing');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf-8')).bugs[0].status, 'resolved');
});

test('closeBug preserves existing proof and reports unknown ids', () => {
  const dir = fixture();
  const f = writeBuglog(dir, [mkBug('bug-001', { commit: 'existing', reduction: 'r.md' })]);
  const wolf = path.join(dir, '.wolf');

  // Closing with no flags must reuse proof already on the entry, not wipe it.
  const res = closeBug(wolf, 'bug-001', {});
  assert.equal(res.ok, true);
  const entry = JSON.parse(fs.readFileSync(f, 'utf-8')).bugs[0];
  assert.equal(entry.commit, 'existing');
  assert.equal(entry.reduction, 'r.md');

  assert.equal(closeBug(wolf, 'bug-404', { commit: 'a', reduction: 'b' }).reason, 'not-found');
});

// ═══ REACHABILITY, NOT JUST CORRECTNESS ════════════════════════════════════
// Every test above exercises rotateDatedBulletsInSection directly, and all of
// them passed while the primitive did NOTHING on a real project for an entire
// session: the call site sat inside `if (writeCount > 0)`, below a zero-
// activity early return, so a cerebrum 108048 bytes over budget was never
// swept. A unit test on the primitive cannot catch a call site that is never
// reached. These drive the SHIPPED stop.js as a subprocess and assert the file
// on disk actually changed.
//
// Both gates are covered deliberately: the reported failure was zero-activity,
// but a read-only session (reads > 0, writes === 0) was equally unreachable.

// GLM review, CONFIRMED by falsifier: re-gating the call site in src/ WITHOUT
// rebuilding left this entire suite green. The tests spawn dist/, and nothing
// rebuilt it — so a regression merged on a green run would ship on the next
// build. `npm test` has no pretest build step. Fail loudly instead.
test('dist/ is not stale relative to src/ (else this whole suite is theatre)', () => {
  const pairs = [['src/hooks/stop.js', 'dist/src/hooks/stop.js'],
                 ['src/utils/size-discipline.js', 'dist/src/utils/size-discipline.js']];
  for (const [srcRel, distRel] of pairs) {
    const s = fs.statSync(path.join(repoRoot, srcRel));
    const d = fs.statSync(path.join(repoRoot, distRel));
    assert.ok(d.mtimeMs >= s.mtimeMs,
      `${distRel} is older than ${srcRel} — run npm run build. ` +
      `Every reachability assertion below runs against the STALE artifact.`);
  }
});

const STOP_HOOK = path.join(repoRoot, 'dist/src/hooks/stop.js');

/** A project whose cerebrum is over budget and whose Decision Log is the bulk. */
function hookProject(maxBytes, decisionBullets, extraSections = '') {
  const dir = fixture();
  const wolf = path.join(dir, '.wolf');
  fs.mkdirSync(path.join(wolf, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(wolf, 'config.json'), JSON.stringify({
    openwolf: {
      // Silence every unrelated rule so the fixture is stable and any nudge
      // text we assert on can only have come from the cerebrum path.
      review_hook: { enabled: false }, quality_gate: { enabled: false },
      claim_calibration: { enabled: false }, autonomy_continuation: { enabled: false },
      git_discipline: { enabled: false }, simplicity: { enabled: false },
      size_discipline: { enabled: true, cerebrum: { retention_days: 180, max_bytes: maxBytes } },
    },
  }, null, 2));
  const file = writeCerebrum(dir, decisionBullets);
  if (extraSections) fs.appendFileSync(file, extraSections);
  return { dir, wolf, file };
}

function runStopHook(dir, wolf, sessionId, activity) {
  fs.writeFileSync(path.join(wolf, 'hooks', '_session.json'), JSON.stringify({
    session_id: sessionId, started: '2026-09-17T10:00:00.000Z',
    files_read: {}, files_written: [], edit_counts: {},
    anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
    cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
    ...activity,
  }, null, 2));
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({
    type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  }) + '\n');
  const r = spawnSync(process.execPath, [STOP_HOOK], {
    cwd: dir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// The three session shapes, keyed by the gate each one used to be trapped
// behind. 'writes' is the control: it passed before the fix, so if it ever
// fails the fixture itself is broken rather than the gate.
const SESSION_SHAPES = {
  'zero-activity': { files_read: {}, files_written: [] },
  'read-only': {
    files_read: { '/tmp/x/a.js': { count: 1 } }, files_written: [],
  },
  'writes (control)': {
    files_written: [{ file: '/tmp/x/a.js', action: 'edit', tokens: 10, at: '2026-09-17T10:00:00.000Z' }],
  },
};

for (const [label, activity] of Object.entries(SESSION_SHAPES)) {
  test(`cerebrum rotation runs on a ${label} Stop`, () => {
    // 40 dated decisions, all inside the age window, so ONLY the size trigger
    // can rotate them — this cannot pass via the age sweep.
    const decisions = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(NOW - (i + 1) * DAY).toISOString().slice(0, 10);
      decisions.push(`- [${d}] Decision ${i} ${'x'.repeat(300)}`);
    }
    const { dir, wolf, file } = hookProject(8192, decisions);
    const before = fs.statSync(file).size;
    assert.ok(before > 8192, 'fixture precondition: must start over budget');

    runStopHook(dir, wolf, `sess-${label.replace(/\W+/g, '-')}`, activity);

    const after = fs.statSync(file).size;
    assert.ok(after < before, `cerebrum must shrink (${before} -> ${after})`);
    assert.ok(after <= 8192, `cerebrum must land within budget, got ${after}`);
    // Assert archive CONTENT, not just that a directory appeared: an empty dir
    // passed the old check, so any other rule that shrank cerebrum.md would have
    // satisfied this test without rotation ever running.
    const archDir = path.join(wolf, 'archive');
    assert.ok(fs.existsSync(archDir), 'archive must be written');
    const archived = fs.readdirSync(archDir).map((f) => fs.readFileSync(path.join(archDir, f), 'utf-8')).join('\n');
    assert.ok(archived.includes('Decision 39'),
      'the evicted bullet must be recoverable from the archive, not merely deleted');
    // The retained bullets must be the NEWEST ones: eviction is oldest-first,
    // so a correct sweep keeps day-1 and drops day-40.
    const kept = bullets(section(fs.readFileSync(file, 'utf-8'), 'Decision Log'));
    assert.ok(kept.some((l) => l.includes('Decision 0')), 'newest decision must survive');
    assert.ok(!kept.some((l) => l.includes('Decision 39')), 'oldest decision must be evicted');
  });
}

test('the over-budget diagnosis reaches a zero-activity Stop', () => {
  // Futile sweep: a governing section alone busts the budget, so archiving
  // every decision still cannot reach it. The hook must DIAGNOSE rather than
  // strip the Decision Log bare every run.
  const heavy = ['', '## Key Learnings', ''];
  for (let i = 0; i < 40; i++) heavy.push(`- Learning ${i} ${'z'.repeat(300)}`);
  const { dir, wolf, file } = hookProject(
    8192, [`- [2026-09-16] Recent decision.`], heavy.join('\n') + '\n',
  );
  const before = fs.readFileSync(file, 'utf-8');
  assert.ok(Buffer.byteLength(before) > 8192, 'fixture precondition: over budget');

  const out = runStopHook(dir, wolf, 'sess-futile', { files_read: {}, files_written: [] });

  // Pin to the emitter's OWN prose. '## Key Learnings' is a string the fixture
  // itself wrote into cerebrum.md, so matching only that could be satisfied by
  // any rule that echoed a section name.
  assert.match(out, /Wolfpack: \.wolf\/cerebrum\.md is/, 'the diagnosis itself must be emitted');
  assert.match(out, /Key Learnings/, 'the diagnosis must name the heaviest section');
  assert.equal(fs.readFileSync(file, 'utf-8'), before,
    'a futile sweep must leave the file byte-identical');
});

// GPT-5.5 and GLM-5.2 independently flagged the failure DIRECTION here, and a
// fleet probe confirmed it live: 96 of 97 projects shipped a shared.js whose
// cerebrum defaults omit max_bytes. maxBytes resolved to undefined, hasSize went
// false, and the size bound silently vanished — reporting trigger:'age',
// overBudget:null, i.e. indistinguishable from a healthy in-budget project.
// That is the same silent-no-op class as the original gate bug.
test('a configured-but-unusable budget is surfaced, not silently ignored', () => {
  for (const bad of [undefined, 0, NaN, 'lots']) {
    const dir = fixture();
    const file = writeCerebrum(dir, [`- [2026-09-16] Recent decision ${'x'.repeat(200)}`]);
    const r = rotateDatedBulletsInSection({
      file, sectionHeaderPattern: /^## Decision Log\s*$/, getBulletDate,
      retentionDays: 180, maxBytes: bad, archiveDir: path.join(dir, '.wolf', 'archive'),
    });
    if (bad === undefined) {
      // Genuinely "no budget configured" — age-only is correct, stay quiet.
      assert.equal(r.invalidBudget, null ?? undefined, 'absent budget must not be flagged invalid');
    } else {
      assert.ok(r.invalidBudget, `maxBytes=${String(bad)} must be reported as unusable`);
    }
  }
});

test('the unusable-budget warning reaches a real zero-activity Stop', () => {
  const { dir, wolf } = hookProject(0, [`- [2026-09-16] Recent decision.`]);
  const out = runStopHook(dir, wolf, 'sess-badbudget', { files_read: {}, files_written: [] });
  assert.match(out, /max_bytes is set but unusable/,
    'an unusable budget must be visible to the operator, not silently dropped');
});
