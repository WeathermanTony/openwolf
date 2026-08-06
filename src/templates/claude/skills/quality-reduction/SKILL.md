---
name: quality-reduction
description: Build a current-byte Wolfpack QA reduction by naming concrete assumptions, running an adversarial falsifier, recording actual output, and emitting a compact skill receipt.
---

# Quality Reduction

Use this skill when Wolfpack requests a QA reduction or when a material conclusion needs falsification evidence.

## Boundary

This skill **produces evidence; it does not certify its own completion**. Wolfpack remains authoritative for scope, current target hashes, QA status, and any review lifecycle.

## Workflow

1. Read the owning project's `.wolf/anatomy.md`, `.wolf/cerebrum.md`, `.wolf/buglog.json`, `.wolf/OPENWOLF.md`, and `.wolf/qa/_template.md` before editing.
2. Resolve the nearest owning project for each changed source file. Skip Wolfpack-excluded paths and test-only files; do not create reductions merely to satisfy a hash matcher.
3. Choose one logical invariant set. Prefer one reduction per source target. For a genuinely coupled multi-file invariant, use paired `target-<slug>` / `target-hash-<slug>` fields and explicitly verify every hash because `wolfpack qa status` resolves only the singular `target` field.
4. State at least three concrete assumptions: exact type, shape, range, ordering, timing, filesystem, process, protocol, or state invariants.
5. Pick the assumption with the highest consequence and uncertainty. Design a test that tries to falsify it. When a value crosses a process, shell, file, network, browser, daemon, or tool boundary, test the receiving context—not source-string presence.
6. Run one exact replayable command. Paste literal stdout/stderr and exit outcome into `.wolf/qa/<slug>.md`. Never substitute expected output.
7. After the final source edit, compute SHA-256 over raw target bytes and write the final `target-hash` field. Mark the verdict honestly; a falsified assumption requires a fix and a new run.
8. Run `wolfpack qa status --check`. Report unrelated stale, orphan, or broken reductions separately; do not claim the new reduction fixed them.
9. If the result exposes a repeatable mistake class, add a concise Do-Not-Repeat entry citing the reduction.
10. Emit a compact JSON receipt under `.wolf/skill-receipts/<invocation-id>.json`. Store metadata and evidence pointers/hashes only—never secrets or large raw provider output.

## Receipt contract v1

Use the exported helpers from `.wolf/hooks/shared.js` (or the source equivalent while developing Wolfpack):

- `hashFilesAtRest(files)`
- `makeArtifactManifest(files, hashes)`
- `makeSkillReceipt(options, existing?)`
- `validateSkillReceipt(receipt)`
- `verifySkillReceiptInputs(receipt)`

Required receipt semantics:

```json
{
  "version": 1,
  "kind": "skill-receipt",
  "created_at": "<ISO-8601>",
  "updated_at": "<ISO-8601>",
  "skill": { "id": "quality-reduction", "version": null, "provider": null },
  "invocation": {
    "id": "quality-reduction-<stable-id>",
    "started_at": "<ISO-8601>",
    "finished_at": "<ISO-8601>",
    "command": "<exact reproduction command, with secrets omitted>"
  },
  "status": "succeeded",
  "inputs": { "version": 1, "hash_algorithm": "sha256", "manifest_algorithm": "sha256-json-v1", "manifest_hash": "<hash>", "files": ["<normalized absolute artifact path>"], "hashes": { "<same path>": "<sha256>" } },
  "outputs": { "version": 1, "hash_algorithm": "sha256", "manifest_algorithm": "sha256-json-v1", "manifest_hash": "<hash>", "files": ["<normalized absolute artifact path>"], "hashes": { "<same path>": "<sha256>" } },
  "result": {
    "outcome": "clean",
    "summary": "The named assumption survived the recorded falsifier.",
    "evidence": [{ "kind": "report", "value": ".wolf/qa/<slug>.md" }]
  },
  "limits": ["<what the falsifier did not establish>"],
  "provenance": {
    "attestation_level": "manifest-bound",
    "input_manifest_hash": "<same as inputs.manifest_hash>",
    "source": "quality-reduction"
  }
}
```

Allowed lifecycle statuses: `planned`, `running`, `succeeded`, `failed`, `cancelled`.

Allowed outcomes: `clean`, `findings`, `partial`, `error`, `unknown`.

Attestation levels:

- `snapshot`: bytes were captured; no result is claimed.
- `self-asserted`: the producer reports a result without independently bound evidence.
- `manifest-bound`: the command and evidence apply to the declared input manifest.
- `externally-verifiable`: an independent verifier can reproduce and validate the evidence.

Do not place opaque provider receipt hashes into `input_manifest_hash`; Wolfpack's canonical manifest is SHA-256 over sorted `[normalized path, file hash]` tuples.
