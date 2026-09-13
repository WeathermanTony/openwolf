---
target: src/cli/init.ts
target-hash: fd6bbba51477b5505fec624da589deef2cb81a520937cbfa2282558025237830
target-test: tests/init-root-scope.test.js
target-test-hash: c0eedbdb978ba935cc6b6f6fb6d28ac71a87a96e689cdeeb62343201575a7871
created: 2026-09-13
reproduction_command: npm run build && node --test tests/init-root-scope.test.js
evidence_source: executed against production-built CLI
---

# Explicit init root scope

## Claim

`openwolf init --root <path>` initializes exactly the requested existing directory, even when that markerless directory is nested beneath a different WolfPack root.

## Assumptions

1. An explicit root must bypass marker-based ancestor discovery rather than seed that discovery.
2. The target must already exist and be a directory before any managed file or registry mutation occurs.
3. An ancestor `.wolf` directory must remain untouched when a nested root is explicitly selected.
4. Registration must record the exact normalized child path in the isolated user registry.

## Riskiest assumption

The CLI action receives Commander options containing `root` and passes them unchanged to `initCommand()`. If the option is ignored, marker discovery silently selects the parent and the command still reports success.

## Falsification test

Create a markerless child under a parent containing only a `.wolf/sentinel.txt`, initialize with `--root <child>` under an isolated HOME, and require the child installation plus exact registry root while the parent directory remains byte-shape unchanged. Also require a nonexistent target to fail before creation.

## Actual output

Fixed production CLI:

```text
ok 1 - init --root scopes a markerless nested project exactly
ok 2 - init --root rejects a nonexistent directory before writing
# tests 2
# pass 2
# fail 0
# skipped 0
```

Negative control replacing explicit root selection in built `dist/src/cli/init.js` with the old `findProjectRoot()` call:

```text
not ok 1 - init --root scopes a markerless nested project exactly
The input did not match ... Project root: .../parent/nested-project
Project root: .../parent
# tests 1
# pass 0
# fail 1
negative_control_exit=1
```

## Verdict

The explicit root is behaviorally load-bearing: removing it reproduces the parent-root selection that occurred during the mt5 canary bootstrap.

## Limit

The option deliberately requires an existing directory; it does not create a missing project root or infer whether that directory should become a Git repository.
