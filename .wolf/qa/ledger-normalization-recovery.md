---
target: src/ledger/ledger-integrity.ts
target-hash: d35feaf54ed0d235ce2b64cab0579e366403f3f26838284adf3b147718d34ea1
created: 2026-08-08
reproduction_command: npm run build && node --test tests/ledger-integrity.test.js
---

# Governed ledger normalization and recovery

## What the code claims to do

Normalize recoverable legacy bug/review ledgers without deleting records: wrap bare arrays into canonical object roots, deterministically replace invalid or duplicate IDs above the existing maximum suffix, retain exact invalid-ID provenance, preserve references unchanged, and provide exact-byte hash-guarded recovery.

## Assumptions (≥3)

1. Every source record remains in the same array position and all fields other than planned `id` and invalid-ID provenance remain byte-semantically unchanged.
2. New canonical IDs are allocated strictly above the maximum valid suffix, keep the first valid duplicate, and cannot collide.
3. Bare arrays become canonical object roots while object-root metadata is preserved.
4. Reserved provenance collisions, malformed members, missing acknowledgement, fleet apply, and symlink/path escapes fail closed without mutating the ledger.
5. Recovery restores the exact original bytes only when the live normalized hash, project, kind, receipt, and backup all match.
6. Reference inventory excludes only primary record IDs; nested/root metadata references remain visible and no reference file is rewritten.

## Riskiest assumption

The riskiest assumption is data preservation across normalization and rollback. A clean-looking ledger is unacceptable if source records, metadata, references, formatting, or recovery bytes are lost or silently redirected.

## Falsification test

The focused suite exercises duplicate repair, invalid/missing semantic IDs, bare-array canonicalization, provenance collisions, root metadata, nested ID references, exact-byte recovery, live-hash refusal, symlinked project roots, receipt/backup symlink refusal, dry-run idempotence, and fleet dry-run non-mutation.

```bash
npm run build && node --test tests/ledger-integrity.test.js
```

## Run output

```text
# tests 10
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Independent review found and the suite now covers two concrete failure classes: nested metadata references previously hidden by an over-broad `id` exclusion, and valid recovery through symlinked project-root spellings previously rejected by mixed lexical/canonical receipt paths.

## Verdict

- [x] The assumptions survived the focused adversarial suite on the current target hash.

## Limits

This reduction verifies isolated fixtures and command boundaries. Fleet application still requires a separately verified canary followed by one-ledger-at-a-time rollout and receipt inspection.
