---
target: <relative path to the file this reduction is about>
target-hash: <sha256 of the target file — `sha256sum <file> | awk '{print $1}'`>
created: YYYY-MM-DD
reproduction_command: <one-liner someone else can run to reproduce the falsifier, e.g. `node --test tests/foo.test.js`>
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

## Run output

Paste the **actual** output here. Not a description of what should happen — what did happen. The `reproduction_command` in the frontmatter should be the exact command that produced this output, so a future session can re-run it without reverse-engineering the reduction.

```
<paste real output>
```

## Verdict

- [ ] Assumption survived the test. Note any caveats.
- [ ] Assumption falsified. Describe what broke and link the fix commit/diff.

## Follow-ups

If this reduction surfaced a class-of-bug worth remembering across sessions, add a Do-Not-Repeat entry to `.wolf/cerebrum.md` referencing this file.
