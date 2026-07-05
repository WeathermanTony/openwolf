---
target: src/daemon/wolf-daemon.ts
target-hash: aa34978d6419bcd71fc33ffe0dce3adb1f079c2ca9936469c7bf2e2e520c4f0f
created: 2026-07-04
---

# Deleted project daemon guard

## What the code claims to do

A running PM2-managed Wolfpack/OpenWolf daemon should not recreate a deleted project directory with only `.wolf` runtime files after the user manually deletes the project.

## Assumptions (≥3)

1. **Startup requires an existing project runtime** — daemon startup refuses to proceed unless both the project root and `.wolf/` directory already exist and are directories.
2. **Runtime disappearance does not rewrite state** — heartbeat detects a missing project/runtime and shuts down with `skipStateWrite`, avoiding `cron-state.json` writes that would recreate `.wolf`.
3. **Normal shutdown still records stopped state** — signal-driven shutdown without `skipStateWrite` keeps the prior behavior of setting `cron-state.json` `engine_status` to `stopped`.
4. **The pure guard is independently testable** — `shouldStartDaemonForProject()` lives in `startup-guard.ts`, so tests can import it without starting the Express daemon as a module side effect.
5. **PM2 stale entries were cleaned for reported deleted projects** — PM2 ids 86 and 87 and matching registry entries for `/mnt/j/projecthomepaul/test` and `/mnt/j/projecthomepaul/paultest-7-3-2026` were removed after diagnosis.

## Riskiest assumption

The riskiest assumption is **Runtime disappearance does not rewrite state**. The observed recreated directories contained only `.wolf/cron-state.json` and `.wolf/daemon.log`, which points to the daemon/logger/state-write path recreating the runtime after deletion.

## Falsification test

Build the project, run the guard regression test, run the full test suite and install verifier, and verify the reported stale PM2 entries were removed.

```bash
npm run build
npm test
npm run verify
sha256sum src/daemon/wolf-daemon.ts src/daemon/startup-guard.ts tests/daemon-cmd.test.js
pm2 jlist | node -e '...filter projecthomepaul...'
```

## Run output

```text
> customopenwolf@1.2.0-custom.1 build
> tsc && npm run build:dashboard && npm run postbuild:chmod
...
✓ built in 12.70s

> customopenwolf@1.2.0-custom.1 test
> node --test "tests/**/*.test.js"

# Subtest: PM2 daemon activity requires online status and a live pid
ok 1 - PM2 daemon activity requires online status and a live pid
# Subtest: daemon refuses to start when project runtime directory was deleted
ok 2 - daemon refuses to start when project runtime directory was deleted
...
1..15
# tests 15
# suites 0
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2495.902745

> customopenwolf@1.2.0-custom.1 verify
> node scripts/verify-install.js

OpenWolf install verification passed.

aa34978d6419bcd71fc33ffe0dce3adb1f079c2ca9936469c7bf2e2e520c4f0f  src/daemon/wolf-daemon.ts
fcbd72dcd9c8e2be96613fc87893d22f3dd3cf0f7c5175a06b33df9849494eae  src/daemon/startup-guard.ts
e56d07fec5ecde3d7b74e84cece607ccf279058def3dcb8dc40c1afbdc7ffc0b  tests/daemon-cmd.test.js

PM2 cleanup removed ids 86 and 87 for:
- /mnt/j/projecthomepaul/test
- /mnt/j/projecthomepaul/paultest-7-3-2026
Remaining projecthomepaul PM2 entry after cleanup:
- openwolf-newpaultest-7-3-2026-2d43da2d online pid=216119
```

## Verdict

- [x] Survived. The new startup guard test proves missing `.wolf/` is rejected before daemon startup; build/test/verify pass; the reported stale PM2/registry entries were removed.
- [ ] Falsified — link the fix.
