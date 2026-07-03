---
target: src/dashboard/app/components/layout/Sidebar.tsx
target-hash: 9c748cd8b4919199caafbcb82ba0da27d8d5b3a524dd6dcdb7619803783a711c
created: 2026-07-03
---

# Wolfpack brand alias — Sidebar.tsx

## What the code claims to do

This file participates in the Wolfpack user-facing brand layer while preserving OpenWolf compatibility internals.

## Assumptions (≥3)

1. **Compatibility remains intact** — existing `openwolf`, `.wolf/`, and `openwolf.*` runtime surfaces still work where this file touches them.
2. **User-facing copy is clear** — humans see Wolfpack for the customized workflow rather than assuming vanilla OpenWolf delivers the same behavior.
3. **Build integration remains valid** — this file still compiles/bundles after the brand wording change.
4. **Verification sees current bytes** — the target hash in this reduction matches the file after the brand-layer edits.

## Riskiest assumption

The riskiest assumption is **Compatibility remains intact** because the rename must not break current OpenWolf-managed projects while introducing the Wolfpack alias/wording.

## Falsification test

Build the package, hash all edited code files, run the full test suite, and run the install verifier.

```bash
npm run build
sha256sum bin/openwolf.ts src/cli/init.ts src/dashboard/app/App.tsx src/dashboard/app/components/layout/Sidebar.tsx src/dashboard/app/components/panels/DesignQC.tsx src/dashboard/app/components/panels/TokenUsage.tsx
npm test
npm run verify
```

## Run output

```text
> customopenwolf@1.2.0-custom.1 build
> tsc && npm run build:dashboard && npm run postbuild:chmod
...
✓ built in 12.76s

62fc150e2a15734695b943231564bb216ccafd01e6f7ea572ba7560f2805e7eb  bin/openwolf.ts
f26be922f61cff1d7c4c7420f7e97cd4928496842b6bd2afe22da77e5729faff  src/cli/init.ts
30ab90cae551e9c2a12cb187d0fafca02a8739780823b4150381060e815df523  src/dashboard/app/App.tsx
9c748cd8b4919199caafbcb82ba0da27d8d5b3a524dd6dcdb7619803783a711c  src/dashboard/app/components/layout/Sidebar.tsx
49c6b514a0bcfa3383e8c24d294e580c8a1bc7f468f5c5276bab50001062246c  src/dashboard/app/components/panels/DesignQC.tsx
6e695a8052ab80ca534e1f2cc8809403b655ba280d3b3a1dfbb9091ebb3f27b9  src/dashboard/app/components/panels/TokenUsage.tsx

> customopenwolf@1.2.0-custom.1 test
> node --test "tests/**/*.test.js"
...
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2512.661535

> customopenwolf@1.2.0-custom.1 verify
> node scripts/verify-install.js

OpenWolf install verification passed.
```

## Verdict

- [x] Survived. The code file compiled, the edited-code hashes are current, tests passed, and install verification preserved the OpenWolf compatibility scaffold.
- [ ] Falsified — link the fix.
