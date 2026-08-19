import test from 'node:test';
import assert from 'node:assert';
import { providerWordingHits, extractDescription } from '../dist/src/cli/skillsbench.js';

// The lint exists to catch descriptions whose trigger surface is narrowed to a
// vendor's vocabulary. Each test below asserts an observable consequence of the
// extraction, not just its literal return value.

test('provider wording in a description is reported', () => {
  const hits = providerWordingHits('Audit Azure resource policies for drift');
  assert.deepEqual(hits.map(h => h.toLowerCase()), ['azure']);
});

test('a vendor-neutral description produces no hits (the lint can pass)', () => {
  const hits = providerWordingHits('Audit cloud resource policies for drift');
  assert.equal(hits.length, 0);
});

test('multiple providers are all reported, not just the first', () => {
  const hits = providerWordingHits('Sync between AWS and Google Cloud buckets');
  assert.equal(hits.length, 2, `expected both providers, got ${JSON.stringify(hits)}`);
});

test('substrings do not trigger (no false positive on ordinary prose)', () => {
  // "awswomeness" contains "aws"; word boundaries must prevent a hit.
  assert.equal(providerWordingHits('Measure the awswomeness of a build').length, 0);
  assert.equal(providerWordingHits('Grade code on its openaiish qualities').length, 0);
});

test('quoted inline description is extracted', () => {
  assert.equal(extractDescription('name: x\ndescription: "Audit Azure policies"\n'), 'Audit Azure policies');
});

test('unquoted inline description is extracted', () => {
  assert.equal(extractDescription('name: x\ndescription: Audit Azure policies\n'), 'Audit Azure policies');
});

// Vacuity guard: if the block-scalar form returned "" the lint would silently
// pass on every skill using it. This asserts the wording actually survives
// extraction and reaches the lint.
test('folded block-scalar description is extracted and still lints (vacuity guard)', () => {
  const fm = 'name: x\ndescription: >\n  Audit Azure resource\n  policies for drift\nversion: 1\n';
  const desc = extractDescription(fm);
  assert.ok(desc && desc.includes('Azure'), `block scalar lost its body: ${JSON.stringify(desc)}`);
  assert.equal(providerWordingHits(desc).length, 1, 'lint must still fire through the block form');
});

test('literal block-scalar description is extracted', () => {
  const fm = 'name: x\ndescription: |\n  Audit AWS buckets\nversion: 1\n';
  const desc = extractDescription(fm);
  assert.ok(desc && desc.includes('AWS'), `got ${JSON.stringify(desc)}`);
});

test('a missing description is null, not empty string (so the caller can reject it)', () => {
  assert.equal(extractDescription('name: x\nversion: 1\n'), null);
});

test('an empty description does not masquerade as extracted content', () => {
  // `description:` with nothing after it must not silently yield a passing lint.
  const desc = extractDescription('name: x\ndescription:\nversion: 1\n');
  assert.ok(desc === null || desc === '', `got ${JSON.stringify(desc)}`);
});
