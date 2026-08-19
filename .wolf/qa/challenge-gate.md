---
slug: challenge-gate
target: src/templates/OPENWOLF.md
target-hash: 90f82cff8491e26db2298853b73100b30f8730c1a8685ecb95000052649af71a
reproduction_command: node --test tests/drift-cmd.test.js
date: 2026-08-19
---

# Adversarial reduction — Challenge Gate (P2)

Adds `### Challenge Gate` to the companion review lifecycle: a pre-writeup filter
that stress-tests a finding in two fresh sub-agent rounds **before** it drives any
edit, ledger entry, or re-review.

## Assumptions this section makes

1. **False positives concentrate in nameable categories** — security-class findings,
   findings near a design-decision comment, findings with no spec basis, divergent
   sibling code paths, and missing-functionality claims. If they were uniformly
   distributed, triggering on patterns would be arbitrary.
2. **A fresh sub-agent has no stake in the finding**, so it can reach a different
   verdict than the session that received it.
3. **Round 2 must argue the opposite side of round 1**, or the gate only ever
   confirms what round 1 already said.
4. **The gate is cheaper than the failure it prevents** (~2 sub-agent calls vs. an
   edit plus a re-review round spent on a finding that was never real).
5. **A challenge is not a review round** — it does not consume the three-round
   convergence budget, because it filters findings rather than reviewing bytes.
6. The section carries no source-repo or author vocabulary (standing constraint).

## Falsification — the gate was run on a real finding, not described

Assumption 3 is the load-bearing one: a gate whose second round rubber-stamps the
first is theatre. Tested by running the full gate on a genuine HIGH-severity
finding against code written earlier this session — the dual-base path resolution
in `src/cli/drift-cmd.ts`. It triggers two patterns (design-decision comment at the
cited line; "expected behavior" arguably the reviewer's opinion).

**Round 1 verdict: NOT A DEFECT.** Cited the design comment above `resolves` and the
paired test `'the dual-resolution fallback still fails on a genuinely absent file'`,
concluding the check "verifies existence, not location correctness."

**Round 2 verdict: CONFIRMED** — it reversed round 1 and produced a working
reproduction rather than an argument. Two findings against the dismissal:

- The dismissal's central claim was false. An anatomy entry under `## src/api/`
  asserts the file is *at that location*; "stale entry" means precisely that the
  index names a path no longer holding the artifact.
- **The existing test never exercised the failure mode.** `docs/nowhere.md` was
  absent under *both* candidate paths, so it proved only that the fallback cannot
  rescue a name absent everywhere — a strictly weaker claim that a single-base
  implementation would also satisfy.

I reproduced it independently from scratch rather than trusting the sub-agent:

```
src/api/auth.ts exists? false
root auth.ts exists?    true
findings: []
vacuous : []
CONFIRMED: real drift reported CLEAN
```

A genuinely deleted `src/api/auth.ts` was rescued by an unrelated root-level
`auth.ts` — a silent false negative in the exact class the command exists to catch.
Logged as bug-702 and fixed by narrowing the root fallback to entries that literally
begin with their own section path.

### Negative control (the fix must be load-bearing)

```
$ # guard removed, rebuilt
$ node --test tests/drift-cmd.test.js ; echo exit=$?
not ok 16 - a stale entry is not rescued by an unrelated same-named file at the root (bug-702)
# pass 16
# fail 1
exit=1

$ # guard restored
# tests 17
# pass 17
# fail 0
```

Exit status measured directly, not through a pipe.

### The fix did not reintroduce what the fallback was for

bug-699 (doubled prefix, `.wolf/qa/.wolf/qa/...`) re-checked on real data:

```
mt5automation: extracted=692 stale=386
doubled-prefix false positives: 0  (bug-699 stays fixed)
```

Stale count rose 360 → 386: **26 previously-hidden false negatives now surface** on
that project alone. 8 of 8 spot-checked on disk — all genuinely absent.

## What this says about the gate

The gate paid for itself on its first real invocation. Round 1 was thorough,
correct about the code's intent, and wrong about its consequence — exactly the
failure a single confirming pass cannot catch. Had I accepted round 1, a real false
negative would have shipped to 85 projects behind a test that looked like it
covered the case.

Note also that the gate found a defect in **my own** code via a finding I authored
to test it. The finding was originally a probe, not a belief.

## Limits

- The gate is prose, not a hook: nothing forces it to run. Consistent with the
  soft-gate philosophy, but it means an impatient session can skip it.
- Two rounds catch disagreement, not shared blind spots — both sub-agents read the
  same code with the same tools and could miss the same thing.
- Trigger patterns are heuristics; a false positive outside all five categories
  proceeds unchallenged.
- Round 2's reproduction was verified by hand here. A session that trusts the
  sub-agent's claim without re-running it inherits the sub-agent's error.
