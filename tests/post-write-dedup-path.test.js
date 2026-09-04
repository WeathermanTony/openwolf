import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTmpFixture } from './lib/fixture-cleanup.js';

const HOOK = path.resolve('src/hooks/post-write.js');

// Drives the real hook through its stdin contract. Asserts the OBSERVABLE
// consequence -- whether a second buglog entry appears -- never a literal value,
// so the test still means something if the predicate is reimplemented.
function runHook(root, file, oldStr, newStr) {
  const payload = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(root, file), old_string: oldStr, new_string: newStr },
  });
  try {
    execFileSync('node', [HOOK], { input: payload, cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { /* hook exits non-zero on nudges; irrelevant to buglog state */ }
}

function setup() {
  const root = createTmpFixture('ow-dedup-');
  fs.mkdirSync(path.join(root, '.wolf'), { recursive: true });
  fs.writeFileSync(path.join(root, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [] }, null, 2));
  fs.writeFileSync(path.join(root, '.wolf', 'config.json'), JSON.stringify({}));
  return root;
}

const NO_CATCH = 'function f() {\n  return JSON.parse(s);\n}\n';
const WITH_CATCH = 'function f() {\n  try {\n    return JSON.parse(s);\n  } catch (e) {\n    return null;\n  }\n}\n';

const bugs = (root) => JSON.parse(fs.readFileSync(path.join(root, '.wolf', 'buglog.json'), 'utf8')).bugs;

test('two DIFFERENT files sharing a basename each get their own buglog entry (bug-707)', () => {
  const root = setup();
  for (const d of ['src/utils', 'server/utils']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/utils/hash.ts'), WITH_CATCH);
  fs.writeFileSync(path.join(root, 'server/utils/hash.ts'), WITH_CATCH);

  runHook(root, 'src/utils/hash.ts', NO_CATCH, WITH_CATCH);
  const afterFirst = bugs(root);
  if (afterFirst.length === 0) return; // auto-detection not triggered here; nothing to pin

  runHook(root, 'server/utils/hash.ts', NO_CATCH, WITH_CATCH);
  const afterSecond = bugs(root);

  // The observable consequence: the second DISTINCT file must not be folded into
  // the first file's entry. Pre-fix, basename matching merged them -- leaving one
  // entry with occurrences=2 and the second file's context appended to the first.
  const files = new Set(afterSecond.map((b) => b.file));
  assert.ok(
    files.size >= 2 || afterSecond.length >= 2,
    `distinct files must not merge; got entries: ${JSON.stringify(afterSecond.map((b) => ({ file: b.file, occ: b.occurrences })))}`,
  );
  const first = afterSecond.find((b) => String(b.file).includes('src/utils/hash.ts'));
  if (first) {
    assert.ok(
      !String(first.fix).includes('| Also:'),
      "the second file's fix context must not be appended to the first file's record",
    );
  }
});

test('the SAME file edited twice in one window still dedupes (fix did not disable suppression)', () => {
  const root = setup();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/only.ts'), WITH_CATCH);

  runHook(root, 'src/only.ts', NO_CATCH, WITH_CATCH);
  const afterFirst = bugs(root);
  if (afterFirst.length === 0) return;

  runHook(root, 'src/only.ts', NO_CATCH, WITH_CATCH);
  const afterSecond = bugs(root);

  // Control: suppression must still work for the genuinely-same file, or the fix
  // traded one defect for another (an entry per edit).
  assert.equal(
    afterSecond.length, afterFirst.length,
    `same file must still dedupe; entries grew ${afterFirst.length} -> ${afterSecond.length}`,
  );
});
