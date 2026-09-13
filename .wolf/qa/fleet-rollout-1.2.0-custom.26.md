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

## Limits

This document records the completed 1.2.0-custom.25 rollout and the local 1.2.0-custom.26 corrective validation. The 1.2.0-custom.26 exact-commit clean-worktree test, re-canary, and final fleet propagation must be appended after those actions run; this pre-commit evidence does not substitute for them.
