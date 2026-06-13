---
target: src/hooks/stop.js
target-hash: 8db75c4cfd838dd7f03cb03c766bc6f03698d3b9c65b63e87ff54f7cfc63c756
related-target: src/hooks/shared.js
related-target-hash: 8f68b3f3f0ca74782b2c834878f5c484dc8ad5b2144c6065dada84cbc00f0b07
created: 2026-06-13
---

# Autonomy continuation Stop-hook reminder

## Assumptions

1. The autonomy reminder should only fire when the last assistant text contains configured next-step / permission-seeking language and meets `min_text_chars`.
2. The reminder must be capped per session using `_session.json`, so repeated Stops on the same transcript do not loop indefinitely.
3. Disabling `openwolf.autonomy_continuation.enabled` must fully suppress the reminder.
4. The reminder must not replace review, quality, buglog, claim-calibration, or conclusion gates; it only adds another advisory exit-2 nudge.
5. Runtime, source, and template hook/config copies must stay synchronized.

## Falsification test

Riskiest assumption: the reminder might loop indefinitely after a single assistant message with "next action" wording. The runnable test creates a temporary OpenWolf fixture with only autonomy continuation enabled, runs the Stop hook twice against the same transcript, and asserts the first run emits the autonomy reminder with exit 2 while the second run is suppressed by the session cap.

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

Additional checks:

```bash
node --check src/hooks/stop.js && node --check .wolf/hooks/stop.js && node --check templates/wolf/hooks/stop.js && node --check src/hooks/shared.js && node --check .wolf/hooks/shared.js && node --check templates/wolf/hooks/shared.js
npm run verify
```

Actual output: syntax checks exited 0 with no output; `npm run verify` printed `OpenWolf install verification passed.`
