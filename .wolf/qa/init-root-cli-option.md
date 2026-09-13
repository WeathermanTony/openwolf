---
target: src/cli/index.ts
target-hash: a55bf04599f14b8bcfdf56144cd050320a1f319b8386e79d5533caebdd0b5a15
target-test: tests/init-root-scope.test.js
target-test-hash: c0eedbdb978ba935cc6b6f6fb6d28ac71a87a96e689cdeeb62343201575a7871
created: 2026-09-13
reproduction_command: npm run build && node --test tests/init-root-scope.test.js
evidence_source: executed against production-built CLI
---

# Init root CLI option wiring

## Claim

The Commander `init` command exposes `--root <path>` and passes the parsed option into `initCommand`, making exact-root selection reachable from the shipped CLI.

## Assumptions

1. Commander includes declared command options in the object passed to the action handler.
2. The existing direct `.action(initCommand)` binding preserves the `root` property rather than filtering it.
3. The built `dist/bin/openwolf.js` loads the modified command definition.
4. A markerless child beneath an ancestor `.wolf` distinguishes working option wiring from fallback discovery.

## Riskiest assumption

The option is behaviorally connected to the production action. A declaration that only changes `--help` would look complete in source review while initialization still targets the ancestor.

## Falsification test

Build the production CLI, invoke `init --root <markerless-child>` beneath an ancestor `.wolf`, and require the exact child in stdout and the isolated registry while the ancestor sentinel remains the only ancestor file.

## Actual output

```text
ok 1 - init --root scopes a markerless nested project exactly
ok 2 - init --root rejects a nonexistent directory before writing
# tests 2
# pass 2
# fail 0
# skipped 0
```

The paired mutation control in `.wolf/qa/explicit-init-root-scope.md` replaces explicit selection with `findProjectRoot()` in the built runtime and drives the positive test red with the ancestor path.

## Result

The production invocation, not only the TypeScript declaration, exercises the new option and differentiates it from marker discovery.

## Limit

This reduction covers option registration and action wiring. Path validation and write-before-validation behavior are covered by `.wolf/qa/explicit-init-root-scope.md`.
