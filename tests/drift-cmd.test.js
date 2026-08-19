import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildDriftReport } = await import(path.join(root, 'dist/src/cli/drift-cmd.js'));

/** Minimal Wolfpack project: a real file at a root-relative anatomy path. */
function fixture(anatomyBody, files = { 'src/real.ts': 'export const a = 1;\n' }) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-drift-'));
  const wolf = path.join(project, '.wolf');
  fs.mkdirSync(wolf, { recursive: true });
  fs.writeFileSync(path.join(wolf, 'config.json'), JSON.stringify({ openwolf: {} }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(project, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  fs.writeFileSync(path.join(wolf, 'anatomy.md'), anatomyBody);
  return project;
}

const ANATOMY_OK = '# Anatomy\n\n## src/\n\n- `real.ts` — a real file (~1 tok)\n';

test('anatomy entries resolve against the project root, not .wolf/ (bug-695)', () => {
  // The defect: resolving "src/real.ts" against .wolf/ yields .wolf/src/real.ts,
  // which does not exist, so every real file reports missing. This test fails
  // loudly if the base regresses.
  const r = buildDriftReport(fixture(ANATOMY_OK));
  assert.equal(r.checks.anatomy.extracted, 1);
  assert.equal(r.checks.anatomy.checked, 1);
  assert.deepEqual(r.findings.filter((f) => f.kind === 'anatomy-missing'), []);
  assert.deepEqual(r.vacuous, []);
});

test('an anatomy entry with no file on disk is reported as drift', () => {
  const r = buildDriftReport(fixture(ANATOMY_OK + '- `ghost.ts` — not on disk (~1 tok)\n'));
  const missing = r.findings.filter((f) => f.kind === 'anatomy-missing');
  assert.equal(missing.length, 1);
  assert.match(missing[0].detail, /ghost\.ts$/);
  assert.equal(r.checks.anatomy.extracted, 2, 'both entries must be extracted');
});

test('a disconnected extractor is vacuous, never a silent pass', () => {
  // Entry syntax the regex cannot match: extraction yields zero from a
  // non-empty anatomy. A check that cannot fail must not report success.
  const r = buildDriftReport(fixture('# Anatomy\n\n## src/\n\n* `real.ts` — wrong bullet (~1 tok)\n'));
  assert.equal(r.checks.anatomy.extracted, 0);
  assert.equal(r.findings.length, 0, 'no findings — precisely why vacuity must be flagged');
  assert.ok(r.vacuous.some((v) => v.startsWith('anatomy:')), `expected vacuity flag, got ${JSON.stringify(r.vacuous)}`);
});

test('extracted always equals checked, so coverage cannot be overstated', () => {
  const r = buildDriftReport(fixture(ANATOMY_OK + '- `ghost.ts` — absent (~1 tok)\n'));
  assert.equal(r.checks.anatomy.extracted, r.checks.anatomy.checked);
});

test('entries appearing before any heading are not silently dropped', () => {
  // A bare entry has no section to resolve against; dropping it silently would
  // shrink the denominator invisibly. It must be counted and flagged.
  const r = buildDriftReport(fixture('# Anatomy\n\n- `orphan.ts` — no heading (~1 tok)\n' + ANATOMY_OK));
  assert.equal(r.checks.anatomy.extracted, 2, 'the pre-heading entry must count toward the denominator');
  assert.equal(r.checks.anatomy.extracted, r.checks.anatomy.checked);
  assert.ok(
    r.findings.some((f) => f.detail.includes('orphan.ts')) || r.vacuous.length > 0,
    'an unresolvable entry must surface as drift or vacuity, never vanish',
  );
});

test('CLI-source absence skips the command check instead of passing it', () => {
  const r = buildDriftReport(fixture(ANATOMY_OK));
  assert.ok(r.checks.commands.skipped, 'no src/cli/index.ts — must SKIP');
  assert.equal(r.checks.commands.findings, 0);
});

test('a missing anatomy.md skips rather than reporting a clean project', () => {
  const project = fixture(ANATOMY_OK);
  fs.rmSync(path.join(project, '.wolf', 'anatomy.md'));
  const r = buildDriftReport(project);
  assert.ok(r.checks.anatomy.skipped, 'absent anatomy must SKIP, not pass');
});

test('hand-written bold-format anatomy entries are extracted, not silently unseen', () => {
  // Auto-maintained anatomies use backticks; hand-written ones use bold. A
  // checker blind to one format reports a clean project it never examined.
  const r = buildDriftReport(fixture('# Anatomy\n\n## src/\n\n- **real.ts** — bold format (~1 tok)\n- **ghost.ts** — absent (~1 tok)\n'));
  assert.equal(r.checks.anatomy.extracted, 2);
  assert.deepEqual(r.vacuous, [], 'bold entries must be visible, so no vacuity');
  const missing = r.findings.filter((f) => f.kind === 'anatomy-missing');
  assert.equal(missing.length, 1);
  assert.match(missing[0].detail, /ghost\.ts$/);
});

test('prose section headings resolve to the project root, not a phantom directory', () => {
  // "## Top level" is not a directory. Treating it as one made README.md report
  // missing while sitting at the root (4/4 false positives on a real project).
  const r = buildDriftReport(
    fixture('# Anatomy\n\n## Top level\n\n- **README.md** — manifest (~1 tok)\n', { 'README.md': '# hi\n' }),
  );
  assert.equal(r.checks.anatomy.extracted, 1);
  assert.deepEqual(r.findings, [], 'README.md exists at the root and must not report missing');
});

test('brace-notation entries expand so each concrete file is checked', () => {
  const files = { 'docs/a_x.txt': '', 'docs/a_y.txt': '' };
  const ok = buildDriftReport(fixture('# Anatomy\n\n## docs/\n\n- `a_{x,y}.txt` — pair (~1 tok)\n', files));
  assert.deepEqual(ok.findings, [], 'both expansions exist');

  // ...and the expansion must still be able to fail: drop one sibling.
  const bad = buildDriftReport(
    fixture('# Anatomy\n\n## docs/\n\n- `a_{x,missing}.txt` — pair (~1 tok)\n', files),
  );
  assert.equal(bad.findings.length, 1, 'an absent brace variant must report drift');
});

test('entries carrying their own root-relative prefix are not double-joined', () => {
  // "## .wolf/qa/" + ".wolf/qa/x.md" must not become ".wolf/qa/.wolf/qa/x.md".
  const r = buildDriftReport(
    fixture('# Anatomy\n\n## docs/\n\n- `docs/real.md` — root-relative entry (~1 tok)\n', { 'docs/real.md': 'x\n' }),
  );
  assert.equal(r.checks.anatomy.extracted, 1);
  assert.deepEqual(r.findings, [], 'the file exists; the doubled prefix must not report it missing');
});

test('the dual-resolution fallback still fails on a genuinely absent file', () => {
  // Accepting two bases must not make the check unfalsifiable: a name that
  // resolves under NEITHER base is still drift.
  const r = buildDriftReport(
    fixture('# Anatomy\n\n## docs/\n\n- `docs/nowhere.md` — absent under both bases (~1 tok)\n', { 'docs/real.md': 'x\n' }),
  );
  assert.equal(r.findings.length, 1, 'must still detect a file absent under both bases');
  assert.match(r.findings[0].detail, /nowhere\.md/);
});

test('with no parked ledger the check SKIPs and names what it did not scan', () => {
  // Performance fix: the source walk is skipped without a ledger. The SKIP text
  // must state that marker discovery did not run — a bare "no parked questions"
  // would imply a scan that never happened.
  const r = buildDriftReport(fixture(ANATOMY_OK, {
    'src/real.ts': 'export const a = 1;\n',
    'src/marked.ts': '// TODO(UQ-7): unresolved\n',
  }));
  assert.ok(r.checks.parked.skipped, 'must skip');
  assert.match(r.checks.parked.skipped, /not scanned|orphan/i, `SKIP text must disclose unscanned markers, got: ${r.checks.parked.skipped}`);
  assert.equal(r.checks.parked.findings, 0);
});

test('with a ledger present, markers and entries are correlated in both directions', () => {
  const project = fixture(ANATOMY_OK, {
    'src/real.ts': 'export const a = 1;\n',
    'src/marked.ts': '// TODO(UQ-7): shipped placeholder\n',
  });
  // Ledger names UQ-9; code marks UQ-7 — one orphan in each direction.
  fs.writeFileSync(path.join(project, '.wolf', 'parked-questions.md'), '# Parked\n\n## UQ-9\n\nSTATUS: OPEN\n');
  const r = buildDriftReport(project);
  assert.ok(!r.checks.parked.skipped, 'a ledger exists — must not skip');
  const marker = r.findings.filter((f) => f.kind === 'uq-orphan-marker');
  const entry = r.findings.filter((f) => f.kind === 'uq-orphan-entry');
  assert.equal(marker.length, 1, 'UQ-7 is marked in code but absent from the ledger');
  assert.equal(entry.length, 1, 'UQ-9 is in the ledger but unmarked in code');
});

test('a truncated source walk is reported as vacuous, not silently partial', () => {
  // Depth and file-count caps bound runtime, but a silent cap understates
  // marker coverage — the check would report "no orphan markers" having never
  // reached them. Truncation must surface.
  const project = fixture(ANATOMY_OK);
  fs.writeFileSync(path.join(project, '.wolf', 'parked-questions.md'), '# P\n\n## UQ-1\n\nSTATUS: OPEN\n');
  let deep = project;
  for (let i = 0; i < 12; i++) {
    deep = path.join(deep, `n${i}`);
    fs.mkdirSync(deep);
  }
  fs.writeFileSync(path.join(deep, 'deep.ts'), '// TODO(UQ-1): beyond the depth cap\n');
  const r = buildDriftReport(project);
  assert.ok(
    r.vacuous.some((v) => /truncat/i.test(v)),
    `truncation must be reported, got ${JSON.stringify(r.vacuous)}`,
  );
});

test('a stale entry is not rescued by an unrelated same-named file at the root (bug-702)', () => {
  // The root fallback exists for entries carrying their own section prefix. An
  // UNCONDITIONAL fallback resolves a deleted file against any same-named file
  // elsewhere, which silently hides exactly the stale-entry class this command
  // exists to catch. Generic basenames make the collision ordinary.
  const r = buildDriftReport(
    fixture('# Anatomy\n\n## src/api/\n\n- `auth.ts` — API auth middleware (~1 tok)\n', {
      'src/api/other.ts': 'x\n', // auth.ts is gone from src/api/
      'auth.ts': 'unrelated root-level file\n', // same basename, different file
    }),
  );
  const missing = r.findings.filter((f) => f.kind === 'anatomy-missing');
  assert.equal(missing.length, 1, 'src/api/auth.ts is genuinely absent and must be reported');
  assert.match(missing[0].detail, /src[/\\]api[/\\]auth\.ts/);
});

test('the narrowed fallback still accepts a self-prefixed entry (bug-699 stays fixed)', () => {
  // "## .wolf/qa/" + ".wolf/qa/x.md" must still resolve — narrowing the fallback
  // must not reintroduce the doubled-prefix false positive it was added to fix.
  const r = buildDriftReport(
    fixture('# Anatomy\n\n## docs/\n\n- `docs/real.md` — self-prefixed entry (~1 tok)\n', { 'docs/real.md': 'x\n' }),
  );
  assert.deepEqual(r.findings, [], 'a self-prefixed entry whose file exists must not report drift');
});
