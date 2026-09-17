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
  const m = line.match(/^[-*]\s+\[?(\d{4}-\d{2}-\d{2})\]?/);
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
