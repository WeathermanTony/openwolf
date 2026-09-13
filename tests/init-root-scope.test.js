import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(repoRoot, 'dist', 'bin', 'openwolf.js');

test('init --root scopes a markerless nested project exactly', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-init-root-'));
  const parent = path.join(fixture, 'parent');
  const child = path.join(parent, 'nested-project');
  const home = path.join(fixture, 'home');
  const parentWolf = path.join(parent, '.wolf');

  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(parentWolf, { recursive: true });
  fs.writeFileSync(path.join(parentWolf, 'sentinel.txt'), 'parent must remain untouched\n');

  try {
    const result = spawnSync(process.execPath, [cli, 'init', '--root', child, '--profile', 'open'], {
      cwd: child,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 120000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`Project root: ${child.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(fs.existsSync(path.join(child, '.wolf', 'config.json')));
    assert.deepEqual(fs.readdirSync(parentWolf), ['sentinel.txt']);

    const registry = JSON.parse(fs.readFileSync(path.join(home, '.openwolf', 'registry.json'), 'utf8'));
    const projects = Array.isArray(registry) ? registry : registry.projects;
    assert.equal(projects.length, 1);
    assert.equal(projects[0].root, child);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('init --root rejects a nonexistent directory before writing', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-init-root-missing-'));
  const missing = path.join(fixture, 'missing');

  try {
    const result = spawnSync(process.execPath, [cli, 'init', '--root', missing], {
      cwd: fixture,
      env: { ...process.env, HOME: path.join(fixture, 'home') },
      encoding: 'utf8',
      timeout: 120000,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /Project root must be an existing directory/);
    assert.equal(fs.existsSync(missing), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
