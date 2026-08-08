---
target: src/cli/index.ts
target-hash: 959a3d50531e82137844f0f595e0f3b17466bd1bf9d3fa44bf5349f2c9958179
created: 2026-08-08
reproduction_command: npm run build && node --test tests/ledger-integrity.test.js && node dist/bin/openwolf.js ledger normalize --help && node dist/bin/openwolf.js ledger recover --help
---

# Ledger CLI command boundaries

## Assumptions

1. Normalization requires an explicit `--kind bug|review`, so one invocation cannot silently mutate both ledgers.
2. Normalization is dry-run unless `--apply` is present and fleet apply is refused.
3. Structural mutation requires the explicit long acknowledgement flag.
4. Recovery requires kind, apply, acknowledgement, and a specific receipt.
5. CLI option names match the documented operational protocol.

## Riskiest assumption and falsifier

The riskiest assumption is that the mutation boundary is actually exposed and enforced rather than merely documented. The focused suite exercises governed normalization/recovery, and built-command help was inspected for the required options.

```text
# tests 10
# pass 10
# fail 0

normalize options:
--kind <kind>
--fleet
--apply
--acknowledge-structural-normalization

recover options:
--kind <kind>
--apply
--acknowledge-structural-normalization
```

## Verdict

The built CLI exposes the intended project/kind/apply/acknowledgement boundaries, and the focused suite passed on the current target hash.
