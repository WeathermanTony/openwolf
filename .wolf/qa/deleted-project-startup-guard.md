---
target: src/daemon/startup-guard.ts
target-hash: fcbd72dcd9c8e2be96613fc87893d22f3dd3cf0f7c5175a06b33df9849494eae
created: 2026-07-04
---

# Deleted project startup guard

## What the code claims to do

`shouldStartDaemonForProject()` should return true only when both the configured project root and its `.wolf` runtime directory already exist as directories.

## Assumptions (≥3)

1. **Missing project root is unsafe** — if the project root has been deleted, the daemon must not start because later writes could recreate the deleted tree.
2. **Missing `.wolf` is unsafe** — if `.wolf/` is gone, the daemon must not start because runtime writes would recreate only OpenWolf/Wolfpack state files.
3. **Both paths must be directories** — a file at either path must not count as a valid project/runtime directory.
4. **The guard stays side-effect free** — checking liveness must not create the project root, `.wolf/`, logs, or state files.
5. **The daemon imports the guard before any runtime writes** — `wolf-daemon.ts` calls the guard before loading config, constructing the logger, or ensuring auth tokens.

## Riskiest assumption

The riskiest assumption is **The guard stays side-effect free**. The reported failure was caused by write helpers creating parent directories, so the falsifier has to exercise a pure check rather than a write path.

## Falsification test

Build the project and run the test suite. The regression test creates a temp project root without `.wolf`, verifies false, creates `.wolf`, verifies true, deletes the root, and verifies false again.

```bash
npm run build
npm test
npm run verify
sha256sum src/daemon/startup-guard.ts tests/daemon-cmd.test.js
```

## Run output

```text
> customopenwolf@1.2.0-custom.1 build
> tsc && npm run build:dashboard && npm run postbuild:chmod
...
✓ built in 12.70s

> customopenwolf@1.2.0-custom.1 test
> node --test "tests/**/*.test.js"

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

fcbd72dcd9c8e2be96613fc87893d22f3dd3cf0f7c5175a06b33df9849494eae  src/daemon/startup-guard.ts
e56d07fec5ecde3d7b74e84cece607ccf279058def3dcb8dc40c1afbdc7ffc0b  tests/daemon-cmd.test.js
```

## Verdict

- [x] Survived. The startup guard is side-effect-free, rejects missing runtime directories, and the regression test/build/verifier passed.
- [ ] Falsified — link the fix.
