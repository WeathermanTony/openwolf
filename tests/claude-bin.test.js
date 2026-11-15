import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveClaudeBin, quietFailureLine } from '../dist/src/cli/claude-bin.js';

function exe(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, 0o755);
  return file;
}

test('resolveClaudeBin: explicit env wins', () => {
  assert.equal(resolveClaudeBin({ OPENWOLF_CLAUDE_BIN: '/opt/c/claude', PATH: '' }, '/nonexistent'), '/opt/c/claude');
});

test('resolveClaudeBin: skips the wmux shim, non-executables and relative PATH entries', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'claude-bin-'));
  try {
    const shim = exe(path.join(base, '.local', 'share', 'wmux-shim', 'bin', 'claude'));
    const plain = path.join(base, 'plain', 'claude');
    mkdirSync(path.dirname(plain), { recursive: true });
    writeFileSync(plain, 'not executable');
    const real = exe(path.join(base, 'real', 'claude'));
    const PATH = ['relative/bin', path.dirname(shim), path.dirname(plain), path.dirname(real)].join(path.delimiter);
    assert.equal(resolveClaudeBin({ PATH }, path.join(base, 'home')), real);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('resolveClaudeBin: falls back to ~/.local/bin/claude under cron PATH, then the bare name', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'claude-home-'));
  try {
    assert.equal(resolveClaudeBin({ PATH: '/usr/bin:/bin' }, home), 'claude');
    const fallback = exe(path.join(home, '.local', 'bin', 'claude'));
    assert.equal(resolveClaudeBin({ PATH: '/usr/bin:/bin' }, home), fallback);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('quietFailureLine is one timestamped line', () => {
  const line = quietFailureLine('SkillsBench', new Error('spawnSync claude ENOENT\n  at x'));
  assert.match(line, /^\d{4}-\d\d-\d\dT\S+ SkillsBench update failed: spawnSync claude ENOENT at x$/);
});
