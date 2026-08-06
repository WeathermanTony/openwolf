import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  HASH_SENTINEL_TOMBSTONE,
  HASH_SENTINEL_UNREADABLE,
  hashFilesAtRest,
  hashReviewManifest,
  makeArtifactManifest,
  makeCurrentByteReceipt,
  makeSkillReceipt,
  normalizeFilePath,
  setReviewReviewedByteReceipt,
  validateArtifactManifest,
  validateSkillReceipt,
  verifySkillReceiptInputs,
} from '../src/hooks/shared.js';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fixture() {
  return mkdtemp(path.join(tmpdir(), 'wolf-skill-receipt-'));
}

test('artifact manifests canonicalize order and duplicate paths', async () => {
  const dir = await fixture();
  try {
    const first = path.join(dir, 'first.js');
    const second = path.join(dir, 'second.js');
    await writeFile(first, 'first\n');
    await writeFile(second, 'second\n');
    const hashes = hashFilesAtRest([first, second]);
    const a = makeArtifactManifest([second, first, first], hashes);
    const b = makeArtifactManifest([first, second], hashes);

    assert.deepEqual(a, b);
    assert.deepEqual(a.files, [normalizeFilePath(first), normalizeFilePath(second)].sort());
    assert.equal(a.manifest_hash, hashReviewManifest([first, second], hashes));
    assert.deepEqual(validateArtifactManifest(a), { valid: true, problems: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('artifact construction rejects silently missing declared hashes', async () => {
  const dir = await fixture();
  try {
    const first = path.join(dir, 'first.js');
    const second = path.join(dir, 'second.js');
    await writeFile(first, 'first\n');
    await writeFile(second, 'second\n');
    const partialHashes = hashFilesAtRest([first]);
    assert.throws(() => makeArtifactManifest([first, second], partialHashes), /Missing hashes for declared artifacts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('artifact validation rejects extra hashes and malformed values', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'target\n');
    const manifest = makeArtifactManifest([file], hashFilesAtRest([file]));
    const malformed = {
      ...manifest,
      hashes: { ...manifest.hashes, '/extra': 'not-a-hash' },
    };

    const result = validateArtifactManifest(malformed);
    assert.equal(result.valid, false);
    assert.match(result.problems.join('\n'), /exactly one entry per file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skill receipts preserve creation time and keep producer evidence opaque', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'input.js');
    await writeFile(file, 'input\n');
    const inputs = makeArtifactManifest([file], hashFilesAtRest([file]));
    const first = makeSkillReceipt({
      skill_id: 'quality-reduction',
      invocation_id: 'invocation-1',
      inputs,
      status: 'running',
      outcome: 'unknown',
      attestation_level: 'snapshot',
      now: '2026-08-06T10:00:00.000Z',
    });
    const completed = makeSkillReceipt({
      skill_id: 'quality-reduction',
      invocation_id: 'invocation-1',
      inputs,
      status: 'succeeded',
      outcome: 'clean',
      evidence: [{ kind: 'provider-receipt', value: 'opaque-provider-value', hash: sha256('opaque-provider-value') }],
      attestation_level: 'manifest-bound',
      now: '2026-08-06T10:01:00.000Z',
    }, first);

    assert.equal(completed.created_at, first.created_at);
    assert.equal(completed.updated_at, '2026-08-06T10:01:00.000Z');
    assert.equal(completed.inputs.manifest_hash, inputs.manifest_hash);
    assert.equal(completed.provenance.input_manifest_hash, inputs.manifest_hash);
    assert.deepEqual(validateSkillReceipt(completed), { valid: true, problems: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skill receipt validation rejects malformed terminal receipts', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'input.js');
    await writeFile(file, 'input\n');
    const inputs = makeArtifactManifest([file], hashFilesAtRest([file]));
    const receipt = makeSkillReceipt({
      skill_id: 'quality-reduction',
      invocation_id: 'invocation-2',
      inputs,
      status: 'succeeded',
      outcome: 'clean',
      now: '2026-08-06T10:00:00.000Z',
    });
    receipt.invocation.finished_at = null;
    receipt.provenance.input_manifest_hash = '0'.repeat(64);

    const result = validateSkillReceipt(receipt);
    assert.equal(result.valid, false);
    assert.match(result.problems.join('\n'), /finished_at/);
    assert.match(result.problems.join('\n'), /input_manifest_hash/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('receipt validation rejects malformed evidence and timestamp inversions', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'input.js');
    await writeFile(file, 'input\n');
    const inputs = makeArtifactManifest([file], hashFilesAtRest([file]));
    const receipt = makeSkillReceipt({
      skill_id: 'quality-reduction', invocation_id: 'bad-metadata', inputs,
      started_at: '2026-08-06T11:00:00.000Z', finished_at: '2026-08-06T10:00:00.000Z',
      evidence: [12345],
    });
    const result = validateSkillReceipt(receipt);
    assert.equal(result.valid, false);
    assert.match(result.problems.join('\n'), /finished_at must not precede/);
    assert.match(result.problems.join('\n'), /evidence entry/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('input verification distinguishes current, stale, unreadable, and malformed receipts', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'input.js');
    await writeFile(file, 'before\n');
    const inputs = makeArtifactManifest([file], hashFilesAtRest([file]));
    const receipt = makeSkillReceipt({
      skill_id: 'quality-reduction',
      invocation_id: 'invocation-3',
      inputs,
      status: 'succeeded',
      outcome: 'clean',
    });

    assert.equal(verifySkillReceiptInputs(receipt).status, 'CURRENT');
    await writeFile(file, 'after\n');
    assert.equal(verifySkillReceiptInputs(receipt).status, 'STALE');

    const unreadableInputs = makeArtifactManifest([file], { [normalizeFilePath(file)]: HASH_SENTINEL_UNREADABLE });
    const unreadable = makeSkillReceipt({ skill_id: 'quality-reduction', invocation_id: 'invocation-4', inputs: unreadableInputs, attestation_level: 'snapshot' });
    assert.equal(verifySkillReceiptInputs(unreadable).status, 'UNREADABLE');

    assert.equal(verifySkillReceiptInputs({ version: 1 }).status, 'MALFORMED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('vacuous and tombstone attestations are rejected while snapshots remain valid', async () => {
  const dir = await fixture();
  try {
    const emptyInputs = makeArtifactManifest([], {});
    const vacuous = makeSkillReceipt({ skill_id: 'quality-reduction', invocation_id: 'empty', inputs: emptyInputs, attestation_level: 'manifest-bound' });
    assert.equal(validateSkillReceipt(vacuous).valid, false);

    const missing = path.join(dir, 'missing.js');
    const normalizedMissing = normalizeFilePath(missing);
    const tombstoneManifest = makeArtifactManifest([missing], { [normalizedMissing]: HASH_SENTINEL_TOMBSTONE });
    const snapshot = makeSkillReceipt({ skill_id: 'quality-reduction', invocation_id: 'snapshot', inputs: tombstoneManifest, status: 'planned', attestation_level: 'snapshot' });
    assert.deepEqual(validateSkillReceipt(snapshot), { valid: true, problems: [] });
    const attested = makeSkillReceipt({ skill_id: 'quality-reduction', invocation_id: 'attested', inputs: tombstoneManifest, attestation_level: 'manifest-bound' });
    assert.equal(validateSkillReceipt(attested).valid, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('review receipt compatibility is unchanged', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'reviewed.js');
    await writeFile(file, 'reviewed\n');
    const hashes = hashFilesAtRest([file]);
    const review = {};
    setReviewReviewedByteReceipt(review, [file], hashes, { reviewer: 'test', source: 'reviewed-hash' });

    assert.equal(review.receipt.kind, 'reviewed-byte');
    assert.equal(review.reviewed_hash, hashReviewManifest([file], hashes));
    assert.deepEqual(review.content_hashes, hashes);
    assert.deepEqual(review.reviewed_hashes, hashes);
    assert.equal(review.review_provenance.kind, 'reviewer-saw-current-bytes');
    assert.equal(makeCurrentByteReceipt([file], hashes).reviewed_hash, review.reviewed_hash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
