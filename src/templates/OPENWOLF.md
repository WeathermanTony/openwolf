# OpenWolf Operating Protocol

You are working in an OpenWolf-managed project. These rules apply every turn.

## File Navigation

1. Check `.wolf/anatomy.md` BEFORE reading any file. It has a 2-3 line description and token estimate for every file in the project.
2. If the description in anatomy.md is sufficient for your task, do NOT read the full file.
3. If a file is not in anatomy.md, search with Grep/Glob, then update anatomy.md with the new entry.

## Code Generation

1. Before generating code, read `.wolf/cerebrum.md` and respect every entry.
2. Check the `## Do-Not-Repeat` section — these are past mistakes that must not recur.
3. Follow all conventions in `## Key Learnings` and `## User Preferences`.

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

## After Actions

1. After every significant action, append a one-line entry to `.wolf/memory.md`:
   `| HH:MM | description | file(s) | outcome | ~tokens |`
2. After creating, deleting, or renaming files: update `.wolf/anatomy.md`.

## Cerebrum Learning (MANDATORY — every session)

OpenWolf's value comes from learning across sessions. You MUST update `.wolf/cerebrum.md` whenever you learn something useful. This is not optional.

**Update `## User Preferences` when the user:**
- Corrects your approach ("no, do it this way instead")
- Expresses a style preference (naming, structure, formatting)
- Shows a preferred workflow or tool choice
- Rejects a suggestion — record what they preferred instead
- Asks for more/less detail, verbosity, explanation

**Update `## Key Learnings` when you discover:**
- A project convention not obvious from the code (e.g., "tests go in __tests__/ not test/")
- A framework-specific pattern this project uses
- An API behavior that surprised you
- A dependency quirk or version constraint
- How modules connect or data flows through the system

**Update `## Do-Not-Repeat` (with date) when:**
- The user corrects a mistake you made
- You try something that fails and find the right approach
- You discover a gotcha that would trip up a fresh session

**Update `## Decision Log` when:**
- A significant architectural or technical choice is made
- The user explains why they chose approach A over B
- A trade-off is explicitly discussed

**The bar is LOW.** If in doubt, add it. A cerebrum entry that's slightly redundant costs nothing. A missing entry means the next session repeats the same discovery process.

## Bug Logging (MANDATORY)

**Log a bug to `.wolf/buglog.json` whenever ANY of these happen:**
- The user reports an error, bug, or problem
- A test fails or a command produces an error
- You fix something that was broken
- You edit a file more than twice to get it right
- An import, module, or dependency is missing or wrong
- A runtime error, type error, or syntax error occurs
- A build or lint command fails
- A feature doesn't work as expected
- You change error handling, try/catch blocks, or validation logic
- The user says something "doesn't work", "is broken", or "shows wrong X"

**Before fixing:** Read `.wolf/buglog.json` first — the fix may already be known.

**After fixing:** ALWAYS append to `.wolf/buglog.json` with this structure:
```json
{
  "id": "bug-NNN",
  "timestamp": "ISO date",
  "error_message": "exact error or user complaint",
  "file": "file that was fixed",
  "root_cause": "why it broke",
  "fix": "what you changed to fix it",
  "tags": ["relevant", "keywords"],
  "related_bugs": [],
  "occurrences": 1,
  "last_seen": "ISO date",
  "commit": null,
  "reduction": ".wolf/qa/<proof>.md or command/test transcript"
}
```

**The threshold is LOW.** When in doubt, log it. A false positive in the bug log costs nothing. A missed bug means repeating the same mistake later.


## Claim Calibration

OpenWolf includes a default reasoning gate for strong claims. When an assistant makes causal, broad, confidence-heavy, methodology, or debugging conclusions without enough calibration, the Stop hook may ask for a compact patch:

```text
Observed:
Inferred:
Limit:
Falsifier:
```

This is not a QA reduction and should stay short. The goal is to separate direct evidence from inference, state scope/limits, and name what would lower confidence without adding token-heavy process.

