import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isActivePm2Process } from '../dist/src/cli/daemon-cmd.js';
import { shouldStartDaemonForProject } from '../dist/src/daemon/startup-guard.js';
import { migrateReviewCompanionConfig, normalizeReviewerProfile } from '../dist/src/cli/init.js';

test('PM2 daemon activity requires online status and a live pid', () => {
  assert.equal(isActivePm2Process(null), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'stopped' }, pid: 1234 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'errored' }, pid: 1234 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' } }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' }, pid: 0 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' }, pid: 1234 }), true);
});

test('daemon refuses to start when project runtime directory was deleted', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-deleted-project-'));
  try {
    const wolfDir = path.join(dir, '.wolf');
    assert.equal(shouldStartDaemonForProject(dir, wolfDir), false);
    await mkdir(wolfDir);
    assert.equal(shouldStartDaemonForProject(dir, wolfDir), true);
    await rm(dir, { recursive: true, force: true });
    assert.equal(shouldStartDaemonForProject(dir, wolfDir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reviewer profile aliases include budget token-rich mode', () => {
  assert.equal(normalizeReviewerProfile('gov'), 'us-only');
  assert.equal(normalizeReviewerProfile('open'), 'open');
  assert.equal(normalizeReviewerProfile('budget'), 'budget');
  assert.equal(normalizeReviewerProfile('glm'), 'budget');
  assert.throws(() => normalizeReviewerProfile('unknown'), /gov.*open.*budget/);
});

test('review companion config migration removes only the exact legacy default', () => {
  const migrated = migrateReviewCompanionConfig({
    keep: true,
    openwolf: {
      review_hook: { codex_command: 'codex exec --full-auto', min_diff_lines: 99 },
      hook_messages: { reviewer_profile: 'budget' },
    },
  });
  assert.equal(migrated.keep, true);
  assert.equal(migrated.openwolf.review_hook.review_companion, 'provider companion');
  assert.equal(migrated.openwolf.review_hook.codex_command, undefined);
  assert.equal(migrated.openwolf.review_hook.min_diff_lines, 99);
  assert.equal(migrated.openwolf.hook_messages.reviewer_profile, 'budget');
});

test('review companion config migration preserves customized deprecated aliases but ignores malformed roots', () => {
  const custom = migrateReviewCompanionConfig({ openwolf: { review_hook: { codex_command: 'custom legacy wrapper', review_companion: 'custom companion' } } });
  assert.equal(custom.openwolf.review_hook.codex_command, 'custom legacy wrapper');
  assert.equal(custom.openwolf.review_hook.review_companion, 'custom companion');

  const malformed = migrateReviewCompanionConfig({ openwolf: [] });
  assert.equal(malformed.openwolf.review_hook.review_companion, 'provider companion');
});
