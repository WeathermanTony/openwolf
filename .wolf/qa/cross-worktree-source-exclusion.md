---
target: src/cli/update.ts
target-hash: 53799baa40e2ee619e550fbf3228171b50f23a5b27331f15f1342026e84d1114
target-test: tests/update-source-exclusion.test.js
target-test-hash: f7500fa4b90e0697187585a6c6c32aaa5326a0496b2a2bc0b921e4b76239f1fc
created: 2026-09-13
reproduction_command: npm run build && node --test tests/update-source-exclusion.test.js
evidence_source: executed against production-built runtime
---

# Cross-worktree source-project exclusion

## Claim

Fleet update excludes the canonical OpenWolf source checkout even when the update CLI is executed from a detached release worktree rather than that canonical checkout.

## Assumptions

1. `SOURCE_ROOT` identifies only the checkout that produced the running CLI, not every worktree of the same repository.
2. A genuine source checkout carries the same package identity as the running CLI plus `src/cli/update.ts` and `templates/wolf` source-layout markers.
3. A downstream project that happens to use the same package name but lacks the source layout must remain updateable.
4. A source-layout directory for a different package must not be skipped.

## Riskiest assumption

Package identity plus both source-layout markers distinguish another checkout of this source repository from an ordinary managed project. Over-broad matching would silently exclude legitimate projects from fleet updates.

## Falsification test

Create four isolated fixtures: the running source root, another checkout with matching package/layout identity, an ordinary same-name project without source layout, and a different-package source-shaped project. Require only the first two and the legacy explicit `openwolf` name to be excluded.

## Actual output

Fixed production runtime:

```text
ok 1 - source checkout exclusion follows repository identity across worktrees
# tests 1
# pass 1
# fail 0
# skipped 0
```

Negative control with the new checkout-layout predicate removed from built `dist/src/cli/update.js`:

```text
not ok 1 - source checkout exclusion follows repository identity across worktrees
Expected values to be strictly equal:
# tests 1
# pass 0
# fail 1
# skipped 0
negative_control_exit=1
```

Full current working-tree validation:

```text
npm run build: PASS
# tests 282
# pass 282
# fail 0
# skipped 0
OpenWolf install verification passed.
git diff --check: PASS
```

## Verdict

The previous realpath-only check was insufficient across worktrees. Matching package identity plus the two source-layout markers excludes the canonical source checkout while both over-match controls remain updateable.

## Limit

This identifies source checkouts by repository layout rather than Git metadata so it also works in exported source trees. A deliberately mimicked package name and source layout would be treated as a source checkout; that directory is operationally indistinguishable from one for update safety purposes.
