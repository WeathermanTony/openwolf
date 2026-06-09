# customopenwolf

Custom OpenWolf fork and self-hosting Claude Code context-management scaffold.

This repository preserves the currently installed OpenWolf runtime payload while adding a source/template layout for ongoing development.

## Layout

- `CLAUDE.md` — project-level Claude Code instructions that load OpenWolf.
- `.claude/` — installed Claude Code settings and rules for this self-hosting repo.
- `.wolf/` — installed OpenWolf runtime payload used by Claude Code hooks.
- `src/` — source-of-truth copies of reusable OpenWolf hook and utility code.
- `templates/` — source-of-truth install templates for future OpenWolf targets.
- `scripts/` — repository verification and maintenance scripts.

## Runtime vs source

Claude Code currently executes hooks from `.wolf/hooks/*.js` through `.claude/settings.json`. Keep that installed runtime layer in place so this repo works immediately after clone. Develop reusable code in `src/`, then sync/install it back into `.wolf/` when the sync tooling is ready.

Runtime files such as logs, ledgers, session state, design captures, and generated QA reductions are intentionally ignored by git.

## Version

Current baseline: `0.1.0-custom.0`.

## Verification

```bash
npm run verify
```

The verification script checks the installed OpenWolf scaffold, hook syntax, JSON validity, and git ignore expectations.
