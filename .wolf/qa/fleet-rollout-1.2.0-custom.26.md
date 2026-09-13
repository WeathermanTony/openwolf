---
target: src/cli/update.ts
target-hash: 53799baa40e2ee619e550fbf3228171b50f23a5b27331f15f1342026e84d1114
target-test: tests/update-source-exclusion.test.js
target-test-hash: f7500fa4b90e0697187585a6c6c32aaa5326a0496b2a2bc0b921e4b76239f1fc
created: 2026-09-13
reproduction_command: npm run build && node --test tests/update-source-exclusion.test.js
evidence_source: canary and fleet rollout transcripts plus content-bound local verification
---

# Fleet rollout 1.2.0-custom.26

## Claim

The staged WolfPack rollout preserves project-owned data, deploys the managed bytes produced by the release runtime, and excludes every checkout of the OpenWolf source tree rather than only the worktree executing the command.

## Assumptions

1. The mt5_dgm_lite canary is independently registered and therefore exercises an exact project root rather than its ancestor WolfPack installation.
2. Protected-file hashes captured before deployment cover the project-owned files the updater must not replace.
3. Installed template files must be compared with `src/templates`, while installed hook and utility JavaScript must be compared with the freshly built `dist/src/hooks` and `dist/src/utils` producers used by `update.ts`.
4. The canonical customopenwolf checkout must be omitted even when deployment runs from a detached release worktree with a different realpath.
5. Existing dashboard settings are preserved rather than interpreted as features introduced by this release, and daemon auto-start remains disabled unless already explicitly configured.

## Staged evidence

The representative canary was `/mnt/j/projectshome/projects/darwingodelmachine/mt5_dgm_lite`.

- Independent initialization and registry identity: PASS.
- Dry-run followed by scoped update: PASS.
- Eleven protected canary files changed: `0`.
- Hook runtime payload: all 19 expected files present.
- Hook registration health: current.
- Functional smoke (`session-start.js`, `pre-read.js`, `post-read.js`, `pre-write.js`): every command exited `0`.
- Anatomy freshness and `python3 validate_candidate.py baseline-candidate.json`: PASS.
- Canary daemon auto-start: disabled.
- Canary dashboard: disabled.

The authorized fleet rollout then updated 97 registry entries. Runtime disposition was 0 daemon removals, 0 explicit daemon starts, 97 not running, and 0 stale owned PM2 entries.

The corrected non-source verification covered 96 managed roots:

```text
targets: 96
protectedChecked: 1056
managedChecked: 1920
settingsChecked: 96
versionChecked: 96
dashboardEnabledPreserved: 61
daemonAutoStartEnabled: 0
failureCount: 0
```

The 61 dashboard-enabled configurations were existing settings preserved byte-semantically by rollout; this release did not introduce or enable dashboard behavior.

## Falsification and negative controls

### Wrong producer binding

The first verifier compared installed `OPENWOLF.md` with `templates/wolf/OPENWOLF.md` and installed hook JavaScript with source-adjacent/template mirrors. It went red despite a successful deployment:

```text
targets: 96
protectedChecked: 1056
managedChecked: 1920
settingsChecked: 96
failureCount: 672
```

Reading the deployment code showed those were not the actual producer paths. Rebinding to `src/templates`, fresh `dist/src/hooks`, and `dist/src/utils` reduced the same bounded fleet check to `failureCount: 0` without rewriting any project. This falsifies the assumption that similarly named mirrors are authoritative deployment evidence.

### Cross-worktree source exclusion

Removing `hasSourceCheckoutLayout(project.root, sourceRoot)` from the built runtime causes the focused source-exclusion test to fail:

```text
not ok 1 - source checkout exclusion follows repository identity across worktrees
# tests 1
# pass 0
# fail 1
negative_control_exit=1
```

## Current pre-commit validation

```text
npm run build: PASS
# tests 282
# pass 282
# fail 0
# skipped 0
OpenWolf install verification passed.
git diff --check: PASS
```

## Result

The evidence supports widening only when verification is bound to the actual runtime producer paths. The prior verifier result was a false positive, while the detached-worktree source update was a real exclusion defect now pinned by a mutation control.

## Exact-commit, review, canary, and final propagation

Commit `8bda36b` was installed into a detached clean worktree with `npm ci`, then built and tested without borrowing dirty-tree bytes:

```text
# tests 278
# pass 278
# fail 0
# skipped 0
OpenWolf install verification passed.
git diff --check: PASS
clean worktree status: empty
```

A bounded current-byte ChatGPT companion review covered the five changed source/test files and returned:

```text
VERDICT: CLEAN
SCOPE: index.ts@a55bf04599f1, init-root-scope.test.js@c0eedbdb978b,
       init.ts@fd6bbba51477, update-source-exclusion.test.js@f7500fa4b90e,
       update.ts@53799baa40e2
```

The first GLM transport attempt produced no verdict (`input is not a regular file: /dev/null`) and was not counted as a review pass.

The mt5 canary was upgraded from the exact detached build:

```text
mt5_dgm_lite — v1.2.0-custom.25 → v1.2.0-custom.26
protected_checked=415
protected_changed=0
all 10 core files present
hook runtime payload present: 19 files
hook registrations: current
anatomy: up to date
daemon auto-start: disabled
daemon runtime: not running
validator_smoke=PASS
```

The authorized final fleet update then reported:

```text
Updated: 96
Skipped: 1 (customopenwolf — openwolf source repo)
Daemon removed: 0
Explicit auto-start preserved: 0
Not running: 96
Stale owned entries: 0
```

Content-bound post-rollout verification against the exact release producers reported:

```text
targets: 96
protectedChecked: 1056
protectedBaselineDrift: 3
protectedRolloutPreserved: 1056
managedChecked: 1920
settingsChecked: 96
versionChecked: 96
dashboardEnabledPreserved: 61
daemonAutoStartEnabled: 0
failureCount: 0
```

The three baseline drifts were `rag` memory, anatomy, and buglog bytes that had changed before this rollout. The rollout-time `2026-09-13T2323` backup hashes equal the corresponding live hashes, proving the update preserved those current bytes rather than restoring the older baseline.

## Limits

The protected-file proof is byte-exact for all 1,056 baseline files: 1,053 equal the original pre-1.2.0-custom.25 baseline and the three independently evolved `rag` files equal their rollout-time backups. It does not claim those mutable ledgers should remain equal to an older snapshot indefinitely.
