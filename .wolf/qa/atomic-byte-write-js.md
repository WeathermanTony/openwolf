---
target: src/utils/size-discipline.js
target-hash: 7b51245cf6176ddad0f23b5ae474d7a9350da77ee09bb5c8ed67dbcb9f8949c3
created: 2026-08-08
reproduction_command: npm run build && node --test tests/ledger-integrity.test.js
---

# Binary-safe atomic writes (runtime JavaScript)

## Assumptions

1. The runtime module exports `atomicWriteBytes` with the same binary-safe semantics as the TypeScript source.
2. Ledger normalization imports the runtime export successfully after compilation.
3. Exact backup and recovery bytes are not converted through UTF-8 text.
4. Existing JSON/text callers continue to use the same atomic rename and fsync path.

## Riskiest assumption and falsifier

The focused suite imports the compiled runtime, performs normalization and recovery, checks backup equality against the original `Buffer`, and verifies exact restoration.

```text
# tests 10
# pass 10
# fail 0
```

## Verdict

The runtime export and exact-byte behavior survived the focused suite.
