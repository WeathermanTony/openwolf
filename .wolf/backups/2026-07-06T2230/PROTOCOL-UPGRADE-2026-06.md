# OpenWolf Protocol Upgrade — 2026-06

Portable snippet for existing OpenWolf projects that need the recall/proof/consolidation protocol without reinstalling the full runtime immediately.

## Paste into `.wolf/OPENWOLF.md`

Add these sections after `## Code Generation`:

```md
## Recall Before Acting

Before starting non-trivial work, use OpenWolf's local memory in this order:

1. Check `.wolf/anatomy.md` to locate only the files needed.
2. Check `.wolf/cerebrum.md` for project conventions, user preferences, and do-not-repeat lessons.
3. Check `.wolf/buglog.json` before fixing errors or repeating a pattern that may already have a known fix.
4. Prefer applying an existing proven fix over rediscovering one. If the existing memory is stale or wrong, correct it as part of the work.

## Link Fixes to Proof

Every buglog entry should connect the reported problem to the evidence that the fix was real:

- `commit`: the resolving commit SHA when known, otherwise `null` until committed.
- `reduction`: the QA reduction, test file, command, or transcript that proves the fix, otherwise `null` until evidence exists.

When adding or updating a buglog entry, include both fields. If a bug is fixed before commit, fill `reduction` immediately and backfill `commit` after the fix is committed.

## Consolidate When Noisy

OpenWolf memory should stay useful, not merely large. When `.wolf/memory.md`, `.wolf/buglog.json`, review logs, or QA logs become noisy:

1. Preserve durable facts, current decisions, and recurring gotchas in `.wolf/cerebrum.md`.
2. Keep raw chronological detail in the original log only when it is still operationally useful.
3. Prefer compact summaries that link to proof files, reductions, review IDs, or commits.
4. Do not delete user data just to reduce size; consolidate only when the retained summary is enough to recover the lesson.
```

## Buglog schema bump

For every entry in `.wolf/buglog.json`, add these fields if missing:

```json
{
  "commit": null,
  "reduction": null
}
```

Use `commit` for the resolving SHA once known. Use `reduction` for the proof artifact: QA reduction path, test file, command output note, review ID, or transcript pointer.

## One-shot updater

From a project root, this normalizes the buglog fields only:

```bash
node - <<'NODE'
const fs=require('fs');
const path='.wolf/buglog.json';
const log=JSON.parse(fs.readFileSync(path,'utf8'));
for (const bug of log.bugs || []) {
  if (!Object.prototype.hasOwnProperty.call(bug,'commit')) bug.commit = null;
  if (!Object.prototype.hasOwnProperty.call(bug,'reduction')) bug.reduction = null;
}
fs.writeFileSync(path, JSON.stringify(log,null,2)+'\n');
console.log(`normalized ${(log.bugs||[]).length} bug entries`);
NODE
```
