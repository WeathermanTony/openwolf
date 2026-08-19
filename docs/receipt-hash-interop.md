# Proposal: receipt-hash interop for cross-provider review verification

**Status:** proposal (P5). No code changes proposed for the companion transport.
**Problem statement, already recorded in the operating protocol:** "Companion
receipt hashes currently use a different representation from Wolfpack's
`--reviewed-hash` manifest. Do not pass a companion receipt hash as
`--reviewed-hash`."

## Why the two hashes differ

Both sides hash sha256-over-JSON with deterministic ordering. They differ in
*what is hashed*, not in cryptography.

**Wolfpack** (`hashReviewManifest`, `src/hooks/shared.ts`) builds an array of
`[normalizedPath, sha256]` pairs sorted by path, then hashes
`JSON.stringify(array)`:

```js
const manifest = files.map((f) => [f, hashes[f]]).sort((a, b) => a[0].localeCompare(b[0]));
crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
```

**Canonical-JSON receipts** (the `*-receipt-v1` pattern) recursively key-sort an
*object* inside a versioned envelope, then hash the stringified result:

```js
const canonical = (v) => Array.isArray(v) ? v.map(canonical)
  : (!v || typeof v !== "object") ? v
  : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
crypto.createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
```

An array-of-pairs and a key-sorted object never serialize identically, and the
receipt envelope additionally covers contract-version and non-file fields. So the
top-level digests cannot match — correctly, since they attest to different things:
Wolfpack's says "these bytes were reviewed"; the receipt's says "this whole
receipt, including its metadata, is intact."

## The bridge: a shared substrate, not a shared digest

Both schemes are built over the same primitive — a map from file path to the
sha256 of that file's bytes. That map is sufficient to recompute Wolfpack's
manifest hash exactly.

Demonstrated:

```
wolfpack manifest hash : 19fa502c6122c9a04d7e
canonical-json  hash   : a2637a1f167f9bcb7c08
equal? false

common substrate = per-file sha256 map
  recomputed from receipt : 19fa502c6122c9a04d7e MATCHES wolfpack
```

(`/tmp/bridge-demo.cjs`; reproduce with the snippet in "Reproduction" below.)

**Therefore the two need not agree on a digest. They need only agree on the
substrate.** A receipt that exposes its per-source content hashes lets Wolfpack
derive its own manifest hash locally and compare against what it computed from
current bytes. No transport change, no shared hashing library, no coordination on
envelope format.

## Proposed contract

A companion receipt is *Wolfpack-bridgeable* when it carries:

1. `sources`: an object mapping **project-relative, forward-slash-normalized**
   paths to the lowercase hex sha256 of the file's exact bytes as reviewed.
2. `contract`: a version string, so a future change is detectable rather than
   silent.

Wolfpack then:

1. Reads `sources` from the receipt.
2. Recomputes `hashReviewManifest(files, sources)` using its own normalization.
3. Compares against the manifest it computes from current bytes.
4. On match, `--reviewed-hash` may be populated from the *derived* value — never
   from the receipt's own top-level digest.

Step 4 is the load-bearing restriction: the receipt digest stays an integrity
check on the receipt, and Wolfpack's manifest hash stays an attestation about
reviewed bytes. Passing one as the other is exactly the conflation the current
protocol warns against.

## Failure modes this must not paper over

- **Path normalization drift.** If a companion reports `src\a.ts` or an absolute
  path, derived hashes silently differ from Wolfpack's. The bridge must normalize
  identically or fail closed — never fall back to a partial match.
- **Partial file sets.** A receipt covering a subset of the pending review's files
  must not verify the whole set. Derive per-file, then require full coverage of
  the pending file list.
- **Sentinel values.** Wolfpack records tombstone/unreadable sentinels for missing
  or oversized files. A receipt with no equivalent must not silently coerce those
  to a real hash.
- **Empty `sources`.** Zero entries must fail, not verify vacuously. Assert the
  denominator, as every other Wolfpack check does.

## What blocks this

Adoption requires companion receipts to expose the per-source hash map. Whether
they can is **owned by the companion plugins, not by Wolfpack** — each companion
implements its own receipt writer, and several are third-party or proxy-backed.

This is a genuine external blocker, so it is recorded as a parked question rather
than guessed at. See `UQ-1` in `.wolf/parked-questions.md`.

Nothing here requires the blocker to resolve before use: if a companion already
emits per-source hashes, the bridge works today for that companion. The parked
question governs the *general* case.

## Reproduction

```bash
node -e '
const c=require("crypto");
const files={"src/a.ts":"aa".repeat(32),"src/b.ts":"bb".repeat(32)};
const wolf=c.createHash("sha256").update(JSON.stringify(
  Object.entries(files).sort((a,b)=>a[0].localeCompare(b[0])))).digest("hex");
const canon=v=>Array.isArray(v)?v.map(canon):(!v||typeof v!=="object")?v:
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])]));
const rec=c.createHash("sha256").update(JSON.stringify(canon(
  {contract:"receipt-v1",sourceSnapshots:files}))).digest("hex");
console.log("differ:", wolf!==rec);
console.log("derivable:", c.createHash("sha256").update(JSON.stringify(
  Object.entries(files).sort((a,b)=>a[0].localeCompare(b[0])))).digest("hex")===wolf);'
```
