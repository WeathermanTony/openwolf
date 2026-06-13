---
target: src/hooks/stop.js
target-hash: 16f8cfad8dc452c7c58eb6c15c7b1641a98f28f62e837473e4d77d376bee1077
created: 2026-06-13
---

# Review nudge + buglog false-positive suppression

## Assumptions

1. Adding ChatGPT/generic installed-plugin guidance to the review nudge is advisory text only; it must not change reviewlog coalescing, content hashing, or completion semantics.
2. `complete-review.js` remains extensible: `--reviewer <external label>` must be accepted and stored without a hardcoded provider enum.
3. A buglog false-positive acknowledgement must suppress only the same multi-edit state: same normalized multi-edit file set, same edit counts, and same latest relevant edit timestamps.
4. A later edit to a previously acknowledged multi-edit file must change the signature and allow the buglog nudge to fire again.
5. The source, runtime, and template `stop.js` copies must carry the same generic reviewer guidance and acknowledgement logic.
6. Stop-hook nudges must flush stderr before exit 2 so Claude receives the actionable nudge text rather than only a failing hook status.
7. False-positive acknowledgements must only be honored after at least one prior buglog warning has fired in the session, so a model cannot preemptively bypass the first buglog obligation.

## Falsification test

Riskiest assumption: acknowledgement suppression might silence future real buglog nudges too broadly. The runnable test creates a temporary OpenWolf fixture, triggers the buglog nudge, writes an explicit false-positive acknowledgement to the transcript, verifies the same signature is suppressed, then adds another edit and verifies the nudge fires again.

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
# Subtest: stop hook suppresses repeated buglog nudges after explicit false-positive acknowledgement
ok 9 - stop hook suppresses repeated buglog nudges after explicit false-positive acknowledgement
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Additional syntax/sync checks run:

```bash
node --check src/hooks/stop.js && node --check .wolf/hooks/stop.js && node --check templates/wolf/hooks/stop.js
```

Actual output: command exited 0 with no stdout/stderr.
