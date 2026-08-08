import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canaryDir = path.join(root, '.wolf/experiments/mem0-canary');
const scorer = await import(path.join(canaryDir, 'scorer.mjs'));
const extractor = await import(path.join(canaryDir, 'extractor.mjs'));
const learning = await import(path.join(root, 'dist/src/hooks/nudges/rules/learning.js'));
const official = scorer.loadOfficialBundle(canaryDir);

function score(overrides = {}) {
  return scorer.scoreCanary({ ...official, baseDir: canaryDir, classifyControl: learning.classifyExplicitLearning, ...overrides });
}

function clone(value) { return structuredClone(value); }

test('official protected evaluator is current and reports every fixture', () => {
  const result = score();
  assert.equal(result.valid, true, result.problems?.join('; '));
  assert.equal(result.cases.length, official.fixtures.cases.length);
  assert.equal(result.metrics.cases_reported, 48);
});

test('official treatment survives fixture conformance only when every gate passes', () => {
  const result = score();
  assert.equal(result.verdict, 'survived-for-follow-up-design');
  assert.equal(result.metrics.treatment_positive_correct, 18);
  assert.equal(result.metrics.treatment_false_positives, 0);
  assert.equal(result.metrics.safety_false_positives, 0);
  assert.equal(result.metrics.baseline_regressions, 0);
  assert.ok(result.metrics.recovered_baseline_false_negatives >= 3);
  assert.equal(result.scope, 'offline fixture conformance only');
});

test('manifest drift fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem0-manifest-'));
  for (const name of ['fixtures.json', 'rubric.json', 'extractor.mjs', 'scorer.mjs', 'manifest.json']) fs.copyFileSync(path.join(canaryDir, name), path.join(dir, name));
  fs.appendFileSync(path.join(dir, 'extractor.mjs'), '\n// drift\n');
  const bundle = scorer.loadOfficialBundle(dir);
  const result = scorer.scoreCanary({ ...bundle, baseDir: dir, classifyControl: learning.classifyExplicitLearning });
  assert.equal(result.verdict, 'inconclusive');
  assert.match(result.problems.join('\n'), /protected bytes changed/);
});

test('malformed and duplicate fixtures fail closed', () => {
  const fixtures = clone(official.fixtures);
  fixtures.cases.push({ ...fixtures.cases[0] });
  const rubric = clone(official.rubric);
  rubric.thresholds.positive_total++;
  const result = score({ fixtures, rubric, manifest: null });
  assert.equal(result.verdict, 'inconclusive');
  assert.match(result.problems.join('\n'), /duplicate fixture id/);
});

test('unknown fixture fields and unknown treatment fields fail closed', () => {
  const fixtures = clone(official.fixtures);
  fixtures.cases[0].unexpected = true;
  assert.equal(score({ fixtures, manifest: null }).verdict, 'inconclusive');
  const result = score({ treatment: (fixture) => ({ ...extractor.extractCandidate(fixture), extra: true }) });
  assert.equal(result.verdict, 'inconclusive');
  assert.match(result.problems.join('\n'), /unknown output fields/);
});

test('one unsafe false positive falsifies an otherwise valid treatment', () => {
  const treatment = (fixture) => fixture.id === 'neg-control-02'
    ? { fixture_id: fixture.id, source_hash: 'a'.repeat(64), source: 'user', trust: 'unreviewed', kind: 'preference', target_section: '## User Preferences', text: fixture.text, topic_key: 'unsafe' }
    : extractor.extractCandidate(fixture);
  const result = score({ treatment });
  assert.equal(result.verdict, 'falsified');
  assert.equal(result.metrics.safety_false_positives, 1);
});

test('insufficient incremental recovery remains inconclusive', () => {
  const treatment = (fixture) => {
    if (fixture.oracle === 'reject') return { fixture_id: fixture.id, accepted: false, reason: 'negative-control' };
    const control = fixture.source === 'user' ? learning.classifyExplicitLearning(fixture.text) : null;
    if (!control) return { fixture_id: fixture.id, accepted: false, reason: 'baseline-reject' };
    return { fixture_id: fixture.id, source_hash: 'b'.repeat(64), source: 'user', trust: 'unreviewed', kind: control.kind, target_section: control.section, text: fixture.text.replace(/\s+/g, ' ').trim(), topic_key: control.topic_key };
  };
  const result = score({ treatment });
  assert.equal(result.verdict, 'inconclusive');
  assert.equal(result.metrics.treatment_false_positives, 0);
  assert.equal(result.metrics.recovered_baseline_false_negatives, 0);
});

test('all adversarial classes reject, including invisible Unicode and control text', () => {
  const result = score();
  const negatives = result.cases.filter((item) => item.oracle === 'reject');
  assert.equal(negatives.length, 30);
  assert.ok(negatives.every((item) => item.treatment.accepted === false));
  for (const id of ['neg-bidi-01', 'neg-zero-01', 'neg-control-01', 'neg-control-02', 'neg-secret-01']) {
    assert.equal(result.cases.find((item) => item.id === id).treatment.accepted, false, id);
  }
});

test('extractor is deterministic, bounded, untrusted, and preserves qualifiers', () => {
  for (const fixture of official.fixtures.cases) {
    const one = extractor.extractCandidate(fixture);
    const two = extractor.extractCandidate(clone(fixture));
    assert.deepEqual(one, two, fixture.id);
    if (one.accepted !== false) {
      assert.equal(one.trust, 'unreviewed');
      assert.equal(one.source, 'user');
      assert.equal(one.text, fixture.text.replace(/\s+/g, ' ').trim());
      assert.deepEqual(Object.keys(one).sort(), official.rubric.allowed_proposal_fields.slice().sort());
    }
  }
});

test('canary does not mutate Cerebrum or nudge state', () => {
  const cerebrum = path.join(root, '.wolf/cerebrum.md');
  const nudge = path.join(root, '.wolf/nudge-state.json');
  const beforeC = fs.readFileSync(cerebrum);
  const beforeN = fs.existsSync(nudge) ? fs.readFileSync(nudge) : null;
  score();
  assert.deepEqual(fs.readFileSync(cerebrum), beforeC);
  if (beforeN) assert.deepEqual(fs.readFileSync(nudge), beforeN);
  else assert.equal(fs.existsSync(nudge), false);
});

test('extractor source has no I/O, process, network, or runtime integration imports', () => {
  const body = fs.readFileSync(path.join(canaryDir, 'extractor.mjs'), 'utf8');
  for (const forbidden of ['node:fs', 'child_process', 'node:http', 'node:https', 'fetch(', 'readRecentUserTurns', 'recordCerebrumCandidate', 'makeCandidate', 'evaluate(']) {
    assert.equal(body.includes(forbidden), false, forbidden);
  }
});
