import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildQaStatusReport } from '../dist/src/cli/qa-cmd.js';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-qa-status-'));
  await mkdir(path.join(dir, '.wolf', 'qa'), { recursive: true });
  return dir;
}

test('qa status classifies current stale orphan and broken reductions', async () => {
  const dir = await fixture();
  try {
    await writeFile(path.join(dir, 'current.js'), 'const current = true;\n');
    await writeFile(path.join(dir, 'stale.js'), 'const stale = true;\n');
    await writeFile(path.join(dir, '.wolf', 'qa', 'current.md'), `---\ntarget: current.js\ntarget-hash: ${sha256('const current = true;\n')}\n---\n\n# Current\n`);
    await writeFile(path.join(dir, '.wolf', 'qa', 'stale.md'), `---\ntarget: stale.js\ntarget-hash: ${'0'.repeat(64)}\n---\n\n# Stale\n`);
    await writeFile(path.join(dir, '.wolf', 'qa', 'orphan.md'), `---\ntarget: missing.js\ntarget-hash: ${'1'.repeat(64)}\n---\n\n# Orphan\n`);
    await writeFile(path.join(dir, '.wolf', 'qa', 'broken.md'), `# No frontmatter\n`);
    await writeFile(path.join(dir, '.wolf', 'qa', 'missing-target.md'), `---\ntarget-hash: ${'2'.repeat(64)}\n---\n\n# Missing target\n`);

    const report = buildQaStatusReport(dir);
    assert.equal(report.counts.CURRENT, 1);
    assert.equal(report.counts.STALE, 1);
    assert.equal(report.counts.ORPHAN, 1);
    assert.equal(report.counts.BROKEN, 2);
    assert.equal(report.reductions.find((r) => r.path.endsWith('current.md')).status, 'CURRENT');
    assert.equal(report.reductions.find((r) => r.path.endsWith('stale.md')).status, 'STALE');
    assert.equal(report.reductions.find((r) => r.path.endsWith('orphan.md')).status, 'ORPHAN');
    assert.equal(report.reductions.find((r) => r.path.endsWith('broken.md')).status, 'BROKEN');
    assert.equal(report.reductions.find((r) => r.path.endsWith('missing-target.md')).status, 'BROKEN');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
