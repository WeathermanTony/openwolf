---
slug: drift-check-command
target: src/cli/drift-cmd.ts
target-hash: 6a987a74a7f90801718d5e99c131dc4e28a893b1c4f613a6c6e039c43156306c
reproduction_command: node --test tests/drift-cmd.test.js
date: 2026-08-19
---

# Adversarial reduction — `openwolf driftcheck`

Detects rot between docs/ledgers and the code they describe: anatomy entries vs
real files, CLI subcommands quoted in docs vs commands the CLI registers, and
parked-question markers vs ledger entries.

## Assumptions this code makes

1. **Anatomy section headings are project-root-relative** (`## src/cli/` + `index.ts`
   → `<root>/src/cli/index.ts`). If they were `.wolf`-relative, resolving against
   the project root would mark every real file missing.
2. **Every extracted entry is also checked** — `extracted == checked` always, so a
   reported coverage count cannot exceed what was actually examined.
3. **An entry that cannot be resolved is reported, not dropped.** Specifically, an
   entry appearing before any `##` heading has no section to join.
4. **Zero extractions from a non-empty source is a failure, not a pass** — the
   regex may have rotted against a changed anatomy format.
5. **Absent inputs SKIP rather than pass**: no `src/cli/index.ts` (installed
   projects ship no source) must not read as "no stale commands."
6. Subcommands are derived from CLI source, never hardcoded, so the check cannot
   rot in the same way it exists to detect.

## Falsification

Assumption 1 was the riskiest — it is the one I got wrong. The first
implementation resolved against `wolfDir`:

```
Wolfpack drift check
  anatomy   extracted=222 checked=222 findings=221
  DRIFT [anatomy-missing] package.json (.wolf/anatomy.md)
  DRIFT [anatomy-missing] src/cli/index.ts (.wolf/anatomy.md)
  ... 221 total
```

`src/cli/index.ts` demonstrably exists, so 221/222 were false positives. Base
corrected to the project root.

Assumption 3 was falsified by test, not by inspection — see the negative control
below. `if (!e || section === null) continue` dropped pre-heading entries before
incrementing `extracted`, shrinking the denominator invisibly.

### Negative controls (each disconnection must go red)

```
CONTROL 1 (anatomy entry for a nonexistent file)
  anatomy   extracted=223 checked=223 findings=1
  DRIFT [anatomy-missing] src/cli/phantom-nonexistent-file.ts
  exit=1

CONTROL 2 (entry regex disconnected: "- `" -> "* `")
  anatomy   extracted=0 checked=0 findings=0
  VACUOUS anatomy: 0 entries extracted from a non-empty anatomy.md
  exit=1

CONTROL 3 (doc cites a command the CLI does not register)
  commands  extracted=24 checked=13 findings=1
  DRIFT [command-missing] notarealcommand (.wolf/OPENWOLF.md)
  exit=1

BASELINE (clean) exit=0
```

Control 2 is the load-bearing one: a disconnected extractor produces **zero
findings**, which is precisely why it must exit nonzero. Exit codes were measured
directly — an earlier control run piped through `grep`, so `$?` reported grep's
status (0) rather than the command's, masking all three.

### Unit suite

```
$ node --test tests/drift-cmd.test.js
# tests 7
# pass 7
# fail 0
```

Test 5 ("entries appearing before any heading are not silently dropped") failed
on first run with `1 !== 2` — it found assumption 3's defect. Fixed by counting
before resolving and reporting unresolvable entries explicitly.

Full suite: 197/197 pass.

### Real-world runs after the fix

```
customopenwolf  anatomy extracted=222 checked=222 findings=0  exit=0
skillsbench     anatomy extracted=47  checked=47  findings=0  exit=0
                commands SKIPPED — CLI source not present
```

## Limits

- The anatomy check verifies **existence**, not description accuracy. An entry
  whose prose is stale but whose file exists passes. (Observed: `drift-cmd.ts`'s
  auto-generated description is a scraped code comment — wrong, and invisible here.)
- The command check matches the first token after `openwolf`/`wolfpack` inside
  backticks; unbackticked mentions are not seen.
- Coverage is scoped to files the walker reaches (depth 8, common source
  extensions, standard skip dirs).

## Round 2 — false positives found by spot-checking findings on disk

A finding COUNT is not evidence. Spot-checking the reported findings against the
filesystem exposed three further resolution defects, each of which had inflated
the count while looking like real drift:

| Defect | Symptom | Evidence |
|---|---|---|
| prose section headings | `## Top level` joined as a directory | `README.md` flagged missing while present at root |
| brace notation | `a_{x,y}.txt` treated as a literal name | 2 real files reported as 1 phantom |
| doubled prefix | `.wolf/qa/` + `.wolf/qa/x.md` | 150 of 411 findings on one project |

