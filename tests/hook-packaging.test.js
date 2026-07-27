/**
 * Hook packaging: every module a hook imports must actually ship.
 *
 * The defect this pins: hook scripts are copied into `.wolf/hooks/` by an
 * explicit FLAT allowlist ("stop.js", "shared.js", ...). `stop.js` imports
 * `./nudges/engine.js` and `./nudges/rules/*.js`, which no allowlist entry
 * covers and no recursion reached. Every freshly initialized or updated
 * project therefore got the importer without its imports, and the Stop hook
 * died with ERR_MODULE_NOT_FOUND.
 *
 * It failed SILENTLY: the project hook wrapper is
 *   node -e "import(...).catch(()=>{})"
 * so the nudge system, review gate, and quality gate were all simply absent
 * with no error surfaced anywhere.
 *
 * A test that only checked "the files exist" would not have caught the
 * original bug either, so the load assertion below is the load-bearing one:
 * it actually imports the hook and fails on an unresolvable specifier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(import.meta.dirname, '..');
const DIST_HOOKS = path.join(REPO, 'dist', 'src', 'hooks');

/** Collect relative-specifier imports from a compiled hook file. */
function localImports(file) {
  const src = fs.readFileSync(file, 'utf-8');
  const out = [];
  const re = /(?:^|\s)(?:import|export)\s[^'"]*?from\s*["'](\.[^"']+)["']/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

test('every relative import of a shipped hook resolves inside the shipped tree', () => {
  if (!fs.existsSync(DIST_HOOKS)) return; // not built; other suites cover build

  // Walk transitively from stop.js — the hook that grew a nested dependency.
  const entry = path.join(DIST_HOOKS, 'stop.js');
  assert.ok(fs.existsSync(entry), 'dist stop.js must exist');

  const seen = new Set();
  const missing = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of localImports(file)) {
      const resolved = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(resolved)) { missing.push(`${path.relative(REPO, file)} -> ${spec}`); continue; }
      if (resolved.startsWith(DIST_HOOKS)) queue.push(resolved);
    }
  }
  assert.deepEqual(missing, [], 'every relative hook import must resolve');
  // Negative-control guard: if the crawler found nothing it would pass vacuously.
  assert.ok(seen.size > 3, `crawler must actually traverse the tree (saw ${seen.size})`);
});

test('a project-shaped copy of the hooks tree loads stop.js without ERR_MODULE_NOT_FOUND', async () => {
  if (!fs.existsSync(DIST_HOOKS)) return;

  // Build a `.wolf/` the way init/update do: hooks/ plus its sibling utils/.
  // Never touch live .wolf data — this is a throwaway fixture.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-pkg-'));
  try {
    const wolf = path.join(base, '.wolf');
    const hooks = path.join(wolf, 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.cpSync(DIST_HOOKS, hooks, { recursive: true });
    const utilsSrc = path.join(REPO, 'dist', 'src', 'utils');
    if (fs.existsSync(utilsSrc)) fs.cpSync(utilsSrc, path.join(wolf, 'utils'), { recursive: true });
    fs.writeFileSync(path.join(base, 'package.json'), '{"type":"module"}');

    const nudges = path.join(hooks, 'nudges');
    assert.ok(fs.existsSync(nudges), 'the nudges tree must be part of the shipped hooks');
    assert.ok(
      fs.existsSync(path.join(nudges, 'rules', 'conclusion.js')),
      'nested rule modules must ship too, not just the top-level nudges dir',
    );

    await import(pathToFileURL(path.join(hooks, 'stop.js')).href);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
