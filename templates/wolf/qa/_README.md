# Quality Gate — Adversarial Reductions

This directory holds **adversarial reductions** for code in this project. The Stop hook nudges (soft mode, never blocks) when an edited source file lacks a current reduction here.

## What's a reduction

A short markdown document that:

1. Names **≥3 concrete assumptions** the code is making (specific shape, type, range, invariant — not "input is valid").
2. Reduces one of those assumptions to a runnable test that would *falsify* it if wrong.
3. Pastes the **actual output** of running that test.

The point isn't to add another doc layer. It's to force the author (you or the AI) to name the assumptions out loud and put one of them on trial. Most "the code looks right" claims survive only because nothing has actually tested the underlying mental model.

## Naming convention

`<short-slug>.md` — e.g. `parser-stripchars.md`, `auth-token-rotation.md`. Slugs are arbitrary; the gate finds reductions by the `target-hash` frontmatter, not by filename.

Files starting with `_` (this README, `_template.md`, `_gate-log.json`) are skipped by the scanner.

## Frontmatter (required)

```yaml
---
target: src/path/to/file.ext
target-hash: <sha256 of the file at reduction time>
created: YYYY-MM-DD
---
```

`target-hash` is what the gate matches against. When the target file changes meaningfully, the hash drifts and the reduction goes stale — the gate will nudge for a fresh one. Compute it with:

```bash
sha256sum src/path/to/file.ext | awk '{print $1}'
```

## Workflow

1. Edit a code file.
2. Before claiming the task complete, copy `_template.md` to `<slug>.md`.
3. Fill in the three sections. Run the test. Paste the output.
4. Stop. The hook will check; if your reduction is current, it stays quiet.

## Tuning

`.wolf/config.json` → `openwolf.quality_gate`:

- `scope: "all" | "paths" | "none"` — narrow with `scope_paths` globs if "all" is too noisy.
- `min_assumptions` (default 3) — the gate doesn't enforce this count, but the template asks for it.
- `require_run_output` (default true) — same: cultural enforcement, not byte-level.
- `nudge_only: true` — soft mode (current). The gate logs and nudges via stderr; it never blocks Stop.
- `retention_days` (default 30) — `_gate-log.json` is trimmed into `.wolf/archive/`.

Disable entirely with `enabled: false`. The default is on because shipping code with unexamined assumptions is the most common failure mode this protocol exists to prevent.
