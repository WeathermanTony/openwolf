import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isActivePm2Process, isDashboardPm2Process, isPm2DaemonPidAlive, listPm2Processes, ownedPm2ProcessForRoot } from '../dist/src/cli/daemon-cmd.js';
import { isExpectedDashboardHealth } from '../dist/src/cli/dashboard.js';
import { shouldStartDaemonForProject } from '../dist/src/daemon/startup-guard.js';
import { migrateReviewCompanionConfig, normalizeReviewerProfile, shouldAutoStartDaemon } from '../dist/src/cli/init.js';

test('daemon auto-start is disabled unless explicitly true', () => {
  assert.equal(shouldAutoStartDaemon(undefined), false);
  assert.equal(shouldAutoStartDaemon(null), false);
  assert.equal(shouldAutoStartDaemon({}), false);
  assert.equal(shouldAutoStartDaemon({ openwolf: [] }), false);
  assert.equal(shouldAutoStartDaemon({ openwolf: { daemon: null } }), false);
  assert.equal(shouldAutoStartDaemon({ openwolf: { daemon: {} } }), false);
  assert.equal(shouldAutoStartDaemon({ openwolf: { daemon: { auto_start: false } } }), false);
  assert.equal(shouldAutoStartDaemon({ openwolf: { daemon: { auto_start: 'true' } } }), false);
  assert.equal(shouldAutoStartDaemon({ openwolf: { daemon: { auto_start: true } } }), true);
});

