import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const OWNER_FILE = '.openwolf-fixture-owner.json';
const HOME_PREFIXES = new Set([
  'ow-review-scope-',
  'ow-simplicity-lens-',
  'ow-review-baseline-',
  'ow-registry-test-',
  'ow-measure-',
]);
const TMP_PREFIXES = new Set([
  'ow-ledger-home-',
  'ow-ledger-test-',
  'ow-dedup-',
  'ow-nudge-',
]);
const STATE_KEY = Symbol.for('openwolf.test-fixture-cleanup');

function state() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { paths: new Set(), installed: false };
  }
  return globalThis[STATE_KEY];
}

function matchingPrefix(name, prefixes) {
  return [...prefixes].some((prefix) => name.startsWith(prefix));
}

function hasLiveOwner(target) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(target, OWNER_FILE), 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  } catch {
    return false;
  }
}

function sweepStaleFixtures(parent, prefixes) {
  const cutoff = Date.now() - STALE_AFTER_MS;
  let names;
  try {
    names = fs.readdirSync(parent);
  } catch {
    return;
  }

  for (const name of names) {
    if (!matchingPrefix(name, prefixes)) continue;
    const target = path.join(parent, name);
    try {
      const metadata = fs.lstatSync(target);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.mtimeMs >= cutoff || hasLiveOwner(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // A stale fixture may disappear concurrently or be owned by another user.
    }
  }
}

function createFixture(parent, prefix, prefixes) {
  if (!prefixes.has(prefix)) {
    throw new Error(`Unsupported test fixture prefix: ${prefix}`);
  }
  const fixture = fs.mkdtempSync(path.join(parent, prefix));
  fs.writeFileSync(path.join(fixture, OWNER_FILE), JSON.stringify({ pid: process.pid }));
  state().paths.add(fixture);
  return fixture;
}

export function createHomeFixture(prefix) {
  return createFixture(os.homedir(), prefix, HOME_PREFIXES);
}

export function createTmpFixture(prefix) {
  return createFixture(os.tmpdir(), prefix, TMP_PREFIXES);
}

export function cleanupFixture(fixture) {
  const tracked = state().paths;
  if (!tracked.delete(fixture)) return;
  try {
    fs.rmSync(fixture, { recursive: true, force: true });
  } catch {
    // Cleanup must not mask the test failure that led here.
  }
}

export function cleanupAllFixtures() {
  for (const fixture of [...state().paths]) cleanupFixture(fixture);
}

function installLifecycleCleanup() {
  const lifecycle = state();
  if (lifecycle.installed) return;
  lifecycle.installed = true;
  process.once('exit', cleanupAllFixtures);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      cleanupAllFixtures();
      process.removeListener(signal, handler);
      process.kill(process.pid, signal);
    };
    process.once(signal, handler);
  }
}

sweepStaleFixtures(os.homedir(), HOME_PREFIXES);
sweepStaleFixtures(os.tmpdir(), TMP_PREFIXES);
installLifecycleCleanup();
