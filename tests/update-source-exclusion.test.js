import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSourceProject } from '../dist/src/cli/update.js';

test('source checkout exclusion uses normalized root identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-source-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'customopenwolf-project-'));
  assert.equal(isSourceProject({ name: 'customopenwolf', root }, root), true);
  assert.equal(isSourceProject({ name: 'renamed-source', root: path.join(root, '.') }, root), true);
  assert.equal(isSourceProject({ name: 'customopenwolf', root: other }, root), false);
  assert.equal(isSourceProject({ name: 'openwolf', root: other }, root), true);
});
