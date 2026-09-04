---
target: tests/lib/fixture-cleanup.js
target-hash: 69ebee30e312670b144e3e87c515166547a8a0d3d769e3893abc392c3f4705ca
created: 2026-09-04
reproduction_command: node --test tests/fixture-cleanup.test.js tests/ledger-integrity.test.js
evidence_source: executed now
---

# Test fixture lifecycle cleanup

## What the code claims to do

Test roots created through the helper are removed synchronously on ordinary process exit, SIGINT, and SIGTERM, while import-time cleanup removes only exact allowlisted stale directories older than 24 hours from their designated parent.

## Assumptions (≥3)

1. **Lifecycle registration is load-bearing** — every helper-created root is added to the process-global tracked set before control returns to the caller.
2. **Signal semantics survive cleanup** — the helper removes its own listener and re-sends SIGINT/SIGTERM so the child still terminates from the original signal.
3. **Stale sweeping is bounded** — only direct, non-symlink directories with a location-specific allowlisted prefix and `mtimeMs` older than 24 hours are removed.
4. **Live ownership defeats age** — an allowlisted root older than 24 hours is retained when its owner marker names a process that passes signal-zero liveness probing.
5. **Repeated cleanup is safe** — explicit cleanup followed by exit cleanup does not throw or recreate a path.

## Pick the riskiest assumption

Lifecycle registration is riskiest because all exit and signal handlers can execute successfully while leaking every fixture if creation fails to add the generated root to the tracked set.

## Falsification test

Run the child-process lifecycle suite, then disconnect `state().paths.add(fixture)` in a temporary helper copy and observe whether the same normal-exit scenario leaves its generated directory behind.

```bash
node --test tests/fixture-cleanup.test.js tests/ledger-integrity.test.js
```

## Evidence source

**executed now** — the positive suite and registration-disconnected control were both run in this session.

## Expected / Actual

- **Expected:** The fixed helper removes roots on exit and signals, preserves signal identity, rejects unknown prefixes, and leaves no allowlisted roots; disconnecting registration leaves a root behind.
- **Actual:** All 16 focused fixture/ledger tests passed, including retention of a backdated root whose marker names the live sweeping child. With registration disconnected, the child exited successfully but its generated root remained (`leaked=true`). A post-run scan found no allowlisted roots under the real home or temp directory after cleanup.

## Run output

```
1..16
# tests 16
# suites 0
# pass 16
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 918.32658

negative-control registration disconnected: child_status=0 leaked=true

/home/tony <none>
/tmp <none>
```

## Verdict

- [x] Assumption survived the test. The passing signal/exit suite becomes meaningfully red as a leak when registration is disconnected.
- [ ] Assumption falsified.

## Review challenge ledger

- **CONFIRMED — live fixture older than 24 hours:** Two fresh challenge rounds agreed that nested writes do not refresh the root mtime, so another importer could delete a long-running worker's active fixture. Fixed by writing a PID owner marker and skipping roots whose owner passes signal-zero probing; the focused suite backdates a live-owned root and proves it survives.
- **REJECTED — real-home import sweep is inherently a defect:** The approved requirement explicitly calls for import-time sweeping of exact reserved home prefixes older than 24 hours. The concern is a requirement-level tradeoff, not an implementation mismatch; non-allowlisted paths and symlinks remain protected.
- **REJECTED for current scope — three PM2 findings:** Dashboard-mode normalization, injected-snapshot cleanup TOCTOU, and legacy-name reporting were independently confirmed as pre-existing paths, but two challenge rounds agreed none is introduced by or blocks the read-only `listPm2Processes()` guard. They were recorded separately rather than driving unrelated edits.

## Follow-ups

The process-level fallback and bounded-sweep rules are recorded in `.wolf/cerebrum.md`; individual tests should retain their fast-path cleanup where practical.
