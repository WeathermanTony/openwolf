---
target: src/cli/daemon-cmd.ts
target-hash: 1f642fa2baf50e40a75ad7d91840d5aaaf7a8d4fce737f1a38fc85f53068b87a
created: 2026-07-01
---

# PM2 stale daemon prevention

## What the code claims to do

OpenWolf should not treat stale PM2 metadata as a live daemon, and `openwolf daemon stop` should remove the project daemon from PM2 instead of leaving stopped entries to accumulate.

## Assumptions (≥3)

1. **PM2 active status needs a real pid** — an OpenWolf PM2 entry is reusable only when PM2 reports `status: "online"` and a positive integer `pid`.
2. **Stopped/errored entries are stale for liveness** — `stopped` and `errored` entries should not suppress port migration or daemon restart logic.
3. **Pid-less online entries are stale for liveness** — entries with `status: "online"` but missing/zero/invalid `pid` should be restarted rather than counted as active.
4. **Manual stop should not create clutter** — `daemonStop()` should `pm2 delete` and `pm2 save` the project entry instead of `pm2 stop` leaving a stopped PM2 row.
5. **The test must exercise the exported predicate, not a duplicate regex** — the falsifier imports `isActivePm2Process` from the built module after `npm run build`.

## Riskiest assumption

The riskiest assumption is **Pid-less online entries are stale for liveness**. The observed PM2 state included OpenWolf entries with `online` status and no real PID; the old predicate would treat those as active and avoid repair paths.

## Falsification test

Run the build, import the compiled PM2 liveness predicate, feed it stopped/errored/pid-less/zero-pid/positive-pid fixtures, then run the full test suite and install verifier.

```bash
npm run build
sha256sum src/cli/daemon-cmd.ts tests/daemon-cmd.test.js
npm test
npm run verify
```

## Run output

```text
> customopenwolf@1.2.0-custom.1 build
> tsc && npm run build:dashboard && npm run postbuild:chmod
...
✓ built in 15.14s

1f642fa2baf50e40a75ad7d91840d5aaaf7a8d4fce737f1a38fc85f53068b87a  src/cli/daemon-cmd.ts
c913dec1eab01910658bf92902ad09d00a938ccb4aa5d4f0b4da88455b8d3c90  tests/daemon-cmd.test.js

> customopenwolf@1.2.0-custom.1 test
> node --test "tests/**/*.test.js"

# Subtest: PM2 daemon activity requires online status and a live pid
ok 1 - PM2 daemon activity requires online status and a live pid
...
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2768.06712

> customopenwolf@1.2.0-custom.1 verify
> node scripts/verify-install.js

OpenWolf install verification passed.
```

## Verdict

- [x] Survived. The liveness predicate now rejects pid-less PM2 metadata, stopped entries are not active, manual stop deletes the PM2 row, and the build/tests/verifier completed on the changed bytes.
- [ ] Falsified — link the fix.
