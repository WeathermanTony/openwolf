import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTmpFixture } from './lib/fixture-cleanup.js';
import { readState, writeStateOrThrow, setDisposition } from '../dist/src/hooks/nudges/state.js';
import { resolveNudgeFingerprint } from '../dist/src/cli/nudge-cmd.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fingerprint = 'c'.repeat(64);

function fixture() {
  const base = createTmpFixture('ow-nudge-');
  const wolf = path.join(base, '.wolf');
  fs.mkdirSync(wolf);
  fs.writeFileSync(path.join(wolf, 'config.json'), '{}');
  const file = path.join(wolf, 'nudge-state.json');
  const bytes = JSON.stringify({
    version: 4,
    dispositions: { OLD: { state: 'dismissed' } },
    emissions: { [fingerprint]: { rule_id: 'review.required', state: 'emitted' } },
    leases: {},
    lineages: {},
  });
  fs.writeFileSync(file, bytes);
  return { base, wolf, file, bytes };
}

for (const code of ['EACCES', 'EIO', 'EMFILE', 'EISDIR']) {
  test(`state read ${code} refuses persistence and preserves original bytes`, () => {
    const { wolf, file, bytes } = fixture();
    const original = fs.readFileSync;
    let injected = 0;
    fs.readFileSync = function (target, ...args) {
      if (target === file) {
        injected++;
        throw Object.assign(new Error(`injected ${code}`), { code });
      }
      return original.call(this, target, ...args);
    };
    syncBuiltinESMExports();
    try {
      const state = readState(wolf);
      assert.throws(() => writeStateOrThrow(wolf, state), /unreadable/i);
      const result = setDisposition(wolf, 'NEW', 'dismissed');
      assert.equal(result.ok, false);
      assert.equal(result.degraded, true);
      assert.ok(injected >= 2, 'both direct and mutator reads hit the fault');
    } finally {
      fs.readFileSync = original;
      syncBuiltinESMExports();
    }
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  });
}

test('absent state still permits first-run disposition writes', () => {
  const { wolf, file } = fixture();
  fs.unlinkSync(file);
  assert.equal(setDisposition(wolf, 'NEW', 'dismissed').ok, true);
  assert.equal(readState(wolf).dispositions.NEW.state, 'dismissed');
});

test('blank nudge IDs do not resolve, while valid short IDs still resolve', () => {
  const { wolf } = fixture();
  // Use a single fingerprint across all pools: ambiguity must not hide the bug.
  const state = readState(wolf);
  state.dispositions = {};
  writeStateOrThrow(wolf, state);
  for (const id of ['', ' ', '\t', undefined, null]) {
    assert.equal(resolveNudgeFingerprint(wolf, id), null);
  }
  assert.equal(resolveNudgeFingerprint(wolf, 'review-'), null);
  assert.equal(resolveNudgeFingerprint(wolf, 'review-cccccccc'), fingerprint);
  assert.equal(resolveNudgeFingerprint(wolf, fingerprint), fingerprint);
});

test('built CLI rejects empty dismiss ID without changing sole nudge', () => {
  const { base, wolf, file } = fixture();
  const state = readState(wolf);
  state.dispositions = {};
  writeStateOrThrow(wolf, state);
  const before = fs.readFileSync(file, 'utf8');
  const result = spawnSync(process.execPath, [path.join(root, 'dist/bin/openwolf.js'), 'nudge', 'dismiss', ''], {
    cwd: base, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /No nudge matching/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
