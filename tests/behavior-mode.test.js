import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { normalizeBehaviorMode as normalizeHookBehavior, resolveBehavior } from '../dist/src/hooks/shared.js';
import { applyBehaviorMode, normalizeBehaviorMode as normalizeCliBehavior } from '../dist/src/cli/init.js';
import { planBackupRetention } from '../dist/src/cli/update.js';

const repo = path.resolve(import.meta.dirname, '..');

function fixture(config = { version: 1, openwolf: { behavior: { mode: 'quiet' } } }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-behavior-'));
  fs.mkdirSync(path.join(root, '.wolf', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.wolf', 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(root, '.wolf', 'memory.md'), '# Memory\n');
  fs.writeFileSync(path.join(root, '.wolf', 'cerebrum.md'), '# Cerebrum\n');
  fs.writeFileSync(path.join(root, '.wolf', 'buglog.json'), '{"version":1,"bugs":[]}');
  fs.writeFileSync(path.join(root, '.wolf', 'token-ledger.json'), '{"version":1,"lifetime":{"total_sessions":0}}');
  return root;
}

function runHook(name, root, input = {}) {
  return spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', `${name}.js`)], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

test('behavior resolver separates explicit, fresh, legacy, and invalid sources', () => {
  assert.equal(normalizeHookBehavior(' QUIET '), 'quiet');
  assert.equal(normalizeHookBehavior('loud'), undefined);
  assert.deepEqual(resolveBehavior({ openwolf: { behavior: { mode: 'standard' } } }, { installationKind: 'fresh' }), {
    mode: 'standard', source: 'explicit', explicitlyConfigured: true,
  });
  assert.deepEqual(resolveBehavior({}, { installationKind: 'fresh' }), {
    mode: 'quiet', source: 'fresh-default', explicitlyConfigured: false,
  });
  assert.deepEqual(resolveBehavior({}, { installationKind: 'existing' }), {
    mode: 'standard', source: 'legacy-compatibility', explicitlyConfigured: false,
  });
  assert.deepEqual(resolveBehavior({ openwolf: { behavior: { mode: 'noisy' } } }, { installationKind: 'existing' }), {
    mode: 'standard', source: 'invalid-fallback', explicitlyConfigured: false,
  });
});

test('CLI behavior writer preserves reviewer policy and stamps legacy compatibility', () => {
  const root = fixture({ openwolf: { hook_messages: { reviewer_profile: 'budget' } } });
  const configPath = path.join(root, '.wolf', 'config.json');
  assert.equal(applyBehaviorMode(configPath, undefined, 'existing'), 'standard');
  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.openwolf.behavior.mode, 'standard');
  assert.equal(config.openwolf.hook_messages.reviewer_profile, 'budget');
  assert.equal(applyBehaviorMode(configPath, 'quiet', 'existing'), 'quiet');
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.openwolf.behavior.mode, 'quiet');
  assert.equal(normalizeCliBehavior(' STANDARD '), 'standard');
  assert.throws(() => normalizeCliBehavior('noisy'), /quiet.*standard/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('config defaults stay synchronized', () => {
  const files = ['src/config/default-config.json', 'src/templates/config.json', 'templates/wolf/config.json'];
  const configs = files.map(file => JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8')));
  for (const config of configs) {
    assert.deepEqual(config.openwolf.behavior, { mode: 'quiet' });
    assert.deepEqual(config.openwolf.backups, { retention_days: 30, keep_last: 3, protect_pending_reviews: true });
  }
});

test('backup retention never infers deletion for legacy or pending-review backups', () => {
  const root = fixture({ openwolf: { backups: { retention_days: 0, keep_last: 1, protect_pending_reviews: true } } });
  const backups = path.join(root, '.wolf', 'backups');
  fs.mkdirSync(backups);
  const names = ['20260101T0000', '20260102T0000', '20260103T0000'];
  for (const name of names) fs.mkdirSync(path.join(backups, name));
  fs.writeFileSync(path.join(backups, names[1], 'backup-manifest.json'), JSON.stringify({ created_at: '2026-01-02T00:00:00Z', pending_reviews: [{ id: 'review-1' }] }));
  fs.writeFileSync(path.join(backups, names[2], 'backup-manifest.json'), JSON.stringify({ created_at: '2026-01-03T00:00:00Z', pending_reviews: [] }));
  const plan = planBackupRetention(path.join(root, '.wolf'));
  assert.ok(plan.keep.includes(path.join(backups, names[0])), 'legacy backup is protected');
  assert.ok(plan.keep.includes(path.join(backups, names[1])), 'pending review backup is protected');
  assert.ok(plan.keep.includes(path.join(backups, names[2])), 'newest backup is protected by keep_last');
  assert.deepEqual(plan.prune, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('quiet hooks retain session/write correctness state without bookkeeping prose', () => {
  const root = fixture();
  const memoryBefore = fs.readFileSync(path.join(root, '.wolf', 'memory.md'), 'utf8');
  assert.equal(runHook('session-start', root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, '.wolf', 'memory.md'), 'utf8'), memoryBefore);
  const target = path.join(root, 'sample.ts');
  fs.writeFileSync(target, 'export const value = 1;\n');
  assert.equal(runHook('post-write', root, { tool_name: 'Write', tool_input: { file_path: target, content: 'export const value = 1;\n' } }).status, 0);
  const session = JSON.parse(fs.readFileSync(path.join(root, '.wolf', 'hooks', '_session.json'), 'utf8'));
  assert.equal(session.files_written.length, 1);
  assert.equal(session.files_written[0].file.replaceAll('\\', '/'), target.replaceAll('\\', '/'));
  assert.equal(session.files_written[0].tokens, 0);
  assert.equal(runHook('pre-read', root, { tool_input: { file_path: target } }).stderr, '');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(root, '.wolf', 'hooks', '_session.json'), 'utf8')).files_read).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