On the hand-written-anatomy project: 4 findings → **4/4 verified false**, now 0
after the fix, with extraction unchanged at 20/20. On mt5automation: 411 → 360
stale, of which 261 point outside the project (`/tmp`, `~/.claude/plans/`) — the
anatomy scanner indexes files beyond the project boundary, and those entries
outlive the files permanently.

The bold-format blindness (`- **name**` vs `` - `name` ``) was surfaced by the
vacuity guard rather than by a wrong answer: the project reported VACUOUS instead
of "0 missing, clean." That is the guard doing exactly its job.

## Round 3 — performance, and a measurement I invalidated twice

`driftcheck` walked every source file to depth 8 for parked-question markers even
with no ledger to correlate against: **39s** on one project, and 43 of 85 fleet
projects timed out. Fixed by skipping the walk when no ledger exists, with SKIP
text that names what went unscanned:

```
parked  SKIPPED — no parked-questions ledger — code not scanned for orphan TODO(UQ-n) markers
```

39s → **3.7s**. The walk retains a 20000-file cap and a depth cap, both of which
now report `VACUOUS ... marker coverage is partial` instead of silently returning
a short list — verified by test, not assumed:

```
$ node --test tests/drift-cmd.test.js
# tests 15
# pass 15
# fail 0
```

**Methodology error worth recording:** two fleet scans produced *worsening*
results (43 → 50 → 74 parse errors) because I rebuilt `dist/` while the scans
were running, so in-flight child processes loaded a partially-written bundle. The
numbers were artifacts of my own edits, not fleet state. Fixed by running the
final scan against a frozen snapshot (`/tmp/owsnap`) that no rebuild can touch.
The `checked != registry.length` assertion is what made this visible at all — the
partial runs would otherwise have read as fleet-wide results.

## Limits (updated)

- Existence only, not description accuracy. An entry whose prose is stale but
  whose file exists passes. Observed directly: this command's own anatomy entry
  was an auto-scraped code comment, factually meaningless, and invisible here.
- The dual-base resolution (section-relative OR root-relative) is deliberately
  lenient; a paired test asserts it still fails for a file absent under both.
- Marker/ledger correlation does not run without a ledger. This is disclosed in
  the SKIP text, not hidden — but it does mean an orphan `TODO(UQ-n)` in a
  project that never created a ledger goes undetected.

## Fleet measurement (definitive run, frozen snapshot)

```
registry=85 checked=85 parseErrors=0 entries=14800 staleEntries=2096 projectsWithDrift=37 vacuous=0
  548/ 551  /mnt/s/MT5 Exness 1
  360/ 692  /mnt/j/projectshome/projects/mt5automation
  211/ 512  /mnt/j/projectshome/projects/cllmgit2
  167/ 539  /mnt/j/projectshome/projects/aiforwork
  144/ 280  /mnt/j/projectshome/projects/aiforwork/automatetasks
  143/ 677  /mnt/j/projectshome/projects/aistatistical
  127/ 501  /mnt/j/projectshome/projects/aiforwork/Archived/drplan2
   98/ 386  /mnt/j/projectshome/localprojects/downloadewbooks
   45/  49  /mnt/j/projectshome/localprojects/computertuning
   37/ 501  /mnt/j/projectshome/projects/aibootstrap
```

Full coverage, zero parse errors, zero vacuous extractions. **2096 of 14800
anatomy entries (14%) point at files that do not exist, across 37 of 85
projects.**

The top result was spot-checked before being reported, because a project at
99.5% stale is likelier to mean a broken resolver than a broken project.
Verified real: `/mnt/s/MT5 Exness 1` contains 7.2M files but only
`MetaTrader 5 EXNESS/` and `.wolf/` at top level — `CLAUDE.md` and the indexed
tree are genuinely gone, while the anatomy (last written 2026-07-20) still
describes them. 3 of 551 entries resolve.

**Scoping decision.** The brief offered three options (size threshold,
harness-repo-only, or accept silence) on the premise that a fleet-wide check
would be "silent in ~84 of 85 projects." That premise is false: 33 projects
carry 100+ anatomy entries, several triple this repo's, and 37 show real drift.
No scoping — the check runs everywhere.

### Negative control for the fleet harness itself

The aggregate is only trustworthy because it asserts its own denominator. Three
earlier runs of the same script reported partial results:

```
run 1:  WARN checked=42 of 85, parseErrors=43   (walk timeouts, pre-fix)
run 2:  WARN checked=35 of 85, parseErrors=50   (dist/ rebuilt mid-scan)
run 3:  WARN checked=11 of 85, parseErrors=74   (dist/ rebuilt mid-scan)
run 4:       checked=85 of 85, parseErrors=0    (frozen snapshot, post-fix)
```

Runs 2 and 3 were corrupted by my own rebuilds, not by fleet state. Without the
`checked === registry.length` assertion, run 1's "455 stale across 10 projects"
would have been reported as a fleet result while half the fleet went unexamined.
