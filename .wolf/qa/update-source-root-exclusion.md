---
target: src/cli/update.ts
target-hash: 56462c3223d1195542de6fd78414ca7cab779a8353a1f58cc7332e9f8755406a
created: 2026-08-08
reproduction_command: npm run build && node --test tests/update-source-exclusion.test.js
---

# Fleet updater source-root exclusion

## What the code claims to do

Fleet update must never rewrite the checkout that supplies the updater, regardless of that registry entry's display name, while still allowing unrelated projects with similar names to update.

## Assumptions (≥3)

1. The updater can derive its package/source root from the compiled module location.
2. Registry roots may contain aliases or `.` segments, so normalized real-path identity is required.
3. A project named `customopenwolf` at a different root is not automatically the source checkout.
4. The legacy `openwolf` display-name skip remains defense-in-depth for older registrations.

## Pick the riskiest assumption

The riskiest assumption is that display name identifies the source checkout. The package is named `customopenwolf`, so the old `name === "openwolf"` check could select and rewrite the active source tree during a fleet update.

## Falsification test

The test supplies the same source root under different names and path spellings, plus a different root with the same package-like name. Only normalized source identity and the legacy exact name may be skipped.

```bash
npm run build && node --test tests/update-source-exclusion.test.js
```

## Run output

```text
# Subtest: source checkout exclusion uses normalized root identity
ok 1
# tests 1
# pass 1
# fail 0
```

## Verdict

- [x] Assumption survived the test. Source identity is name-independent and same-name unrelated roots remain eligible.

## Follow-ups

Fleet dry-run must still confirm the actual registered source root is skipped before any real deployment.
