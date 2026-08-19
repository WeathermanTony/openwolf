import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildExperimentJournal } = await import(path.join(root, 'dist/src/cli/experiment-cmd.js'));

function fixture(records) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-journal-'));
  const dir = path.join(project, '.wolf', 'experiments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(project, '.wolf', 'config.json'), JSON.stringify({ openwolf: {} }));
  for (const [name, body] of Object.entries(records)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return project;
}

const record = (id, family, status, metric) => ({
  id,
  status,
  strategy_family: family,
  attempt: { number: 1, max: 3 },
  objective: `objective ${id}`,
  evidence: [{ command: 'x', exit_code: 0, output: '', ...(metric ? { metric } : {}) }],
  result: { links: {} },
});

test('falsified and inconclusive attempts are preserved, not filtered out', () => {
  // The journal's value is showing what was already ruled out. A log of winners
  // only cannot do that, and the source pattern this replaces discarded failures.
  const p = fixture({
    a: record('a', 'alpha', 'falsified'),
    b: record('b', 'alpha', 'inconclusive'),
    c: record('c', 'beta', 'survived'),
  });
  const { rows } = buildExperimentJournal(p);
  assert.equal(rows.length, 3);
  const statuses = rows.map((r) => r.status).sort();
  assert.deepEqual(statuses, ['falsified', 'inconclusive', 'survived']);
});

test('a malformed record still occupies a row so the attempt count stays honest', () => {
  const p = fixture({ good: record('good', 'alpha', 'survived'), broken: '{not json' });
  const { rows, malformed } = buildExperimentJournal(p);
  assert.equal(malformed, 1);
  assert.equal(rows.length, 2, 'dropping the unreadable record would understate attempts');
  assert.ok(rows.some((r) => r.status === 'MALFORMED'));
});

test('the metric on the last metric-bearing evidence entry is the reported reading', () => {
  const r = record('m', 'alpha', 'survived', { name: 'acc', value: 0.88 });
  r.evidence.push({ command: 'later', exit_code: 0, output: '' }); // no metric
  const { rows } = buildExperimentJournal(fixture({ m: r }));
  assert.equal(rows[0].metric, 'acc');
  assert.equal(rows[0].value, '0.88');
});

test('records without any metric report "-" rather than a fabricated zero', () => {
  const { rows } = buildExperimentJournal(fixture({ n: record('n', 'alpha', 'survived') }));
  assert.equal(rows[0].value, '-', 'a missing reading must not render as a real number');
});

test('an empty project yields no rows rather than throwing', () => {
  const { rows, malformed } = buildExperimentJournal(fixture({}));
  assert.deepEqual(rows, []);
  assert.equal(malformed, 0);
});