test('PM2 listing does not invoke pm2 without a live daemon pid', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ow-pm2-list-'));
  const bin = path.join(root, 'bin');
  const pm2Home = path.join(root, 'pm2');
  const marker = path.join(root, 'invoked');
  await mkdir(bin);
  await mkdir(pm2Home);
  const fakePm2 = path.join(bin, 'pm2');
  fs.writeFileSync(fakePm2, `#!/bin/sh\nprintf invoked > "$PM2_MARKER"\nprintf '[{"name":"fixture","pid":123}]'\n`);
  fs.chmodSync(fakePm2, 0o755);
  const previous = { PATH: process.env.PATH, PM2_HOME: process.env.PM2_HOME, PM2_MARKER: process.env.PM2_MARKER };
  process.env.PATH = `${bin}${path.delimiter}${previous.PATH ?? ''}`;
  process.env.PM2_HOME = pm2Home;
  process.env.PM2_MARKER = marker;
  try {
    assert.deepEqual(listPm2Processes(), []);
    assert.equal(fs.existsSync(marker), false, 'missing pid file must not invoke pm2');

    for (const invalid of ['', 'abc', '0', '-1', '123junk', '9007199254740992']) {
      fs.writeFileSync(path.join(pm2Home, 'pm2.pid'), invalid);
      assert.deepEqual(listPm2Processes(), [], `invalid pid ${JSON.stringify(invalid)} should be rejected`);
      assert.equal(fs.existsSync(marker), false, 'malformed pid must not invoke pm2');
    }

    const exited = spawnSync(process.execPath, ['--eval', ''], { stdio: 'ignore' });
    assert.ok(exited.pid > 0);
    assert.throws(() => process.kill(exited.pid, 0));
    fs.writeFileSync(path.join(pm2Home, 'pm2.pid'), String(exited.pid));
    assert.deepEqual(listPm2Processes(), []);
    assert.equal(fs.existsSync(marker), false, 'dead pid must not invoke pm2');

    fs.writeFileSync(path.join(pm2Home, 'pm2.pid'), String(process.pid));
    assert.deepEqual(listPm2Processes(), [{ name: 'fixture', pid: 123 }]);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'invoked');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('PM2 listing uses HOME/.pm2 when PM2_HOME is unset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ow-pm2-home-'));
  const bin = path.join(root, 'bin');
  const pm2Home = path.join(root, '.pm2');
  const marker = path.join(root, 'invoked');
  await mkdir(bin);
  await mkdir(pm2Home);
  fs.writeFileSync(path.join(pm2Home, 'pm2.pid'), String(process.pid));
  const fakePm2 = path.join(bin, 'pm2');
  fs.writeFileSync(fakePm2, `#!/bin/sh\nprintf invoked > "$PM2_MARKER"\nprintf '[]'\n`);
  fs.chmodSync(fakePm2, 0o755);
  try {
    const moduleUrl = new URL('../dist/src/cli/daemon-cmd.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { listPm2Processes } from ${JSON.stringify(moduleUrl)};
      console.log(JSON.stringify(listPm2Processes()));
    `], {
      env: {
        ...process.env,
        HOME: root,
        PM2_HOME: '',
        PM2_MARKER: marker,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '[]');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'invoked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PM2 daemon pid liveness treats EPERM as alive and ESRCH as dead', () => {
  const errorWith = (code) => () => { const error = new Error(code); error.code = code; throw error; };
  assert.equal(isPm2DaemonPidAlive(42, errorWith('EPERM')), true);
  assert.equal(isPm2DaemonPidAlive(42, errorWith('ESRCH')), false);
  assert.equal(isPm2DaemonPidAlive(0, () => true), false);
  assert.equal(isPm2DaemonPidAlive(Number.MAX_SAFE_INTEGER + 1, () => true), false);
});

test('PM2 daemon activity requires online status and a live pid', () => {
  assert.equal(isActivePm2Process(null), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'stopped' }, pid: 1234 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'errored' }, pid: 1234 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' } }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' }, pid: 0 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' }, pid: 1234 }), true);
});

test('PM2 dashboard mode is preserved only for the explicit enabled marker', () => {
  assert.equal(isDashboardPm2Process(null), false);
  assert.equal(isDashboardPm2Process({ pm2_env: {} }), false);
  assert.equal(isDashboardPm2Process({ pm2_env: { OPENWOLF_DASHBOARD_ENABLED: '0' } }), false);
  assert.equal(isDashboardPm2Process({ pm2_env: { OPENWOLF_DASHBOARD_ENABLED: '1' } }), true);
});

test('dashboard readiness rejects a healthy background-only daemon', () => {
  const projectRoot = path.resolve('/projects/example');
  assert.equal(isExpectedDashboardHealth(200, JSON.stringify({
    status: 'healthy',
    project_root: projectRoot,
    dashboard_enabled: false,
    dashboard_available: false,
  }), projectRoot), false);
  assert.equal(isExpectedDashboardHealth(200, JSON.stringify({
    status: 'healthy',
    project_root: projectRoot,
    dashboard_enabled: true,
    dashboard_available: false,
  }), projectRoot), false);
  assert.equal(isExpectedDashboardHealth(200, JSON.stringify({
    status: 'healthy',
    project_root: projectRoot,
    dashboard_enabled: true,
    dashboard_available: true,
  }), projectRoot), true);
  assert.equal(isExpectedDashboardHealth(200, JSON.stringify({
    status: 'healthy',
    project_root: path.resolve('/projects/other'),
    dashboard_enabled: true,
  }), projectRoot), false);
});

test('PM2 ownership requires an exact recorded project root', () => {
  const processes = [
    {
      name: 'openwolf-same-aaaaaaaa',
      pid: 101,
      pm2_env: {
        status: 'online',
        pm_id: 1,
        pm_cwd: '/projects/one/same',
        pm_exec_path: '/opt/wolf-daemon.js',
        OPENWOLF_PROJECT_ROOT: '/projects/one/same',
      },
    },
    {
      name: 'openwolf-same-bbbbbbbb',
      pid: 202,
      pm2_env: {
        status: 'online',
        pm_id: 2,
        pm_cwd: '/projects/two/same',
        pm_exec_path: '/opt/wolf-daemon.js',
        OPENWOLF_PROJECT_ROOT: '/projects/two/same',
      },
    },
  ];
  assert.equal(ownedPm2ProcessForRoot(processes, '/projects/one/same')?.pid, 101);
  assert.equal(ownedPm2ProcessForRoot(processes, '/projects/two/same')?.pid, 202);
  assert.equal(ownedPm2ProcessForRoot(processes, '/projects/three/same'), null);
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
