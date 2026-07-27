/**
 * Regression suite for the evidence-addressed nudge engine.
 *
 * Every test builds throwaway fixture projects under a temp dir — no test
 * touches live .wolf data.
 *
 * Two rules this suite holds itself to:
 *   - Concurrency tests spawn REAL OS processes, not promises in one process.
 *     An in-process "concurrency" test cannot exercise the TOCTOU window that
 *     the leased claim exists to close.
 *   - Fault-injection tests assert the injected failure ACTUALLY EXECUTED, not
 *     just that the user-visible outcome looked right. A bypassed injection
 *     produces a green test that proves nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = (p) => path.join(repoRoot, 'dist/src/hooks/nudges', p);
/** Directory URL-ish prefix for child drivers (trailing slash preserved). */
const NUDGE_DIR = path.join(repoRoot, 'dist/src/hooks/nudges').replace(/\\/g, '/') + '/';

/**
 * Launch N child processes GENUINELY concurrently and await them all.
 *
 * spawnSync would serialize the children, which cannot exercise the TOCTOU
 * window a leased claim exists to close — a serialized "concurrency" test
 * passes even against the naive read-check-write implementation.
 */
function spawnConcurrent(driver, argsList) {
  return Promise.all(argsList.map(args => new Promise((resolve) => {
    const child = spawn(process.execPath, [driver, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  })));
}

const stateMod = await import(N('state.js'));
const { computeFingerprint, readState, setDisposition, tryClaim, markEmitted,
        NUDGE_STATES, bumpLineageRound, writeStateOrThrow, nudgeStatePath,
        markLineageEscalated } = stateMod;
const { evaluate, makeCandidate, NUDGE_DEFAULTS, getNudgeConfig, rankCandidates } = await import(N('engine.js'));
const { resolveOwningProject, groupByOwner } = await import(N('project-scope.js'));
const cerebrumRule = await import(N('rules/cerebrum.js'));
const conclusionRule = await import(N('rules/conclusion.js'));
const reviewRule = await import(N('rules/review.js'));

// ── fixtures ────────────────────────────────────────────────────────────────

function tmp(prefix = 'ow-nudge-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Create a WolfPack project with a cerebrum of a chosen age. */
function makeProject(base, name, { cerebrumAgeHours = 1, cerebrumBody = '# Cerebrum\n' } = {}) {
  const root = path.join(base, name);
  const wolf = path.join(root, '.wolf');
  fs.mkdirSync(path.join(wolf, 'qa'), { recursive: true });
  fs.writeFileSync(path.join(wolf, 'config.json'), JSON.stringify({ version: 1, openwolf: {} }));
  const cere = path.join(wolf, 'cerebrum.md');
  fs.writeFileSync(cere, cerebrumBody);
  const when = new Date(Date.now() - cerebrumAgeHours * 3600_000);
  fs.utimesSync(cere, when, when);
  return { root, wolf, cerebrum: cere };
}

function writeFiles(root, names, body = 'export const x = 1;\n') {
  const out = [];
  for (const n of names) {
    const p = path.join(root, n);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    out.push(p);
  }
  return out;
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function cfg(over = {}) {
  return { ...NUDGE_DEFAULTS, ...over };
}

// ═══ 1. CROSS-PROJECT, OWNER FRESH ═════════════════════════════════════════
test('1. cross-project: all writes owned by B whose cerebrum is fresh → no nudge', () => {
  const base = tmp();
  const A = makeProject(base, 'driving-A', { cerebrumAgeHours: 46 });   // stale, but untouched
  const B = makeProject(base, 'owner-B', { cerebrumAgeHours: 46 });
  const writes = writeFiles(B.root, ['s1.ts', 's2.ts', 's3.ts', 's4.ts', 's5.ts', 's6.ts']);

  // B's cerebrum changed during the session: baseline differs from current.
  const baselines = { [B.cerebrum.replace(/\\/g, '/')]: 'baseline-hash-before-edit' };
  fs.writeFileSync(B.cerebrum, '# Cerebrum\n- learned something\n');

  const { candidates } = cerebrumRule.collect({ writes, baselines });
  assert.equal(candidates.length, 0,
    'owner B updated its cerebrum this session → silent; A must not be consulted at all');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 2. CROSS-PROJECT, OWNER STALE ═════════════════════════════════════════
test('2. cross-project: owner B stale+unchanged → exactly one nudge naming B, never A', () => {
  const base = tmp();
  const A = makeProject(base, 'driving-A', { cerebrumAgeHours: 46 });
  const B = makeProject(base, 'owner-B', { cerebrumAgeHours: 46 });
  const writes = writeFiles(B.root, ['s1.ts', 's2.ts', 's3.ts']);

  const { candidates } = cerebrumRule.collect({ writes, baselines: {} });
  assert.equal(candidates.length, 1, 'exactly one candidate');
  const c = candidates[0];
  assert.ok(c.owner_root.includes('owner-B'), `owner must be B, got ${c.owner_root}`);
  assert.ok(!c.reason.includes('driving-A'), 'must never name the driving project');
  assert.ok(c.reason.includes('owner-B'), 'message names the owning project');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 3. MIXED PROJECTS ═════════════════════════════════════════════════════
test('3. mixed projects: A fresh, B stale → B candidate only, no misattribution', () => {
  const base = tmp();
  const A = makeProject(base, 'proj-A', { cerebrumAgeHours: 1 });   // fresh
  const B = makeProject(base, 'proj-B', { cerebrumAgeHours: 50 });  // stale
  const writes = [
    ...writeFiles(A.root, ['a1.ts', 'a2.ts', 'a3.ts']),
    ...writeFiles(B.root, ['b1.ts', 'b2.ts', 'b3.ts']),
  ];

  const { candidates } = cerebrumRule.collect({ writes, baselines: {} });
  assert.equal(candidates.length, 1, 'only the stale owner produces a candidate');
  assert.ok(candidates[0].owner_root.includes('proj-B'));
  // And the evidence must contain ONLY B's files — not the whole session.
  assert.equal(candidates[0].evidence.written_files.length, 3);
  assert.ok(candidates[0].evidence.written_files.every(f => f.includes('proj-B')));
  fs.rmSync(base, { recursive: true, force: true });
});

test('3b. unattributed files never fall back to a driving project', () => {
  const base = tmp();
  const orphanDir = path.join(base, 'no-wolf-here');
  fs.mkdirSync(orphanDir, { recursive: true });
  const writes = writeFiles(orphanDir, ['x1.ts', 'x2.ts', 'x3.ts']);
  const { candidates, unattributed } = cerebrumRule.collect({ writes, baselines: {} });
  assert.equal(candidates.length, 0, 'no owner → no guess');
  assert.equal(unattributed.length, 3, 'ambiguity is recorded, not silently reassigned');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 4. IDENTICAL REPEATED STOP ════════════════════════════════════════════
test('4. ten identical Stops with unchanged evidence → emitted exactly once', () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const writes = writeFiles(P.root, ['a.ts', 'b.ts', 'c.ts']);
  let emissions = 0;

  for (let i = 0; i < 10; i++) {
    const { candidates } = cerebrumRule.collect({ writes, baselines: {} });
    const r = evaluate({ wolfDir: P.wolf, candidates, nudgeCfg: cfg(), sessionId: 'sess-1' });
    emissions += r.emitted.length;
  }
  assert.equal(emissions, 1, `expected 1 emission across 10 stops, got ${emissions}`);
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 5. EXPLICIT DISMISSAL ═════════════════════════════════════════════════
test('5. dismissal suppresses permanently across ten further Stops', () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const writes = writeFiles(P.root, ['a.ts', 'b.ts', 'c.ts']);

  const first = cerebrumRule.collect({ writes, baselines: {} });
  const r1 = evaluate({ wolfDir: P.wolf, candidates: first.candidates, nudgeCfg: cfg(), sessionId: 's1' });
  assert.equal(r1.emitted.length, 1);

  const disp = setDisposition(P.wolf, first.candidates[0].fingerprint, NUDGE_STATES.DISMISSED,
    { reason: 'not relevant' });
  assert.equal(disp.ok, true, 'dismissal must persist');

  let after = 0;
  for (let i = 0; i < 10; i++) {
    const { candidates } = cerebrumRule.collect({ writes, baselines: {} });
    // New session id each time — a dismissal must outlive the session.
    const r = evaluate({ wolfDir: P.wolf, candidates, nudgeCfg: cfg(), sessionId: `s${i + 2}` });
    after += r.emitted.length;
  }
  assert.equal(after, 0, `dismissed evidence must never re-emit, got ${after}`);
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 6. EVIDENCE CHANGE RE-ARMS ════════════════════════════════════════════
test('6. dismissing F1 does not suppress materially-changed evidence F2', () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const writes = writeFiles(P.root, ['a.ts', 'b.ts', 'c.ts']);

  const f1 = cerebrumRule.collect({ writes, baselines: {} });
  evaluate({ wolfDir: P.wolf, candidates: f1.candidates, nudgeCfg: cfg(), sessionId: 's1' });
  setDisposition(P.wolf, f1.candidates[0].fingerprint, NUDGE_STATES.DISMISSED, { reason: 'x' });

  // Materially change evidence: cerebrum content changes (still stale by mtime).
  fs.writeFileSync(P.cerebrum, '# Cerebrum\n- different content entirely\n');
  const old = new Date(Date.now() - 50 * 3600_000);
  fs.utimesSync(P.cerebrum, old, old);

  const f2 = cerebrumRule.collect({ writes, baselines: {} });
  assert.notEqual(f2.candidates[0].fingerprint, f1.candidates[0].fingerprint,
    'changed evidence must mint a new fingerprint');
  const r2 = evaluate({ wolfDir: P.wolf, candidates: f2.candidates, nudgeCfg: cfg(), sessionId: 's2' });
  assert.equal(r2.emitted.length, 1, 'new evidence re-arms the rule');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 7. CURRENT REDUCTION + RECAP ══════════════════════════════════════════
test('7. conclusion gate silent when a current reduction covers the exact bytes', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const [file] = writeFiles(P.root, ['src/thing.ts'], 'export const answer = 42;\n');
  const h = sha(file);
  fs.writeFileSync(path.join(P.wolf, 'qa', 'thing.md'),
    `---\ntarget-hash: ${h}\nreproduction_command: node t.js\n---\nbody\n`);

  const text = 'The verdict is confirmed: the fix works and the root cause is fixed. '
    + 'This is definitely the final state, proven by the test that passes. '.repeat(4);

  const { candidates, matched } = conclusionRule.collect({
    text,
    patterns: ['\\b(verdict|the (?:answer|finding|conclusion|result)\\s+is)\\b',
               '\\b(confirmed|proven|definitely)\\b',
               '\\b(works|fails|passes|broken|fixed)\\b'],
    minHits: 2, codeFiles: [file],
  });
  assert.ok(matched.length >= 2, 'prose signal genuinely fired (test is not vacuous)');
  assert.equal(candidates.length, 0, 'covered bytes → silent despite conclusive prose');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 8. EDIT AFTER REDUCTION ═══════════════════════════════════════════════
test('8. edit after a valid reduction fires the gate exactly once', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const [file] = writeFiles(P.root, ['src/thing.ts'], 'export const answer = 42;\n');
  fs.writeFileSync(path.join(P.wolf, 'qa', 'thing.md'),
    `---\ntarget-hash: ${sha(file)}\n---\nbody\n`);

  // Now edit the covered file — the reduction no longer describes these bytes.
  fs.writeFileSync(file, 'export const answer = 43; // changed\n');

  const text = 'The verdict is confirmed: it works and the bug is fixed. '.repeat(8);
  const patterns = ['\\b(verdict)\\b', '\\b(confirmed|proven)\\b', '\\b(works|fixed)\\b'];

  const first = conclusionRule.collect({ text, patterns, minHits: 2, codeFiles: [file] });
  assert.equal(first.candidates.length, 1, 'stale coverage → fires');

  const r1 = evaluate({ wolfDir: P.wolf, candidates: first.candidates, nudgeCfg: cfg(), sessionId: 's1' });
  assert.equal(r1.emitted.length, 1);

  // Same evidence again (no further edit) → quiet.
  const second = conclusionRule.collect({ text, patterns, minHits: 2, codeFiles: [file] });
  const r2 = evaluate({ wolfDir: P.wolf, candidates: second.candidates, nudgeCfg: cfg(), sessionId: 's1' });
  assert.equal(r2.emitted.length, 0, 'fires once, then quiet until evidence changes');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 9. STALE REVIEW ═══════════════════════════════════════════════════════
test('9. review target changed H1→H2: old snapshot superseded, never attested as current', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const [file] = writeFiles(P.root, ['src/shared.ts'], 'export const v = 1;\n');
  const h1 = sha(file);

  const pending = { id: 'review-0132', status: 'pending', files: [file], content_hashes: { [file]: h1 } };

  // Change the target to H2 before completion.
  fs.writeFileSync(file, 'export const v = 2; // edited after review was staged\n');
  const h2 = sha(file);
  assert.notEqual(h1, h2, 'precondition: the file genuinely changed');

  const res = reviewRule.collect({
    wolfDir: P.wolf, ownerRoot: P.root, files: [file], changedLines: 100, pending,
  });
  assert.equal(res.superseded, 'review-0132', 'stale snapshot is marked superseded');
  assert.equal(res.candidates.length, 1, 'at most one candidate for the H2 state');
  const c = res.candidates[0];
  assert.equal(c.rule_id, 'review.superseded');
  assert.ok(!/--reviewed-current/.test(c.action.command || ''),
    'must NOT instruct attesting stale bytes as current');
  assert.ok(/--refresh/.test(c.action.command), 'directs to refresh instead');
  fs.rmSync(base, { recursive: true, force: true });
});

test('9b. unchanged review snapshot is not superseded', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const [file] = writeFiles(P.root, ['src/x.ts']);
  const pending = { id: 'review-1', status: 'pending', files: [file], content_hashes: { [file]: sha(file) } };
  const res = reviewRule.collect({ wolfDir: P.wolf, ownerRoot: P.root, files: [file], changedLines: 5, pending });
  assert.equal(res.superseded, undefined, 'current snapshot stays valid');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 10. REVIEW ROUND CAP ══════════════════════════════════════════════════
test('10. lineage round cap: rounds 1..3 work, one escalation at cap, no round 4', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const files = writeFiles(P.root, ['src/a.ts'], 'export const a=1;\n'.repeat(60));
  const lineageId = reviewRule.lineageIdFor(P.root, files);

  const rounds = [];
  for (let i = 1; i <= 3; i++) {
    const res = reviewRule.collect({
      wolfDir: P.wolf, ownerRoot: P.root, files, changedLines: 100, maxRounds: 3,
    });
    assert.equal(res.candidates[0].rule_id, 'review.required', `round ${i} requests a review`);
    rounds.push(res.candidates[0].evidence.round);
    bumpLineageRound(P.wolf, lineageId);           // simulate the round happening
    // Each round the fix changes content — proving the cap is NOT hash-keyed.
    fs.writeFileSync(files[0], `export const a=${i};\n`.repeat(60));
  }
  assert.deepEqual(rounds, [1, 2, 3]);

  // Round 4 attempt → escalation, not another review request.
  const capped = reviewRule.collect({
    wolfDir: P.wolf, ownerRoot: P.root, files, changedLines: 100, maxRounds: 3,
  });
  assert.equal(capped.roundCapReached, true);
  assert.equal(capped.candidates.length, 1);
  assert.equal(capped.candidates[0].rule_id, 'review.escalate', 'escalates to the user');

  // After escalation is recorded, stay quiet.
  markLineageEscalated(P.wolf, lineageId);
  const quiet = reviewRule.collect({
    wolfDir: P.wolf, ownerRoot: P.root, files, changedLines: 100, maxRounds: 3,
  });
  assert.equal(quiet.candidates.length, 0, 'no automatic round cap+1');
  fs.rmSync(base, { recursive: true, force: true });
});
// ═══ 11. PRE-EXISTING DIRTY FILE ═══════════════════════════════════════════
test('11. review scope covers only session-owned files, not pre-existing dirt', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const [dirty] = writeFiles(P.root, ['src/pre-existing.ts'], 'dirty before session\n');
  const [owned] = writeFiles(P.root, ['src/session-owned.ts'], 'export const s=1;\n');

  // Only the session-owned file is passed as evidence; the dirty file is not
  // in session.files_written and must not appear in the review target set.
  const res = reviewRule.collect({
    wolfDir: P.wolf, ownerRoot: P.root, files: [owned], changedLines: 100,
  });
  assert.equal(res.candidates.length, 1);
  const targets = Object.keys(res.candidates[0].evidence.files);
  assert.equal(res.candidates[0].evidence.files.length, 1);
  assert.ok(res.candidates[0].evidence.files[0].includes('session-owned'));
  assert.ok(!JSON.stringify(res.candidates[0].evidence).includes('pre-existing'),
    'pre-existing dirty file must not enter the review patch');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 12. CONCURRENT IDENTICAL CANDIDATE (real OS processes) ════════════════
test('12. twelve concurrent real processes on identical evidence → exactly 1 emission', async () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const writes = writeFiles(P.root, ['a.ts', 'b.ts', 'c.ts']);

  const driver = path.join(base, 'driver.mjs');
  fs.writeFileSync(driver, `
    const NUDGE_DIR = ${JSON.stringify(NUDGE_DIR)};
    const { evaluate, NUDGE_DEFAULTS } = await import(NUDGE_DIR + 'engine.js');
    const cere = await import(NUDGE_DIR + 'rules/cerebrum.js');
    const writes = ${JSON.stringify(writes)};
    // Stagger start slightly at random so children collide INSIDE the
    // check-then-claim window rather than lining up behind process startup.
    await new Promise(r => setTimeout(r, Math.random() * 40));
    const { candidates } = cere.collect({ writes, baselines: {} });
    const r = evaluate({ wolfDir: ${JSON.stringify(P.wolf)}, candidates,
                         nudgeCfg: NUDGE_DEFAULTS, sessionId: 'shared-session' });
    process.stdout.write(JSON.stringify({ emitted: r.emitted.length }));
  `);

  const procs = await spawnConcurrent(driver, Array.from({ length: 12 }, () => []));
  let total = 0;
  for (const p of procs) {
    assert.equal(p.status, 0, `child failed: ${p.stderr}`);
    total += JSON.parse(p.stdout || '{"emitted":0}').emitted;
  }

  assert.equal(total, 1, `exactly one process may emit; got ${total}`);

  const state = readState(P.wolf);
  assert.equal(Object.keys(state.emissions).length, 1, 'state has exactly one emission');
  assert.equal(Object.keys(state.leases).length, 0, 'no stale leases left behind');
  // State must still be valid JSON (no corruption under concurrent writes).
  JSON.parse(fs.readFileSync(nudgeStatePath(P.wolf), 'utf8'));
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 13. CONCURRENT DISTINCT CANDIDATES ════════════════════════════════════
test('13. concurrent distinct fingerprints: none lost, none wrongly suppressed', async () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const wolf = P.wolf;

  const driver = path.join(base, 'driver13.mjs');
  fs.writeFileSync(driver, `
    const NUDGE_DIR = ${JSON.stringify(NUDGE_DIR)};
    const { evaluate, makeCandidate, NUDGE_DEFAULTS } = await import(NUDGE_DIR + 'engine.js');
    const idx = process.argv[2];
    await new Promise(r => setTimeout(r, Math.random() * 40));
    const c = makeCandidate({
      ruleId: 'test.rule' + idx, ownerRoot: ${JSON.stringify(P.root)},
      severity: 'warn', title: 't', reason: 'distinct evidence ' + idx,
      evidence: { idx },
    });
    // max_emissions_per_rule_per_session must not cross-suppress DIFFERENT
    // rules; each child uses its own rule id, so all eight must emit.
    const r = evaluate({ wolfDir: ${JSON.stringify(wolf)}, candidates: [c],
      nudgeCfg: { ...NUDGE_DEFAULTS, max_per_stop: 1 }, sessionId: 'sess' });
    process.stdout.write(JSON.stringify({ emitted: r.emitted.length, fp: c.fingerprint }));
  `);

  const results = await spawnConcurrent(driver, Array.from({ length: 8 }, (_, i) => [String(i)]));
  const fps = new Set();
  let emitted = 0;
  for (const r of results) {
    assert.equal(r.status, 0, `child failed: ${r.stderr}`);
    const o = JSON.parse(r.stdout);
    fps.add(o.fp);
    emitted += o.emitted;
  }
  assert.equal(fps.size, 8, 'eight distinct fingerprints');
  assert.equal(emitted, 8, 'distinct evidence is never cross-suppressed');
  const state = readState(wolf);
  assert.equal(Object.keys(state.emissions).length, 8, 'all candidates represented in state');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 14. LEASE CRASH RECOVERY ══════════════════════════════════════════════
test('14. lease from a dead process expires → candidate becomes eligible again', () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const writes = writeFiles(P.root, ['a.ts', 'b.ts', 'c.ts']);
  const { candidates } = cerebrumRule.collect({ writes, baselines: {} });
  const fp = candidates[0].fingerprint;

  // Simulate: process leased, then died before emitting.
  const claim = tryClaim(P.wolf, fp, { leaseSeconds: 30, sessionId: 's1' });
  assert.equal(claim.ok, true, 'first claim succeeds');
  let state = readState(P.wolf);
  assert.ok(state.leases[fp], 'lease exists (injection actually executed)');
  assert.equal(Object.keys(state.emissions).length, 0, 'died before emitting');

  // A second process while the lease is LIVE must not double-emit.
  const blocked = tryClaim(P.wolf, fp, { leaseSeconds: 30, sessionId: 's1' });
  assert.equal(blocked.ok, false, 'live lease blocks a concurrent claim');
  assert.equal(blocked.reason, 'lease_held_by_other_process');

  // Expire the lease by rewriting its expiry into the past (the crash case).
  state = readState(P.wolf);
  state.leases[fp].expires_at = new Date(Date.now() - 1000).toISOString();
  writeStateOrThrow(P.wolf, state);

  const retry = tryClaim(P.wolf, fp, { leaseSeconds: 30, sessionId: 's1' });
  assert.equal(retry.ok, true, 'expired lease is reclaimable — candidate not lost forever');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 15. FULL-EVIDENCE SIGNATURE ═══════════════════════════════════════════
test('15. candidates sharing the first five displayed files but differing later differ', () => {
  const common = ['/p/a.ts', '/p/b.ts', '/p/c.ts', '/p/d.ts', '/p/e.ts'];
  const f1 = computeFingerprint({
    ruleId: 'r', ownerRoot: '/p',
    evidence: { files: [...common, '/p/f.ts'] },
  });
  const f2 = computeFingerprint({
    ruleId: 'r', ownerRoot: '/p',
    evidence: { files: [...common, '/p/DIFFERENT.ts'] },
  });
  assert.notEqual(f1, f2, 'a 6th differing file must change the fingerprint');

  // And the same via real target hashes (the review/conclusion path).
  const t1 = computeFingerprint({ ruleId: 'r', targetHashes: { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' } });
  const t2 = computeFingerprint({ ruleId: 'r', targetHashes: { a: '1', b: '2', c: '3', d: '4', e: '5', f: 'CHANGED' } });
  assert.notEqual(t1, t2, 'a 6th differing hash must change the fingerprint');
});

test('15b. fingerprints are order- and key-insertion-independent', () => {
  const a = computeFingerprint({ ruleId: 'r', targetHashes: { x: '1', y: '2' }, evidence: { p: 1, q: 2 } });
  const b = computeFingerprint({ ruleId: 'r', targetHashes: { y: '2', x: '1' }, evidence: { q: 2, p: 1 } });
  assert.equal(a, b, 'stable serialization: key order must not perturb identity');
});

test('15c. rule_schema_version bump invalidates old dispositions', () => {
  const v1 = computeFingerprint({ ruleId: 'r', evidence: { a: 1 }, schemaVersion: 1 });
  const v2 = computeFingerprint({ ruleId: 'r', evidence: { a: 1 }, schemaVersion: 2 });
  assert.notEqual(v1, v2, 'reinterpreting evidence must not inherit stale dispositions');
});

// ═══ 16. OUTPUT BUDGET ═════════════════════════════════════════════════════
test('16. several qualifying rules → at most max_per_stop emitted, rest queued', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const candidates = [
    makeCandidate({ ruleId: 'r.info', ownerRoot: P.root, severity: 'info', confidence: 0.5, title: 'i', reason: 'x'.repeat(50), evidence: { k: 1 } }),
    makeCandidate({ ruleId: 'r.warn', ownerRoot: P.root, severity: 'warn', confidence: 0.9, title: 'w', reason: 'y'.repeat(50), evidence: { k: 2 }, action: { command: 'do thing', label: 'l' } }),
    makeCandidate({ ruleId: 'r.block', ownerRoot: P.root, severity: 'block', confidence: 0.9, title: 'b', reason: 'z'.repeat(50), evidence: { k: 3 } }),
  ];
  const r = evaluate({ wolfDir: P.wolf, candidates, nudgeCfg: cfg({ max_per_stop: 1 }), sessionId: 's' });
  assert.equal(r.emitted.length, 1, 'budget honored');
  assert.equal(r.emitted[0].severity, 'block', 'highest severity wins');
  assert.equal(r.queued.length, 2, 'the rest are queued, not lost');
  for (const m of r.messages) {
    assert.ok(m.length <= NUDGE_DEFAULTS.max_chars, `message ${m.length} chars exceeds budget`);
  }
  fs.rmSync(base, { recursive: true, force: true });
});

test('16b. queued candidates remain visible in durable state for `nudge list`', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const cands = [
    makeCandidate({ ruleId: 'a.rule', ownerRoot: P.root, severity: 'warn', title: 'a', reason: 'a', evidence: { i: 1 } }),
    makeCandidate({ ruleId: 'b.rule', ownerRoot: P.root, severity: 'warn', title: 'b', reason: 'b', evidence: { i: 2 } }),
  ];
  const r = evaluate({ wolfDir: P.wolf, candidates: cands, nudgeCfg: cfg({ max_per_stop: 1 }), sessionId: 's' });
  assert.equal(r.emitted.length, 1);
  assert.equal(r.queued.length, 1);
  // The queued one is eligible on a LATER stop (not permanently dropped).
  const r2 = evaluate({ wolfDir: P.wolf, candidates: [r.queued[0].candidate], nudgeCfg: cfg({ max_per_stop: 1 }), sessionId: 's2' });
  assert.equal(r2.emitted.length, 1, 'queued candidate surfaces on a later stop');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 17. NON-BLOCKING INFO ═════════════════════════════════════════════════
test('17. informational candidates are non-blocking by default', () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const writes = writeFiles(P.root, ['a.ts', 'b.ts', 'c.ts']);
  const { candidates } = cerebrumRule.collect({ writes, baselines: {} });
  assert.equal(candidates[0].severity, 'info');
  assert.equal(candidates[0].blocking, false, 'a reminder must not be labelled a blocker');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 18. FAULT-INJECTION VALIDITY ══════════════════════════════════════════
test('18. injected write failure genuinely executes (not bypassed)', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  let injected = 0;
  // Inject at the module's OWN io seam. Reassigning `fs.writeFileSync` from a
  // test cannot intercept an ESM live binding — that monkeypatch produced a
  // vacuous green test, which this assertion (injected > 0) caught.
  const realWrite = stateMod.io.writeFileSync;
  stateMod.io.writeFileSync = (p, data, enc) => {
    if (String(p).includes('nudge-state.json')) {
      injected++;
      throw new Error('EINJECTED: simulated disk failure');
    }
    return realWrite(p, data, enc);
  };
  let threw = false;
  try {
    writeStateOrThrow(P.wolf, { version: 2, dispositions: {}, leases: {}, emissions: {}, lineages: {} });
  } catch (e) {
    threw = /EINJECTED/.test(e.message);
  } finally {
    stateMod.io.writeFileSync = realWrite;
  }
  assert.ok(injected > 0, 'FAIL: the injection never executed — test would be vacuous');
  assert.ok(threw, 'writeStateOrThrow must propagate, not swallow, a write failure');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 19. STATE-WRITE FAILURE ═══════════════════════════════════════════════
test('19. state persistence failure: no corruption, no infinite repeat, not blocking', () => {
  const base = tmp();
  const P = makeProject(base, 'p', { cerebrumAgeHours: 50 });
  const writes = writeFiles(P.root, ['a.ts', 'b.ts', 'c.ts']);
  const { candidates } = cerebrumRule.collect({ writes, baselines: {} });

  let injected = 0;
  const realWrite = stateMod.io.writeFileSync;
  stateMod.io.writeFileSync = (p, data, enc) => {
    if (String(p).includes('nudge-state.json')) {
      injected++;
      throw new Error('EINJECTED: state write blocked');
    }
    return realWrite(p, data, enc);
  };
  let r;
  try {
    r = evaluate({ wolfDir: P.wolf, candidates, nudgeCfg: cfg(), sessionId: 's1' });
  } finally {
    stateMod.io.writeFileSync = realWrite;
  }

  assert.ok(injected > 0, 'FAIL: injection never ran — test would be vacuous');
  assert.ok(r.degraded, 'degradation is surfaced, not swallowed');
  assert.equal(r.emitted.length, 0, 'must not claim an emission it could not record');
  const degradedMsgs = r.messages.filter(m => /could not be persisted/.test(m));
  assert.equal(degradedMsgs.length, 1, 'exactly one concise degraded-state diagnostic');
  // No corrupt state file left behind.
  const p = nudgeStatePath(P.wolf);
  if (fs.existsSync(p)) JSON.parse(fs.readFileSync(p, 'utf8'));
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ 20. PURE RECAP AFTER RESOLUTION ═══════════════════════════════════════
test('20. final summary with conclusion words after resolution → no new nudge', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const [file] = writeFiles(P.root, ['src/thing.ts']);
  fs.writeFileSync(path.join(P.wolf, 'qa', 'r.md'), `---\ntarget-hash: ${sha(file)}\n---\nx\n`);

  const summary = 'Final state: the root cause is fixed and confirmed. '
    + 'Everything works, the verdict is proven, and the result is definitely correct. '.repeat(4);
  const patterns = ['\\b(verdict|the (?:result|answer)\\s+is)\\b', '\\b(confirmed|proven|definitely)\\b',
                    '\\b(works|fixed|passes)\\b', '\\broot cause\\b'];

  const { candidates, matched } = conclusionRule.collect({
    text: summary, patterns, minHits: 2, codeFiles: [file],
  });
  assert.ok(matched.length >= 3, 'the recap genuinely trips multiple prose patterns');
  assert.equal(candidates.length, 0, 'no new evidence → no new nudge, however conclusive the prose');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ extra: risk-weighted review triggers ══════════════════════════════════
test('21. high-risk code lowers the review threshold; docs raise it', () => {
  const base = tmp();
  const P = makeProject(base, 'p');
  const [risky] = writeFiles(P.root, ['src/backup.ts'],
    'import fs from "fs";\nexport function purge(p){ fs.rmSync(p, {recursive:true}); }\n');
  const [doc] = writeFiles(P.root, ['docs/notes.md'], '# notes\n');

  const sigs = reviewRule.detectRiskSignals([risky]);
  assert.ok(sigs.length > 0, `risk signals detected: ${sigs.join(',')}`);
  assert.ok(reviewRule.effectiveThreshold(40, [risky], sigs) < 40, 'high risk → lower bar');
  assert.ok(reviewRule.effectiveThreshold(40, [doc], []) > 40, 'docs-only → higher bar');

  // A 12-line risky change reviews; a 12-line doc change does not.
  const r1 = reviewRule.collect({ wolfDir: P.wolf, ownerRoot: P.root, files: [risky], changedLines: 12 });
  assert.equal(r1.candidates.length, 1, 'risky small change is reviewed');
  const r2 = reviewRule.collect({ wolfDir: P.wolf, ownerRoot: P.root, files: [doc], changedLines: 12 });
  assert.equal(r2.candidates.length, 0, 'small doc change is not');
  fs.rmSync(base, { recursive: true, force: true });
});

// ═══ extra: config hardening ═══════════════════════════════════════════════
test('22. malformed config values fall back to safe defaults', () => {
  const c = getNudgeConfig({ openwolf: { nudges: { max_per_stop: -5, max_chars: 'lots', lease_seconds: NaN, enabled: 'yes' } } });
  assert.equal(c.max_per_stop, NUDGE_DEFAULTS.max_per_stop, 'negative rejected');
  assert.equal(c.max_chars, NUDGE_DEFAULTS.max_chars, 'non-numeric rejected');
  assert.equal(c.lease_seconds, NUDGE_DEFAULTS.lease_seconds, 'NaN rejected');
  assert.equal(c.enabled, true, 'non-boolean rejected');
  // Valid overrides DO apply (otherwise the guard would be vacuous).
  const c2 = getNudgeConfig({ openwolf: { nudges: { max_per_stop: 3, enabled: false } } });
  assert.equal(c2.max_per_stop, 3);
  assert.equal(c2.enabled, false);
});

test('23. nested project wins over parent project for ownership', () => {
  const base = tmp();
  const outer = makeProject(base, 'outer');
  const inner = makeProject(path.join(base, 'outer'), 'inner');
  const [f] = writeFiles(inner.root, ['x.ts']);
  const owner = resolveOwningProject(f);
  assert.ok(owner.root.includes('inner'), `nearest marker wins, got ${owner.root}`);
  fs.rmSync(base, { recursive: true, force: true });
});


// ═══ 24. LEGACY BUDGET, END-TO-END THROUGH THE REAL STOP HOOK ══════════════
// The engine budgets its own rules, but legacy nudges (git-discipline, review,
// quality, buglog, simplicity) format their own prose and pre-date the engine.
// Before applyLegacyBudget a busy Stop stacked 3–5 of them into one wall of
// text. This runs the SHIPPED stop.js against a fixture that trips several
// rules at once and asserts the budget holds.
test('24. multiple legacy rules qualify → one nudge plus a queued pointer', () => {
  const base = tmp();
  const root = path.join(base, 'proj');
  const wolf = path.join(root, '.wolf');
  fs.mkdirSync(path.join(wolf, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(wolf, 'qa'), { recursive: true });

  // Trip BOTH the buglog rule (a file edited 3+ times) and the simplicity rule
  // (large output). Review/quality/git are disabled so the fixture is stable.
  const hot = path.join(root, 'src', 'hot.py');
  fs.mkdirSync(path.dirname(hot), { recursive: true });
  fs.writeFileSync(hot, 'x\n');

  fs.writeFileSync(path.join(wolf, 'config.json'), JSON.stringify({
    openwolf: {
      review_hook: { enabled: false }, quality_gate: { enabled: false },
      claim_calibration: { enabled: false }, autonomy_continuation: { enabled: false },
      // git_discipline ON so a SECOND rule qualifies (it outranks simplicity),
      // making the budget genuinely contested rather than trivially satisfied.
      git_discipline: { enabled: true, min_written_files: 1, min_changed_lines: 0 },
      simplicity: { enabled: true },
      nudges: { enabled: true, max_per_stop: 1 },
    },
  }, null, 2));

  fs.writeFileSync(path.join(wolf, 'hooks', '_session.json'), JSON.stringify({
    session_id: 'sess-budget', started: '2099-06-13T17:00:00.000Z',
    files_read: {},
    files_written: [hot].map(file => ({ file, at: '2099-06-13T17:00:00.000Z', tokens: 3000, action: 'edit' })),
    edit_counts: { [hot]: 6 },
    anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0,
    cerebrum_warnings: 0, buglog_warnings: 0, stop_count: 0,
  }, null, 2));

  const transcript = path.join(root, 't.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({
    type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  }) + '\n');

  const stopHook = path.join(repoRoot, 'dist/src/hooks/stop.js');
  const r = spawnSync(process.execPath, [stopHook], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify({ session_id: 'sess-budget', transcript_path: transcript }),
  });
  assert.equal(r.status, 0, r.stderr);

  const payload = JSON.parse(r.stdout);
  const ctx = payload.hookSpecificOutput.additionalContext;

  // Precondition: more than one rule genuinely qualified, otherwise the budget
  // is untested and this assertion would be vacuous.
  assert.match(ctx, /held for a later stop/,
    'at least one nudge must have been held — otherwise the budget was not exercised');

  // The surviving nudge count: exactly one real nudge + the pointer line.
  const realNudges = ctx.split('\n').filter(l =>
    /^(⚠️|🐺 Wolfpack|Wolfpack |💡|🔄)/.test(l) && !/held for a later stop/.test(l));
  assert.equal(realNudges.length, 1, `expected 1 nudge, got ${realNudges.length}: ${ctx}`);
  fs.rmSync(base, { recursive: true, force: true });
});

// ── review-0073 companion findings (GLM) ────────────────────────────────────
// Four defects found by external review of the current bytes. Each test below
// was verified to FAIL against the pre-fix code (see the reduction's negative
// controls), so none of them can pass vacuously.

test('30. per-rule session ceiling holds across REAL concurrent processes', async () => {
  // GLM finding 1 (HIGH). The ceiling was filtered only on engine.evaluate's
  // pre-lock snapshot. Concurrent Stops with DISTINCT fingerprints of the SAME
  // rule each read count 0, all passed, and all emitted. Negative control with
  // the in-lock check disabled: 8 emissions instead of 1.
  const base = tmp();
  const wolf = path.join(base, '.wolf');
  fs.mkdirSync(wolf, { recursive: true });

  const driver = path.join(base, 'driver.mjs');
  fs.writeFileSync(driver, `
    const m = await import(${JSON.stringify(NUDGE_DIR + 'state.js')});
    const wolfDir = ${JSON.stringify(wolf)};
    const fp = 'FP_' + process.argv[2];
    await new Promise(r => setTimeout(r, Math.random() * 40));
    const c = m.tryClaim(wolfDir, fp, {
      sessionId: 'S', ruleId: 'r', maxPerRulePerSession: 1, leaseSeconds: 30,
    });
    if (c.ok) m.markEmitted(wolfDir, fp, { token: c.token, sessionId: 'S', ruleId: 'r' });
  `);

  await spawnConcurrent(driver, Array.from({ length: 8 }, (_, i) => [String(i)]));

  const state = readState(wolf);
  const emitted = Object.values(state.emissions || {})
    .filter(e => e && e.rule_id === 'r' && e.session_id === 'S');
  assert.equal(emitted.length, 1,
    `ceiling of 1 breached: ${emitted.length} emissions across 8 concurrent processes`);
  fs.rmSync(base, { recursive: true, force: true });
});

test('31. corrupt state file does not silently destroy dispositions', () => {
  // GLM finding 2 (HIGH). readState conflated ENOENT with a parse error, so a
  // truncated file returned emptyState() and the next write permanently erased
  // every dismissal with no diagnostic.
  const base = tmp();
  const wolf = path.join(base, '.wolf');
  fs.mkdirSync(wolf, { recursive: true });

  setDisposition(wolf, 'FP_X', 'dismissed', { reason: 'user said no' });
  assert.ok(readState(wolf).dispositions.FP_X, 'precondition: dismissal stored');

  // Simulate a partial flush / hand-edit.
  fs.writeFileSync(stateMod.nudgeStatePath(wolf), '{"version":2,"dispositions":{"FP_X":{"sta');

  let reported = null;
  readState(wolf, { onCorrupt: (info) => { reported = info; } });

  assert.ok(reported, 'corruption must be reported, not silently swallowed');
  assert.ok(reported.quarantine && fs.existsSync(reported.quarantine),
    'corrupt bytes must be quarantined for recovery');
  assert.match(fs.readFileSync(reported.quarantine, 'utf-8'), /FP_X/,
    'quarantine must preserve the original bytes');
  fs.rmSync(base, { recursive: true, force: true });
});

test('32. path-like evidence is canonicalized into the fingerprint', () => {
  // GLM finding 3 (MEDIUM). evidence was hashed raw while target_hashes and
  // owner_root were canonicalized. Rules embed real absolute paths in evidence,
  // so two spellings of one path produced two fingerprints and a dismissal
  // bound to one failed to suppress the other.
  const a = computeFingerprint({ ruleId: 'r', evidence: { cerebrum: '/tmp/proj/.wolf/cerebrum.md' } });
  const b = computeFingerprint({ ruleId: 'r', evidence: { cerebrum: '/tmp/proj/../proj/.wolf/cerebrum.md' } });
  assert.equal(a, b, 'equivalent path spellings must yield one fingerprint');

  // Nested paths (written_files / uncovered_files) get the same treatment.
  const c = computeFingerprint({ ruleId: 'r', evidence: { files: ['/tmp/p/./a.ts'] } });
  const d = computeFingerprint({ ruleId: 'r', evidence: { files: ['/tmp/p/a.ts'] } });
  assert.equal(c, d, 'nested path arrays must canonicalize too');

  // Guard against over-reach: prose and relative fragments must NOT be
  // resolved against cwd, or the fingerprint becomes invocation-dependent.
  const e = computeFingerprint({ ruleId: 'r', evidence: { note: 'see a/b for details' } });
  const f = computeFingerprint({ ruleId: 'r', evidence: { note: 'see a/b for details' } });
  assert.equal(e, f);
  assert.notEqual(
    computeFingerprint({ ruleId: 'r', evidence: { note: 'x' } }),
    computeFingerprint({ ruleId: 'r', evidence: { note: 'y' } }),
    'distinct prose must still differentiate');
});

test('33. target hash values are type-tagged so numeric != string', () => {
  // GLM finding 4 (LOW). String(h) collapsed 12345678 and "12345678", so a
  // caller-side type inconsistency would false-suppress a real content change.
  const a = computeFingerprint({ ruleId: 'r', targetHashes: { '/f.ts': 12345678 } });
  const b = computeFingerprint({ ruleId: 'r', targetHashes: { '/f.ts': '12345678' } });
  assert.notEqual(a, b, 'numeric and string hashes must not collide');
});

test('34. review snapshot coverage is symmetric — target-set expansion supersedes', () => {
  // Round-1 finding from the GPT-5.5 companion (reported CRITICAL; verified
  // MEDIUM — see the reduction: nothing is silenced, but the pending entry was
  // not flagged stale, so `--reviewed-current` could later attest bytes the
  // reviewer never received).
  const base = tmp();
  const root = path.join(base, 'proj');
  fs.mkdirSync(path.join(root, '.wolf'), { recursive: true });
  const a = path.join(root, 'a.js');
  const b = path.join(root, 'b.js');
  fs.writeFileSync(a, 'const a = 1;\n');
  fs.writeFileSync(b, 'const b = 2;\n');

  const staged = { id: 'r1', status: 'pending', content_hashes: reviewRule.hashAll([a]) };
  const args = { wolfDir: path.join(root, '.wolf'), ownerRoot: root, changedLines: 100, baseThreshold: 40 };

  // Expansion: pending saw only `a`, current scope is `a` + `b`.
  const expanded = reviewRule.collect({ ...args, files: [a, b], pending: staged });
  assert.equal(expanded.superseded, 'r1',
    'a review staged for a subset must not read as current once scope expands');
  assert.match(expanded.candidates[0].reason, /entered scope/,
    'an added file must not be described as "changed"');
  assert.match(expanded.candidates[0].action.command, /--refresh/,
    'must direct to refresh, never to --reviewed-current');

  // Must NOT over-fire when the snapshot genuinely covers current bytes.
  const exact = { id: 'r2', status: 'pending', content_hashes: reviewRule.hashAll([a, b]) };
  const same = reviewRule.collect({ ...args, files: [a, b], pending: exact });
  assert.equal(same.superseded, undefined, 'identical covered set must not supersede');

  // A superset review legitimately covers a shrinking scope.
  const shrunk = reviewRule.collect({ ...args, files: [a], pending: exact });
  assert.equal(shrunk.superseded, undefined, 'subset of a reviewed set is still covered');

  fs.rmSync(base, { recursive: true, force: true });
});

test('35. failed quarantine must not permit overwriting corrupt state', () => {
  // Round-2 finding (Kimi): the round-1 RC-2 fix was INCOMPLETE. If the
  // quarantine write itself failed, readState still returned a plain empty
  // state, so the next successful write renamed over the corrupt bytes — the
  // only surviving copy of the user's dispositions. Permanent loss gated on
  // one extra IO failure rather than zero.
  const base = tmp();
  const wolf = path.join(base, '.wolf');
  fs.mkdirSync(wolf, { recursive: true });

  setDisposition(wolf, 'FP_X', 'dismissed', { reason: 'user said no' });
  fs.writeFileSync(stateMod.nudgeStatePath(wolf), '{"dispositions":{"FP_X":{"trunc');
  const corruptBytes = fs.readFileSync(stateMod.nudgeStatePath(wolf), 'utf-8');

  // Fail ONLY the quarantine write, through the injectable seam.
  const realWrite = stateMod.io.writeFileSync;
  let injected = 0;
  stateMod.io.writeFileSync = (p, d, e) => {
    if (String(p).includes('.corrupt-')) { injected++; throw new Error('ENOSPC simulated'); }
    return realWrite(p, d, e);
  };
  let claim;
  try {
    claim = tryClaim(wolf, 'FP_NEW', { sessionId: 'S', ruleId: 'r', leaseSeconds: 30 });
  } finally {
    stateMod.io.writeFileSync = realWrite;
  }

  // The injection must actually have executed, or this test measures nothing.
  assert.ok(injected > 0, 'quarantine write was never attempted — injection bypassed');
  assert.equal(claim.ok, false, 'claim must be refused when state cannot be safely persisted');
  assert.ok(claim.degraded, 'refusal must be reported as degraded, not silent');
  assert.equal(fs.readFileSync(stateMod.nudgeStatePath(wolf), 'utf-8'), corruptBytes,
    'corrupt bytes must survive — they are the only copy of the dispositions');

  // Control: with quarantine working, recovery proceeds normally.
  const ok = tryClaim(wolf, 'FP_NEW', { sessionId: 'S', ruleId: 'r', leaseSeconds: 30 });
  assert.equal(ok.ok, true, 'normal recovery must still work once quarantine succeeds');
  assert.equal(fs.readdirSync(wolf).filter(f => f.includes('.corrupt-')).length, 1,
    'the corrupt bytes must be preserved in a quarantine file');

  fs.rmSync(base, { recursive: true, force: true });
});

test('36. a dead lock owner is reclaimed fast; a live owner is never stolen', async () => {
  // Observed four times in one session: complete-review.js failed with "could
  // not lock reviewlog.json" while the recorded owner pid was already dead.
  // isLockReclaimable checked owner liveness only AFTER age > staleMs (30s),
  // but acquireFileLock times out at 2s — so a crashed hook's lock was
  // unusable for 30s and every caller in that window failed hard.
  const { acquireFileLock } = await import(
    path.join(repoRoot, 'dist/src/utils/size-discipline.js').replace(/\\/g, '/'));

  const base = tmp('ow-lock-');
  const dead = path.join(base, 'dead.json');
  const live = path.join(base, 'live.json');
  fs.writeFileSync(dead, '{}');
  fs.writeFileSync(live, '{}');

  // A pid that cannot exist. Verify that, rather than assuming it.
  const deadPid = 999999;
  let deadIsReallyDead = false;
  try { process.kill(deadPid, 0); } catch { deadIsReallyDead = true; }
  assert.ok(deadIsReallyDead, `pid ${deadPid} is alive — pick another for this test`);

  fs.writeFileSync(`${dead}.lock`, `${deadPid}:abcdef0123456789abcdef0123456789`);
  fs.writeFileSync(`${live}.lock`, `${process.pid}:abcdef0123456789abcdef0123456789`);

  // Age both locks past the dead-owner grace period (250ms).
  const past = new Date(Date.now() - 2000);
  fs.utimesSync(`${dead}.lock`, past, past);
  fs.utimesSync(`${live}.lock`, past, past);

  const t0 = Date.now();
  const gotDead = acquireFileLock(dead);
  const deadMs = Date.now() - t0;
  assert.ok(gotDead, 'a lock whose owner is dead must be reclaimable');
  assert.ok(deadMs < 1000, `reclaim must be fast, took ${deadMs}ms (pre-fix: full 2s timeout)`);
  gotDead();

  // The critical safety property: a LIVE owner's lock must never be stolen.
  const gotLive = acquireFileLock(live, { timeoutMs: 300 });
  assert.equal(gotLive, null, 'a live owner\'s lock must not be reclaimed');

  // And a brand-new lock stays untouched even with a dead pid, so we never
  // race a process that has just written its nonce.
  const fresh = path.join(base, 'fresh.json');
  fs.writeFileSync(fresh, '{}');
  fs.writeFileSync(`${fresh}.lock`, `${deadPid}:abcdef0123456789abcdef0123456789`);
  assert.equal(acquireFileLock(fresh, { timeoutMs: 120 }), null,
    'a lock younger than the grace period must not be reclaimed');

  fs.rmSync(base, { recursive: true, force: true });
});
