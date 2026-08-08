---
target: src/utils/size-discipline.ts
target-hash: 6de186dd9577c47b36053aa01aa7a2246a131c00ea80b94bffb6e06a15a2b8f3
created: 2026-08-08
reproduction_command: npm run build && node --test tests/ledger-integrity.test.js
---

# Binary-safe atomic writes (TypeScript source)

## Assumptions

1. `atomicWriteBytes` writes a `Buffer` without UTF-8 decoding or newline transformation.
2. The temporary file is exclusively created, fsynced, renamed, and the parent directory is fsynced where supported.
3. Failure leaves the destination untouched and cleans up the temporary file.
4. `atomicWriteText` and `atomicWriteJson` retain their existing text behavior through the byte writer.

## Riskiest assumption and falsifier

Exact bytes must survive backup and recovery. The ledger suite normalizes formatted source bytes, verifies the backup byte-for-byte, recovers through `atomicWriteBytes`, and asserts the restored file equals the original raw text exactly.

```text
# tests 10
# pass 10
# fail 0
```

## Verdict

The exact-byte backup/recovery assumption survived the current focused suite.
