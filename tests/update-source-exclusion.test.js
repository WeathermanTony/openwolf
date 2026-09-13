import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSourceProject } from '../dist/src/cli/update.js';

function seedSourceCheckout(root, name = 'customopenwolf') {
  fs.mkdirSync(path.join(root, 'src', 'cli'), { recursive: true });
  fs.mkdirSync(path.join(root, 'templates', 'wolf'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name }));
  fs.writeFileSync(path.join(root, 'src', 'cli', 'update.ts'), '');
}

test('source checkout exclusion follows repository identity across worktrees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-source-'));
  const canonicalCheckout = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-canonical-source-'));
  const ordinaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'customopenwolf-project-'));
  const otherPackage = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-other-package-'));

  try {
    seedSourceCheckout(root);
    seedSourceCheckout(canonicalCheckout);
    fs.writeFileSync(path.join(ordinaryProject, 'package.json'), JSON.stringify({ name: 'customopenwolf' }));
    seedSourceCheckout(otherPackage, 'different-package');

    assert.equal(isSourceProject({ name: 'customopenwolf', root }, root), true);
    assert.equal(isSourceProject({ name: 'renamed-source', root: path.join(root, '.') }, root), true);
    assert.equal(isSourceProject({ name: 'renamed-canonical-source', root: canonicalCheckout }, root), true);
    assert.equal(isSourceProject({ name: 'customopenwolf', root: ordinaryProject }, root), false);
    assert.equal(isSourceProject({ name: 'customopenwolf', root: otherPackage }, root), false);
    assert.equal(isSourceProject({ name: 'openwolf', root: ordinaryProject }, root), true);
  } finally {
    for (const dir of [root, canonicalCheckout, ordinaryProject, otherPackage]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