## Quality Gate (MANDATORY for code edits)

The quality gate exists because AI-written code routinely ships with **unexamined assumptions** that invalidate the result — silently. Tests don't catch this (we usually test the same wrong model). A run-output falsification *does*.

**Scope (default `all`):** every edited source-code file is in scope (`.go .py .ts .tsx .js .jsx .mjs .rs .c .cc .cpp .h .hpp .java .rb .php .swift .scala .sh .sql`), with `.wolf/`, `node_modules/`, `.git/`, build/dist dirs, test dirs, and `*.test.*`/`*.spec.*` files excluded. Switch `openwolf.quality_gate.scope` to `"paths"` and populate `scope_paths` to scope narrower.

**For every in-scope code file you meaningfully change, write an adversarial reduction to `.wolf/qa/<short-slug>.md`** using `_template.md` as the skeleton. The reduction must:

1. **Name ≥3 concrete assumptions** the code is making (default `min_assumptions: 3`). Vague claims like "input is valid" don't count — write the specific shape, type, range, or invariant.
2. **Reduce one assumption to a runnable test** that would *falsify* it if wrong, and **paste the actual run output** (default `require_run_output: true`).
3. **Set frontmatter `target-hash: <sha256 of the file at reduction time>`** so the gate knows the reduction is current for this version of the code.

**Soft mode (default):** the Stop hook nudges via stderr when an edited code file lacks a current reduction; it never blocks. The nudge enters the next-turn context so you see it and can respond. Each decision is logged to `.wolf/qa/_gate-log.json` (retention-trimmed into `.wolf/archive/`).

**Cerebrum feedback loop:** when a reduction reveals a class of assumption-bug you'd otherwise have repeated (off-by-one in a date window, silent truncation, a vendored library defaulting differently than docs claim), add a Do-Not-Repeat entry citing the reduction file. The gate's value compounds only if its findings reach future sessions.

**Every conclusion gets tested twice.** A second sub-gate (`verify_conclusions`) scans your last text turn for conclusion language — "verdict", "the answer is", "confirmed", t-stats, p-values, "works/fails", "survivor", "ready to ship". When ≥2 distinct patterns hit and no fresh reduction was written this session, the gate nudges. Before stating a conclusion as final:

1. Name ≥3 concrete assumptions the conclusion depends on (in-sample fit? multiple testing? cost model?)
2. Pick the riskiest. Write a test designed to *falsify* it, not confirm it.
3. Run the test. Paste the actual output into `.wolf/qa/<slug>.md`.
4. Then — and only then — restate the conclusion.

"It works" is not a conclusion. "It survived <specific test> with <actual output>" is.

**Stop hook exits 2 when a nudge fires — this is the autonomy mechanism.** Exit 2 on a Stop hook blocks the turn from ending and feeds the stderr message back into the model's next iteration, so the gate runs the loop *for* you instead of waiting for the user to type "continue". When you see a nudge in stderr, the turn has NOT ended — your next action should be to address the nudge directly (write the reduction, falsify the assumption, paste the run output), then yield. Do not re-emit the same conclusion language without first addressing the gate, or it will fire again and the loop will not converge.

The escape hatch: if a nudge is a false positive (the "conclusion" was actually a summary or recap, not a new claim), say so explicitly in one sentence, then yield. The gate logs the decision but won't re-fire on the same text.

Skip the gate by setting `openwolf.quality_gate.enabled: false` in `.wolf/config.json` — but the default is on for a reason.

## Token Discipline

- Never re-read a file already read this session unless it was modified since.
- Prefer anatomy.md descriptions over full file reads when possible.
- Prefer targeted Grep over full file reads when searching for specific code.
- If appending to a file, do not read the entire file first.

## Design QC

When the user asks you to check, evaluate, or improve the design/UI of their app:

1. Run `openwolf designqc` via Bash to capture screenshots.
   - The command auto-detects a running dev server, or starts one from package.json if needed
   - Use `--url <url>` only if auto-detection fails
   - The command saves compressed JPEG screenshots to `.wolf/designqc-captures/`
   - Full pages are captured as sectioned viewport-height images (top, section2, ..., bottom)
