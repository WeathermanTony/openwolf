---
target: src/cli/ledger-cmd.ts
target-hash: f4b491cef12fb3e23eab46a180c36d448640d70512c25e4ee17be68ade8d130e
created: 2026-08-08
reproduction_command: npm run build && node --test tests/ledger-integrity.test.js
---

# Ledger CLI handler boundaries

## Assumptions

1. The handler rejects normalization without a ledger kind.
2. The handler independently refuses `--fleet --apply`, even if called outside Commander.
3. The handler independently requires structural-normalization acknowledgement for apply.
4. Recovery forwards the exact project, kind, receipt, apply, and acknowledgement values to the guarded recovery implementation.
5. Dry-run aggregation never reports records as written or verified.

## Riskiest assumption and falsifier

The riskiest assumption is defense in depth: programmatic calls to the handler must not bypass Commander’s option checks. The focused tests exercise dry-run aggregation and the underlying mutation/recovery guards after compilation.

```text
# tests 10
# pass 10
# fail 0
```

Built help additionally exposed the required kind/apply/acknowledgement options, while fleet normalization was labeled dry-run-only.

## Verdict

The handler and underlying governed operations survived the focused suite on the current target hash.
