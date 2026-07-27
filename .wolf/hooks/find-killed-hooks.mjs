#!/usr/bin/env node
/**
 * Report Stop-hook runs that started and never finished.
 *
 * Usage: node .wolf/hooks/find-killed-hooks.mjs [path/to/hook-lifecycle.jsonl]
 *
 * Background: four `could not lock .wolf/reviewlog.json` failures were seen,
 * each with a dead owner pid in the lock file. Ordinary exceptions cannot
 * cause that (both lock sites release in `finally`), process.exit() inside a
 * lock is unreachable, and OOM was ruled out — leaving an external signal as
 * the only remaining branch. That was elimination, not observation. The
 * lifecycle log converts it to observation.
 *
 * Reading the output:
 *   start + exit             -> healthy
 *   start + signal=<NAME>    -> killed by a CATCHABLE signal; <NAME> is the killer
 *   start, nothing after     -> SIGKILL or abrupt teardown (uncatchable, so the
 *                               process could not record its own death)
 *
 * An unclosed run is the artifact that orphans a lock. Correlate its `pid`
 * with the pid recorded inside a stale `*.lock` file to tie the two together.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2]
  || path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.wolf', 'logs', 'hook-lifecycle.jsonl');

if (!fs.existsSync(file)) {
  console.log(`No lifecycle log at ${file}`);
  console.log('The instrumented Stop hook writes one on its next run.');
  process.exit(0);
}

const runs = new Map();
for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (!e.run) continue;
  if (!runs.has(e.run)) runs.set(e.run, []);
  runs.get(e.run).push(e);
}

const unclosed = [];
let healthy = 0;
for (const [run, events] of runs) {
  if (events.some((e) => e.event === 'exit' && e.ok)) { healthy++; continue; }
  const sig = events.find((e) => e.event === 'signal');
  const err = events.find((e) => e.event === 'uncaught' || e.event === 'unhandled_rejection');
  unclosed.push({
    run,
    pid: events[0]?.pid,
    ppid: events[0]?.ppid,
    started: events[0]?.ts,
    cause: sig ? `signal ${sig.signal}`
      : err ? `${err.event}: ${err.error}`
      : 'SIGKILL or abrupt teardown (uncatchable — no self-record possible)',
  });
}

console.log(`runs: ${runs.size}  healthy: ${healthy}  unclosed: ${unclosed.length}`);
if (!unclosed.length) {
  console.log('\nNo killed hooks recorded yet. If a stale lock appears without an');
  console.log('unclosed run here, the holder was NOT a Stop hook — look elsewhere.');
  process.exit(0);
}
console.log('\nUnclosed runs (each could orphan a lock):');
for (const u of unclosed) {
  console.log(`  run=${u.run} pid=${u.pid} ppid=${u.ppid}`);
  console.log(`    started: ${u.started}`);
  console.log(`    cause:   ${u.cause}`);
}
console.log('\nCorrelate a pid above with the pid inside any stale *.lock file.');
