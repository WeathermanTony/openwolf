# Parked Questions

Externally-blocked decisions shipped behind a named seam. See `## Parked Questions`
in `.wolf/OPENWOLF.md`. Numbers are permanent and never reused.

## UQ-1 — Can companion receipts expose a per-source content-hash map?

**Question:** Can the standardized provider companions include a
`sources: { <project-relative path>: <sha256 hex> }` map in their review receipts,
so Wolfpack can derive its own `--reviewed-hash` manifest from a companion review?

**Recommendation given:** Adopt the substrate bridge rather than a shared digest.
The two hashes attest to different things and should stay distinct — Wolfpack's
manifest hash attests to reviewed bytes, a receipt digest attests to receipt
integrity. Companions need only expose the per-file sha256 map they already
compute while staging; Wolfpack recomputes its manifest locally and never accepts
a receipt digest as `--reviewed-hash`. Full reasoning and a working derivation:
`docs/receipt-hash-interop.md`.

**BLOCKER:** Companion plugin ownership. Each companion writes its own receipt
format under `~/.claude/plugins/marketplaces/tony-local/plugins/<name>/scripts/`;
several are third-party or proxy-backed, so the receipt schema is not Wolfpack's
to change. Unblocked by a companion maintainer confirming the field can be added,
or by inspecting a companion receipt that already carries per-source hashes.

**Placeholder shipping in its place:** The existing protocol rule stands unchanged
— "Do not pass a companion receipt hash as `--reviewed-hash`" — and review
completion continues to use `--reviewed-current`, which verifies against bytes
Wolfpack hashes itself. No derived-hash path is enabled.

**Blast radius if the real answer differs:** Small and contained. If companions
cannot expose the map, nothing changes; the current `--reviewed-current` flow is
already sound, just not composable across providers. If they can, the gain is that
a companion review becomes verifiable evidence for Wolfpack's own manifest rather
than a parallel attestation. The risk of a wrong guess is that a bridge built on a
receipt field that never materializes would be dead code — which is why this is
parked rather than implemented.

STATUS: OPEN
