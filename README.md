# Wolfpack

Wolfpack is a heavily customized Claude Code workflow harness built on the OpenWolf runtime namespace.

It is not vanilla OpenWolf. This fork layers project memory, anatomy-guided navigation, bug learning, review gates, adversarial QA reductions, redteam workflows, daemon/dashboard support, and autonomy-continuation nudges into one local workflow system.

## Compatibility model

Wolfpack keeps the existing OpenWolf compatibility surfaces so current projects continue to work:

- `openwolf` CLI remains supported.
- `wolfpack` is an alias for the same CLI.
- `.wolf/` remains the runtime/state directory.
- `openwolf.*` config keys remain the runtime namespace.

User-facing docs and CLI output should say **Wolfpack** when describing this enhanced workflow, and reserve **OpenWolf** for compatibility/runtime internals.

## Layout

- `CLAUDE.md` — project-level Claude Code instructions that load Wolfpack.
- `.claude/` — installed Claude Code settings and rules for this self-hosting repo.
- `.wolf/` — installed compatibility runtime payload used by Claude Code hooks.
- `src/` — source-of-truth copies of reusable hook, CLI, dashboard, and utility code.
- `templates/` — source-of-truth install templates for future Wolfpack targets.
- `scripts/` — repository verification and maintenance scripts.

## Runtime vs source

Claude Code currently executes hooks from `.wolf/hooks/*.js` through `.claude/settings.json`. Keep that installed runtime layer in place so this repo works immediately after clone. Develop reusable code in `src/`, then sync/install it back into `.wolf/` and templates when changing installed behavior.

Runtime files such as logs, ledgers, session state, design captures, and generated QA reductions are intentionally ignored by git.

## Version

Current baseline: `1.2.0-custom.1`.

## Verification

```bash
npm run verify
```

The verification script checks the installed Wolfpack/OpenWolf compatibility scaffold, hook syntax, JSON validity, and git ignore expectations.
