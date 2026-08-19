---
target: <relative path to the file this reduction is about>
target-hash: <sha256 of the target file — `sha256sum <file> | awk '{print $1}'`>
created: YYYY-MM-DD
experiment: <optional `.wolf/experiments/<id>.json` link>
reproduction_command: <one-liner someone else can run to reproduce the falsifier, e.g. `node --test tests/foo.test.js`>
evidence_source: <executed now | supplied | mixed — see "Evidence source" below>
---

# <short title>

## What the code claims to do

One paragraph in plain language. What's the intent — not the implementation.

## Assumptions (≥3)

Be **specific**. "Input is well-formed" doesn't count; "input is a UTF-8 byte string whose length is ≤4096" does.

1. **<short name>** — concrete statement of what must be true for the code to be correct.
2. **<short name>** — …
3. **<short name>** — …

## Pick the riskiest assumption

Which one would silently break the most things if it were wrong? Why is that one the riskiest? (Often: the assumption you'd *least* like to be asked about.)

## Falsification test

A small, **runnable** test designed to *try to break* the riskiest assumption — not to confirm the happy path. Adversarial inputs preferred (boundary cases, empty/oversized, malformed, concurrent, etc.).

If the value crosses a process, shell, network, file, or tool boundary, run the falsifier in the **receiving context**, not just against the source text. Presence is not correctness: `grep` can prove a string exists while missing that the shell, child process, browser, daemon, or remote API receives an empty or different value.

```bash
# command(s) to run the test
```

or

```python
# inline test snippet
```

## Evidence source

State plainly where the output below came from:

- **executed now** — you ran the command in this session and pasted its real output.
- **supplied** — the output came from a prior session, another agent, a CI log, or the user. Say which.
- **mixed** — name which parts are which.

Never present supplied evidence as if it were executed now. A build that passes is
evidence that the build passes; it is not proof of user-visible behavior. If the
claim is about behavior, the falsifier must exercise the behavior.

## Expected / Actual

Write these as observations, not as a diagnosis. State what you expected and what
actually happened; keep the suspected cause out of both. A reproduction is the
deliverable here — diagnosis and repair are separate steps, and folding a guess
into the "Actual" line quietly narrows the search to that guess.

- **Expected:** …
- **Actual:** …

## Run output

Paste the **actual** output here. Not a description of what should happen — what did happen. The `reproduction_command` in the frontmatter should be the exact command that produced this output, so a future session can re-run it without reverse-engineering the reduction.

```
<paste real output>
```

## Verdict

- [ ] Assumption survived the test. Note any caveats.
- [ ] Assumption falsified. Describe what broke and link the fix commit/diff.

## Anti-rationalization

These are the arguments that end reductions early. If you catch yourself making
one, the response is mandatory, not optional.

| If you think… | Mandatory response |
|---|---|
| "Nothing broke on the first pass" | A single happy-path run is not coverage. Name what you did *not* exercise before concluding clean. |
| "This looks fine, deep analysis isn't worth it" | "Looks fine" is not evidence. Evidence is a run output, a code trace, or a failing control. |
| "The test passed, so the assumption holds" | A passing test proves only what it exercises. Disconnect the thing it pins and confirm it goes red — otherwise you cannot tell a real pass from a vacuous one. |
| "This edge case is unlikely in practice" | Say so explicitly with the reasoning, and record it as a limit. Unstated likelihood judgements are invisible to the next session. |
| "That finding is a false positive" | Record it with the rationale rather than dropping it silently. A dismissal you cannot later justify is indistinguishable from ignoring it. |
| "This is out of scope" | State why, and name the boundary you are appealing to. |
| "No assumptions worth listing here" | Write "No gap identified — rationale: [X]" explicitly. Silence is not assurance. |

## Follow-ups

If this reduction surfaced a class-of-bug worth remembering across sessions, add a Do-Not-Repeat entry to `.wolf/cerebrum.md` referencing this file.
