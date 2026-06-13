---
target: src/hooks/shared.js
target-hash: 8f68b3f3f0ca74782b2c834878f5c484dc8ad5b2144c6065dada84cbc00f0b07
created: 2026-06-13
---

# Autonomy continuation shared config loader

## Assumptions

1. `getAutonomyContinuationConfig()` must return enabled, bounded defaults when `.wolf/config.json` omits `openwolf.autonomy_continuation`.
2. User config must be sanitized: non-numeric `min_text_chars` / `max_fires_per_session` fall back to safe defaults, and numeric values are clamped by `finiteNumber`.
3. User-supplied `patterns` must only replace defaults when it is an array; invalid regex strings must not crash the Stop hook because `maybeNudgeAutonomyContinuation()` catches per-pattern regex construction failures.
4. The new config getter must not alter existing review, quality, claim-calibration, or size-discipline config getters.
5. Runtime, source, and template `shared.js` copies must stay synchronized for this getter and defaults.

## Falsification test

Riskiest assumption: the shared config defaults and getter might make the Stop hook loop or ignore config bounds. The runnable test exercises the public behavior through `src/hooks/stop.js`: with autonomy continuation enabled and `max_fires_per_session: 1`, a transcript containing clear next-action language fires once, then the same session suppresses the second fire.

Command:

```bash
npm test
```

Actual output:

```text
> customopenwolf@0.1.0-custom.0 test
> node --test "tests/**/*.test.js"

TAP version 13
# Subtest: complete-review completes pending review when stored hashes match current bytes
ok 1 - complete-review completes pending review when stored hashes match current bytes
# Subtest: complete-review accepts arbitrary extensible reviewer labels
ok 2 - complete-review accepts arbitrary extensible reviewer labels
# Subtest: complete-review refuses pending review without stored content hashes
ok 3 - complete-review refuses pending review without stored content hashes
# Subtest: complete-review refuses stale pending hashes when file changed after nudge
ok 4 - complete-review refuses stale pending hashes when file changed after nudge
# Subtest: complete-review refuses to create missing review entries
ok 5 - complete-review refuses to create missing review entries
# Subtest: complete-review refuses already completed reviews by default
ok 6 - complete-review refuses already completed reviews by default
# Subtest: complete-review allows deleted files as stable tombstones
ok 7 - complete-review allows deleted files as stable tombstones
# Subtest: complete-review refuses unreadable non-regular files and leaves review pending
ok 8 - complete-review refuses unreadable non-regular files and leaves review pending
# Subtest: stop hook nudges autonomy continuation on obvious next-step language
ok 9 - stop hook nudges autonomy continuation on obvious next-step language
# Subtest: stop hook suppresses repeated buglog nudges after explicit false-positive acknowledgement
ok 10 - stop hook suppresses repeated buglog nudges after explicit false-positive acknowledgement
1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Additional command:

```bash
npm run verify
```

Actual output:

```text
> customopenwolf@0.1.0-custom.0 verify
> node scripts/verify-install.js

OpenWolf install verification passed.
```
