import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyManagedPayloadCleanup, buildManagedPayloadCleanupManifest, MANAGED_RUNTIME_UTILITIES, OBSOLETE_PAYLOAD } from '../dist/src/cli/managed-payload.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sourceByDestination = {
  '.wolf/PROTOCOL-UPGRADE-2026-06.md': path.join(repoRoot, 'templates/wolf/PROTOCOL-UPGRADE-2026-06.md'),
  '.wolf/utils/fs-safe.js': path.join(repoRoot, 'dist/src/utils/fs-safe.js'),
  '.wolf/utils/logger.js': path.join(repoRoot, 'dist/src/utils/logger.js'),
  '.wolf/utils/paths.js': path.join(repoRoot, 'dist/src/utils/paths.js'),
  '.wolf/utils/platform.js': path.join(repoRoot, 'dist/src/utils/platform.js'),
  '.wolf/utils/port-allocator.js': path.join(repoRoot, 'dist/src/utils/port-allocator.js'),
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-managed-payload-'));
  for (const entry of OBSOLETE_PAYLOAD) {
    const destination = path.join(root, ...entry.destination.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourceByDestination[entry.destination], destination);
  }
  fs.writeFileSync(path.join(root, '.wolf', 'utils', 'adjacent-user-file.js'), 'keep me\n');
  fs.writeFileSync(path.join(root, '.wolf', 'reviewlog.json'), '{"reviews":[]}\n');
  return root;
}

function backupFor(root) {
  const backup = path.join(root, '.wolf', 'backups', 'test');
  for (const entry of OBSOLETE_PAYLOAD) {
    const source = path.join(root, ...entry.destination.split('/'));
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
    const relative = path.relative(path.join(root, '.wolf'), source);
    const destination = path.join(backup, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return backup;
}

test('managed runtime utility allowlist contains only installed hook dependency', () => {
  assert.deepEqual([...MANAGED_RUNTIME_UTILITIES], ['size-discipline.js']);
});

test('cleanup classifies exact owned bytes and preserves modified, symlink, and adjacent files', () => {
  const root = fixture();
  try {
    const logger = path.join(root, '.wolf', 'utils', 'logger.js');
    fs.appendFileSync(logger, '// user change\n');
    const platform = path.join(root, '.wolf', 'utils', 'platform.js');
    fs.unlinkSync(platform);
    fs.symlinkSync(path.join(root, '.wolf', 'reviewlog.json'), platform);

    const { manifest } = buildManagedPayloadCleanupManifest([root]);
    const byPath = new Map(manifest.projects[0].items.map(item => [item.destination, item]));
    assert.equal(byPath.get('.wolf/PROTOCOL-UPGRADE-2026-06.md').disposition, 'delete-owned');
    assert.equal(byPath.get('.wolf/utils/logger.js').disposition, 'preserve-modified');
    assert.equal(byPath.get('.wolf/utils/platform.js').disposition, 'preserve-symlink');
    assert.equal(fs.readFileSync(path.join(root, '.wolf', 'utils', 'adjacent-user-file.js'), 'utf8'), 'keep me\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cleanup requires the reviewed current manifest, verifies backup, and is idempotent', () => {
  const root = fixture();
  try {
    const first = buildManagedPayloadCleanupManifest([root]);
    const backup = backupFor(root);
    assert.throws(() => applyManagedPayloadCleanup('0'.repeat(64), [root], new Map([[root, backup]])), /manifest hash mismatch/i);
    const result = applyManagedPayloadCleanup(first.hash, [root], new Map([[root, backup]]));
    assert.equal(result.removed.length, OBSOLETE_PAYLOAD.length);
    for (const entry of OBSOLETE_PAYLOAD) assert.equal(fs.existsSync(path.join(root, ...entry.destination.split('/'))), false);
    assert.equal(fs.readFileSync(path.join(root, '.wolf', 'utils', 'adjacent-user-file.js'), 'utf8'), 'keep me\n');
    assert.equal(fs.readFileSync(path.join(root, '.wolf', 'reviewlog.json'), 'utf8'), '{"reviews":[]}\n');

    const second = buildManagedPayloadCleanupManifest([root]);
    const secondResult = applyManagedPayloadCleanup(second.hash, [root], new Map([[root, backup]]));
    assert.deepEqual(secondResult.removed, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cleanup refuses plan-to-apply byte drift', () => {
  const root = fixture();
  try {
    const planned = buildManagedPayloadCleanupManifest([root]);
    const backup = backupFor(root);
    fs.appendFileSync(path.join(root, '.wolf', 'utils', 'paths.js'), '// changed after review\n');
    assert.throws(() => applyManagedPayloadCleanup(planned.hash, [root], new Map([[root, backup]])), /manifest hash mismatch/i);
    assert.equal(fs.existsSync(path.join(root, '.wolf', 'PROTOCOL-UPGRADE-2026-06.md')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cleanup refuses deletion when exact backup bytes are missing', () => {
  const root = fixture();
  try {
    const planned = buildManagedPayloadCleanupManifest([root]);
    const backup = backupFor(root);
    fs.unlinkSync(path.join(backup, 'utils', 'logger.js'));
    assert.throws(() => applyManagedPayloadCleanup(planned.hash, [root], new Map([[root, backup]])), /backup missing/i);
    for (const entry of OBSOLETE_PAYLOAD) {
      assert.equal(fs.existsSync(path.join(root, ...entry.destination.split('/'))), true, `preflight failure must preserve ${entry.destination}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cleanup restores earlier deletions when a later unlink fails', () => {
  const root = fixture();
  try {
    const planned = buildManagedPayloadCleanupManifest([root]);
    const backup = backupFor(root);
    let attempts = 0;
    const unlink = (file) => {
      attempts++;
      if (attempts === 3) throw new Error('injected unlink failure');
      fs.unlinkSync(file);
    };
    assert.throws(
      () => applyManagedPayloadCleanup(planned.hash, [root], new Map([[root, backup]]), { unlink }),
      /injected unlink failure; prior deletions restored/i,
    );
    assert.equal(attempts, 3, 'fault injection must execute after prior deletions');
    for (const entry of OBSOLETE_PAYLOAD) {
      assert.equal(fs.existsSync(path.join(root, ...entry.destination.split('/'))), true, `rollback must restore ${entry.destination}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
