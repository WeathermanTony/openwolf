import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { traceCommand } from '../dist/src/cli/trace-cmd.js';
import { lintCerebrum } from '../dist/src/cli/cerebrum-cmd.js';

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-trace-cerebrum-'));
  await mkdir(path.join(dir, '.wolf', 'qa'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), '{}\n');
  return dir;
}

test('cerebrum lint reports required heading errors and accepts valid structure', async () => {
  const dir = await fixture();
  try {
    await writeFile(path.join(dir, '.wolf', 'cerebrum.md'), '# Cerebrum\n\n## User Preferences\n\n## Key Learnings\n\n## Do-Not-Repeat\n- [2026-07-06] Do not forget dates.\n\n## Decision Log\n');
    assert.deepEqual(lintCerebrum(dir).filter((i) => i.level === 'error'), []);
    await writeFile(path.join(dir, '.wolf', 'cerebrum.md'), '# Cerebrum\n\n## Do-Not-Repeat\n- missing date\n');
    const issues = lintCerebrum(dir);
    assert.ok(issues.some((i) => i.level === 'error' && i.message.includes('User Preferences')));
    assert.ok(issues.some((i) => i.level === 'warning' && i.message.includes('missing date')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trace command emits linked bug review qa and cerebrum data as JSON', async () => {
  const dir = await fixture();
  const oldCwd = process.cwd();
  try {
    const file = path.join(dir, 'src', 'target.js');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'export const target = true;\n');
    await writeFile(path.join(dir, '.wolf', 'buglog.json'), JSON.stringify({ version: 1, bugs: [{ id: 'bug-001', error_message: 'target failed', file }] }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'reviewlog.json'), JSON.stringify({ version: 1, reviews: [{ id: 'review-0001', status: 'completed', files: [file] }] }, null, 2));
    await writeFile(path.join(dir, '.wolf', 'qa', 'target.md'), '---\ntarget: src/target.js\ntarget-hash: abc\n---\n\n# target bug-001 review-0001\n');
    await writeFile(path.join(dir, '.wolf', 'cerebrum.md'), '# Cerebrum\n\n## User Preferences\n\n## Key Learnings\n- target lesson bug-001\n\n## Do-Not-Repeat\n\n## Decision Log\n');
    process.chdir(dir);
    let out = '';
    const original = console.log;
    console.log = (msg = '') => { out += String(msg) + '\n'; };
    try {
      traceCommand('bug-001', { json: true });
    } finally {
      console.log = original;
    }
    const parsed = JSON.parse(out);
    assert.equal(parsed.bugs.length, 1);
    assert.ok(parsed.qa.some((q) => q.path.endsWith('target.md')));
    assert.ok(parsed.cerebrum.some((line) => line.includes('bug-001')));
  } finally {
    process.chdir(oldCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
