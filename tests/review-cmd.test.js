import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(repoRoot, 'dist/bin/openwolf.js');

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-review-cmd-'));
  await mkdir(path.join(dir, '.wolf', 'hooks'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), '{}\n');
  return dir;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function manifestHash(file, hash) {
  return sha256(JSON.stringify([[file, hash]]));
}

function runWolf(dir, args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
}

test('review hash prints manifest hash and per-file hashes', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'const x = 1;\n');
    const fileHash = sha256('const x = 1;\n');
    const result = runWolf(dir, ['review', 'hash', file]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(manifestHash(file, fileHash)));
    assert.match(result.stdout, new RegExp(fileHash));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('review list and show report provenance state', async () => {
  const dir = await fixture();
  try {
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'const listed = true;\n');
    const fileHash = sha256('const listed = true;\n');
    await writeFile(path.join(dir, '.wolf', 'reviewlog.json'), JSON.stringify({
      version: 1,
      reviews: [{
        id: 'review-0001',
        status: 'pending',
        files: [file],
        content_hashes: { [file]: fileHash },
        receipt: { kind: 'current-byte', reviewed_hash: manifestHash(file, fileHash), hashes: { [file]: fileHash } },
      }],
    }, null, 2));

    const list = runWolf(dir, ['review', 'list']);
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /review-0001 pending/);
    assert.match(list.stdout, /no-reviewed-hash/);

    const show = runWolf(dir, ['review', 'show', 'review-0001']);
    assert.equal(show.status, 0, show.stderr);
    assert.match(show.stdout, /Current manifest hash:/);
    assert.doesNotMatch(show.stdout, /Reviewed hash:/);
    assert.match(show.stdout, /same/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('review complete delegates reviewed-hash completion helper', async () => {
  const dir = await fixture();
  try {
    await copyFile(path.join(repoRoot, 'src/hooks/complete-review.js'), path.join(dir, '.wolf', 'hooks', 'complete-review.js'));
    await copyFile(path.join(repoRoot, 'src/hooks/shared.js'), path.join(dir, '.wolf', 'hooks', 'shared.js'));
    await mkdir(path.join(dir, '.wolf', 'utils'), { recursive: true });
    await copyFile(path.join(repoRoot, 'src/utils/size-discipline.js'), path.join(dir, '.wolf', 'utils', 'size-discipline.js'));
    const file = path.join(dir, 'target.js');
    await writeFile(file, 'const complete = true;\n');
    const fileHash = sha256('const complete = true;\n');
    const reviewedHash = manifestHash(file, fileHash);
    await writeFile(path.join(dir, '.wolf', 'reviewlog.json'), JSON.stringify({
      version: 1,
      reviews: [{ id: 'review-0001', status: 'pending', files: [file], content_hashes: { [file]: fileHash } }],
    }, null, 2));

    const result = runWolf(dir, ['review', 'complete', 'review-0001', '--reviewer', 'cli-test', '--summary', 'clean', '--reviewed-hash', reviewedHash]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /completed review-0001/);

    const log = JSON.parse(await readFile(path.join(dir, '.wolf', 'reviewlog.json'), 'utf8'));
    const review = log.reviews[0];
    assert.equal(review.status, 'completed');
    assert.equal(review.reviewer, 'cli-test');
    assert.equal(review.reviewed_hash, reviewedHash);
    assert.equal(review.receipt.kind, 'reviewed-byte');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
