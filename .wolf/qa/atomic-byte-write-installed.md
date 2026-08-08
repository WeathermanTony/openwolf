---
target: .wolf/utils/size-discipline.js
target-hash: eaa822abe49d3db9e5867c090c05301e568c2e430c527e62af96cb9f9b4bd37f
created: 2026-08-08
reproduction_command: node scripts/verify-install.js
---

# Binary-safe atomic writes (installed runtime)

## Assumptions

1. The installed `.wolf` utility exports the binary writer required by deployed hook/runtime code.
2. Its package/module layout remains loadable as ESM.
3. Deployment does not omit the updated utility.
4. The installed payload remains synchronized with the managed source/template contract.

## Riskiest assumption and falsifier

Install verification checks the packaged and deployed managed payload after adding the export.

```text
OpenWolf install verification passed.
```

## Verdict

The installed runtime payload survived install verification.
