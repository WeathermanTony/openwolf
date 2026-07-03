---
target: package.json
target-hash: 2b4f280ba502cda29c654eab627de6529f20de16a8d51a37ebf50e4b59d228c3
created: 2026-07-03
---

# Wolfpack brand alias

## What the code claims to do

Wolfpack should become the user-facing name for this heavily customized workflow while preserving OpenWolf compatibility internals.

## Assumptions (≥3)

1. **CLI compatibility is preserved** — `openwolf` remains a package bin and `wolfpack` is added as an alias to the same built CLI.
2. **Fresh init uses the new user-facing brand** — init/upgrade summary output says Wolfpack while `.wolf/` and `openwolf.*` compatibility remain intact.
3. **Dashboard uses the new brand** — loading text, title, sidebar label, token comparison, and Design QC explanatory text use Wolfpack where they describe the enhanced product.
4. **Templates explain the distinction** — generated project instructions present Wolfpack as the customized harness and identify OpenWolf as the runtime namespace where needed.
5. **No runtime regression** — TypeScript, dashboard build, tests, and install verifier continue to pass after the rename layer.

## Riskiest assumption

The riskiest assumption is **CLI compatibility is preserved**. If adding the `wolfpack` alias or changing user-facing text breaks packaging or install verification, existing projects would lose the stable `openwolf` path.

## Falsification test

Build the package, hash the changed brand-layer files, run the test suite, and run the install verifier.

```bash
npm run build
sha256sum package.json src/cli/init.ts bin/openwolf.ts src/dashboard/app/App.tsx src/dashboard/app/components/layout/Sidebar.tsx src/dashboard/app/components/panels/TokenUsage.tsx src/dashboard/app/components/panels/DesignQC.tsx README.md
npm test
npm run verify
```

## Run output

```text
> customopenwolf@1.2.0-custom.1 build
> tsc && npm run build:dashboard && npm run postbuild:chmod
...
✓ built in 13.60s

2b4f280ba502cda29c654eab627de6529f20de16a8d51a37ebf50e4b59d228c3  package.json
bd31baa891d85ae00bb2e4ac7039f852ec708adfb949f696271fc78b74ed1a1e  src/cli/init.ts
62fc150e2a15734695b943231564bb216ccafd01e6f7ea572ba7560f2805e7eb  bin/openwolf.ts
30ab90cae551e9c2a12cb187d0fafca02a8739780823b4150381060e815df523  src/dashboard/app/App.tsx
9c748cd8b4919199caafbcb82ba0da27d8d5b3a524dd6dcdb7619803783a711c  src/dashboard/app/components/layout/Sidebar.tsx
6e695a8052ab80ca534e1f2cc8809403b655ba280d3b3a1dfbb9091ebb3f27b9  src/dashboard/app/components/panels/TokenUsage.tsx
49c6b514a0bcfa3383e8c24d294e580c8a1bc7f468f5c5276bab50001062246c  src/dashboard/app/components/panels/DesignQC.tsx
9cf0e713edeed83721cd944bc1b7e7ee547f7471fb63690283f619dd92a53f18  README.md

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
# duration_ms 2347.763348

> customopenwolf@1.2.0-custom.1 verify
> node scripts/verify-install.js

OpenWolf install verification passed.
```

## Verdict

- [x] Survived. The build accepted the `wolfpack` bin alias, tests passed, and the install verifier still accepts the OpenWolf compatibility scaffold.
- [ ] Falsified — link the fix.