2. Read the captured screenshot images from `.wolf/designqc-captures/` using the Read tool.
3. Evaluate the design against modern standards (Shadcn UI, Tailwind, clean React patterns):
   - Spacing and whitespace consistency
   - Typography hierarchy and readability
   - Color contrast and accessibility (WCAG)
   - Visual hierarchy and focal points
   - Component consistency
   - Whether the design looks "dull" or "white-coded" (generic, no personality)
4. Provide specific, actionable feedback with fix suggestions.
5. If the user approves, implement the fixes directly in their code.
6. After fixes, re-run `openwolf designqc` to capture new screenshots and verify improvement.

**Token awareness:** Each screenshot costs ~2500 tokens. The command compresses images (JPEG quality 70, max width 1200px) to minimize cost. For large apps, use `--routes / /specific-page` to limit captures.

## Reframe — UI Framework Selection

When the user asks to change, pick, migrate, or "reframe" their project's UI framework:

1. Read `.wolf/reframe-frameworks.md` for the full framework knowledge base.
2. Ask the user the decision questions from the file (current stack, priority, Tailwind usage, theme preference, app type). Stop early once the choice narrows to 1-2 options.
3. Present a recommendation with reasoning based on the comparison matrix.
4. Once the user confirms, use the selected framework's prompt from the file — **adapted to the actual project** using `.wolf/anatomy.md` for real file paths, routes, and components.
5. Execute the migration: install dependencies, update config, refactor components.
6. After migration, run `openwolf designqc` to verify the new look.

**Do NOT read the entire reframe-frameworks.md into context upfront.** Read the decision questions and comparison matrix first (~50 lines). Only read the specific framework's prompt section after the user chooses.



## Reviewer Profiles

Use `openwolf init --profile gov` for government or compliance-sensitive projects. This sets review nudges to advertise only US-based reviewers. Use `openwolf init --profile open` for unrestricted projects where broader installed reviewers such as GLM are acceptable. The profile controls OpenWolf's visible recommendations only; it does not enforce network, model, or account access.

## Review Gate Lifecycle

When the Stop hook creates a pending review in `.wolf/reviewlog.json`, do not mark it completed by editing JSON manually. After an independent reviewer approves the current bytes, run:

```bash
node .wolf/hooks/complete-review.js review-NNNN --reviewer <name> --summary "<outcome>"
```

The helper verifies the pending entry's `content_hashes` still match current files so repeated review nudges can coalesce safely. Practical rules:

1. **Review the bytes you will close.** If the independent reviewer finds an issue and you edit a reviewed file, that file now has a new hash; re-review the new bytes before completing the review.
2. **Pending reviews coalesce on Stop.** If a pending review already exists for the session, the Stop hook unions the file list and refreshes `content_hashes` for currently written files. This is intentional: the next nudge points at the latest bytes.
3. **A refused close is usually correct.** `reviewed file hashes changed or file set drifted` means the helper detected edits after the pending review was filed. Let the next Stop refresh/coalesce, re-review the current files, then run the helper again.
4. **Lock errors are transient.** `could not lock reviewlog.json` usually means the Stop hook and helper raced on the same file; rerun the helper after a moment.
5. **The file list can be broader than the new issue.** Coalescing unions files across the pending review window, and some files may already be covered by prior completed reviews at the same hash. Review the listed current files, but don't assume every listed path is newly suspicious.

Natural cadence: run the independent review; if it is clean, complete immediately. If it finds issues, fix them, allow the next Stop to refresh the pending hash set, re-review, then complete.

## Session End

Before ending or when asked to wrap up:

1. Write a session summary to `.wolf/memory.md`.
2. Review the session: did you learn anything? Did the user correct you? Did you fix a bug? If yes, update `.wolf/cerebrum.md` and/or `.wolf/buglog.json`.
