---
target: templates/wolf/utils/size-discipline.js
target-hash: 7b51245cf6176ddad0f23b5ae474d7a9350da77ee09bb5c8ed67dbcb9f8949c3
created: 2026-08-08
reproduction_command: node scripts/verify-install.js
---

# Binary-safe atomic writes (deployment template)

## Assumptions

1. New and updated projects receive the binary-safe utility implementation.
2. The template export matches the source-adjacent JavaScript implementation.
3. The template remains valid ESM in receiving projects.
4. Install/update verification detects a missing managed utility dependency.

## Riskiest assumption and falsifier

The install verifier exercises the managed payload contract after template synchronization.

```text
OpenWolf install verification passed.
```

## Verdict

The deployment-template assumption survived install verification.
