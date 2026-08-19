import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Behavioural pin for UQ-1 (see .wolf/parked-questions.md).
 *
 * The placeholder is: a companion receipt digest is never accepted as reviewed-
 * hash provenance. These tests assert the OBSERVABLE CONSEQUENCE of that rule
 * flowing through a real call site (reviewShow's printed provenance), not the
 * literal value of any constant — a value assertion would stay green even if the
 * seam were disconnected from every consumer.
 */
function withReviewLog(entry, fn) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-uq1-'));
  const wolf = path.join(project, '.wolf');
  fs.mkdirSync(wolf, { recursive: true });
  fs.writeFileSync(path.join(wolf, 'config.json'), JSON.stringify({ openwolf: {} }));
  fs.writeFileSync(path.join(wolf, 'reviewlog.json'), JSON.stringify({ version: 1, reviews: [entry] }));
  const cwd = process.cwd();
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    process.chdir(project);
    fn();
  } finally {
    console.log = log;
    process.chdir(cwd);
  }
  return lines.join('\n');
}

test('UQ-1 seam: a reviewed-byte receipt hash surfaces as provenance', async () => {
  const { reviewShow } = await import(path.join(root, 'dist/src/cli/review-cmd.js'));
  const out = withReviewLog(
    {
      id: 'review-0001',
      status: 'completed',
      files: [],
      receipt: { kind: 'reviewed-byte', reviewed_hash: 'a'.repeat(64) },
    },
    () => reviewShow('review-0001'),
  );
  // Observable consequence: the reviewed-byte receipt IS honoured.
  assert.match(out, /Reviewed hash: a{64}/, `expected provenance line, got:\n${out}`);
});

test('UQ-1 seam: a non-reviewed-byte receipt hash is NOT accepted as provenance', async () => {
  const { reviewShow } = await import(path.join(root, 'dist/src/cli/review-cmd.js'));
  const out = withReviewLog(
    {
      id: 'review-0002',
      status: 'completed',
      files: [],
      // A companion-style receipt carrying its own digest under a different kind.
      receipt: { kind: 'companion-receipt', reviewed_hash: 'b'.repeat(64) },
    },
    () => reviewShow('review-0002'),
  );
  // This is the placeholder's load-bearing behavior: the digest must NOT be
  // promoted to reviewed-hash provenance just because the field name matches.
  assert.doesNotMatch(out, /Reviewed hash: b{64}/, `companion digest must not be accepted as provenance:\n${out}`);
  assert.match(out, /Current manifest hash: /, 'the current-byte manifest is still reported');
});

test('UQ-1 ledger entry and code marker agree', () => {
  const ledger = fs.readFileSync(path.join(root, '.wolf/parked-questions.md'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src/cli/review-cmd.ts'), 'utf8');
  assert.match(ledger, /^## UQ-1\b/m, 'UQ-1 must exist in the ledger');
  assert.match(ledger, /^STATUS: (OPEN|RESOLVED .+|ABANDONED .+)$/m, 'exactly one STATUS line form');
  assert.match(source, /TODO\(UQ-1\): see \.wolf\/parked-questions\.md/, 'the seam must carry the bare marker');
});
