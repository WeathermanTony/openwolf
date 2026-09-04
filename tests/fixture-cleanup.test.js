import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cleanupFixture,
  createTmpFixture,
} from './lib/fixture-cleanup.js';

const helperUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'lib/fixture-cleanup.js')).href;

function runChild(source, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function runSignalCase(signal) {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { createTmpFixture } from ${JSON.stringify(helperUrl)};
    console.log(createTmpFixture('ow-nudge-'));
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const fixture = await new Promise((resolve, reject) => {
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('\n')) resolve(stdout.trim());
    });
    child.on('error', reject);
    child.on('close', (status, childSignal) => reject(new Error(`child exited before signal: status=${status} signal=${childSignal} stderr=${stderr}`)));
  });
  child.kill(signal);
  const result = await new Promise((resolve) => child.once('close', (status, childSignal) => resolve({ status, signal: childSignal })));
  assert.equal(result.signal, signal);
  assert.equal(fs.existsSync(fixture), false, `${signal} cleanup should remove ${fixture}`);
}

test('tracked fixtures are removed on normal process exit', async () => {
  const result = await runChild(`
    import { createTmpFixture } from ${JSON.stringify(helperUrl)};
    console.log(createTmpFixture('ow-nudge-'));
  `);
  assert.equal(result.status, 0, result.stderr);
  const fixture = result.stdout.trim();
  assert.ok(fixture);
  assert.equal(fs.existsSync(fixture), false);
});

test('tracked fixtures are removed before SIGTERM termination', async () => {
  await runSignalCase('SIGTERM');
});

test('tracked fixtures are removed before SIGINT termination', async () => {
  await runSignalCase('SIGINT');
});

test('explicit cleanup is idempotent', () => {
  const fixture = createTmpFixture('ow-nudge-');
  assert.equal(fs.existsSync(fixture), true);
  cleanupFixture(fixture);
  cleanupFixture(fixture);
  assert.equal(fs.existsSync(fixture), false);
});

test('stale sweep is exact, age-guarded, and location-specific', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-cleanup-proof-'));
  const home = path.join(sandbox, 'home');
  const tmp = path.join(sandbox, 'tmp');
  fs.mkdirSync(home);
  fs.mkdirSync(tmp);
  const old = new Date(Date.now() - (25 * 60 * 60 * 1000));
  const entries = {
    staleTmp: path.join(tmp, 'ow-nudge-stale'),
    activeTmp: path.join(tmp, 'ow-nudge-active'),
    freshTmp: path.join(tmp, 'ow-nudge-fresh'),
    unrelatedTmp: path.join(tmp, 'ow-unrelated-old'),
    homeOnlyInTmp: path.join(tmp, 'ow-review-scope-old'),
    staleHome: path.join(home, 'ow-review-scope-stale'),
    tmpOnlyInHome: path.join(home, 'ow-nudge-old'),
  };
  for (const entry of Object.values(entries)) fs.mkdirSync(entry);
  for (const entry of [entries.staleTmp, entries.activeTmp, entries.unrelatedTmp, entries.homeOnlyInTmp, entries.staleHome, entries.tmpOnlyInHome]) {
    fs.utimesSync(entry, old, old);
  }

  try {
    const result = await runChild(`
      const fs = await import('node:fs');
      const path = await import('node:path');
      fs.writeFileSync(path.join(${JSON.stringify(entries.activeTmp)}, '.openwolf-fixture-owner.json'), JSON.stringify({ pid: process.pid }));
      fs.utimesSync(${JSON.stringify(entries.activeTmp)}, new Date(${old.getTime()}), new Date(${old.getTime()}));
      await import(${JSON.stringify(`${helperUrl}?sweep=${Date.now()}`)});
    `, {
      HOME: home,
      TMPDIR: tmp,
      TMP: tmp,
      TEMP: tmp,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(entries.staleTmp), false, 'old allowlisted tmp fixture should be swept');
    assert.equal(fs.existsSync(entries.activeTmp), true, 'old fixture owned by a live process must be retained');
    assert.equal(fs.existsSync(entries.staleHome), false, 'old allowlisted home fixture should be swept');
    assert.equal(fs.existsSync(entries.freshTmp), true, 'fresh fixture must be retained');
    assert.equal(fs.existsSync(entries.unrelatedTmp), true, 'non-allowlisted fixture must be retained');
    assert.equal(fs.existsSync(entries.homeOnlyInTmp), true, 'home-only prefix must not be swept from tmp');
    assert.equal(fs.existsSync(entries.tmpOnlyInHome), true, 'tmp-only prefix must not be swept from home');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('unknown fixture prefixes are rejected before creation', () => {
  assert.throws(() => createTmpFixture('ow-arbitrary-'), /Unsupported test fixture prefix/);
});
