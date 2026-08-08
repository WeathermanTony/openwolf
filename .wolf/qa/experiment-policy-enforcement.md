---
target: src/cli/experiment-cmd.ts
target-hash: b4ffeaf49b19ee2ade0f1938e5980a3df4126da42d8141140ecbe20678eb71f0
created: 2026-08-08
reproduction_command: npm run build && node --test tests/experiment-cmd.test.js
---

# Experiment policy enforcement

## What the code claims to do

Experiment Mode remains opt-in: mutating commands require explicit enablement and obey project-configured ceilings, while read-only verification remains available for existing records.

## Assumptions (≥3)

1. `openwolf.experiments.enabled` is a boolean and disabled/missing policy blocks start, evidence, and conclude.
2. Caller options cannot raise the configured attempt ceiling.
3. Evidence count, output characters, and each protected input's byte size are bounded by positive integer policy values.
4. Invalid JSON or malformed policy values fail closed instead of falling back to permissive behavior.
5. Read-only record verification does not require the mutation policy to remain enabled.

## Pick the riskiest assumption

The riskiest assumption is that config is actually authoritative. A decorative `enabled: false` or unenforced ceiling would expose a write-capable feature while users reasonably believe it is disabled and bounded.

## Falsification test

The focused suite creates isolated projects, disables policy after creating a record, attempts another mutation, attempts to exceed every ceiling, supplies invalid policy types, and verifies a current record while mutation is disabled.

```bash
npm run build && node --test tests/experiment-cmd.test.js
```

## Run output

```text
# tests 7
# pass 7
# fail 0

Additional adversarial case: an evidence file larger than the configured 4-byte output ceiling was rejected before `readFileSync`, preventing an unbounded memory read.
```

The combined release-safety run also reported 14/14 passing focused tests.

## Verdict

- [x] Assumption survived the test. Mutation was blocked while read-only verification remained available; attempt, evidence, output, and protected-file ceilings all rejected or truncated the adversarial inputs as declared.

## Follow-ups

Keep default/template/current config schemas synchronized and rerun this reduction whenever Experiment Mode policy or record mutation changes.
