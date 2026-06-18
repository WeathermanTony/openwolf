# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-06-08

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

## Key Learnings

- **Project:** customopenwolf
- 2026-06-08: `/home/tony/projects/customopenwolf` and `/mnt/j/projectshome/projects/customopenwolf` resolve to the same physical tree on the J: drvfs mount; treat it as one repo and avoid separate git histories.
- 2026-06-08: The fork uses a source/runtime split: `.wolf/` remains the installed Claude Code runtime payload, while `src/` and `templates/` are the development source/template layers for future improvements.

- 2026-06-09: Scientific Mode is a concept-only, disabled-by-default Stop-hook extension that nudges AI reasoning methodology around evidence strength, rival explanations, falsification, scope, and calibrated confidence; do not copy or paraphrase source-book text.

- 2026-06-09: Scientific Mode was rolled into base OpenWolf as default-enabled Claim Calibration: a low-token reasoning gate that fires only on risky claims missing observation/inference/limit/falsifier markers.

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->
- [2026-06-13] Do not instruct assistants to manually mark reviewlog entries completed; use `node .wolf/hooks/complete-review.js review-NNNN --reviewer <name> --summary "<outcome>"` so `content_hashes` are refreshed and review nudges can coalesce.
- [2026-06-13] Never use synchronous busy-wait loops in OpenWolf hooks/runtime code, and daemon start/init paths must be idempotent against PM2 state. Port allocation must test the same wildcard bind mode the daemon uses, not just 127.0.0.1. See `.wolf/qa/daemon-cpu-pm2.md`.

- 2026-06-13: Review nudge provider wording and buglog false-positive suppression logic live in `src/hooks/stop.js` and must be kept synchronized to `.wolf/hooks/stop.js` and `templates/wolf/hooks/stop.js`.
- 2026-06-13: Autonomy continuation is a config-backed Stop-hook reminder (`openwolf.autonomy_continuation`) that nudges when the last assistant text implies a known next step or permission-seeking pause; keep `shared.js`, `stop.js`, and config copies synchronized across source/runtime/templates.
- 2026-06-14: Changes committed in this custom OpenWolf fork are live only for the current checked-out project/runtime; other OpenWolf-managed projects need the fork merged/installed/synced before their `.wolf/hooks/*` copies get the new behavior.
- 2026-06-14: Review nudge provider lists should avoid hardcoding fast-changing optional AI plugins; list stable built-ins/known companions and include generic guidance to inspect available slash commands/subagents for other installed reviewer plugins.
- 2026-06-14: User runs `openwolf init` before every session; if that init command copies from this local custom OpenWolf fork, future sessions/projects initialized that way will receive the fork's current template/runtime behavior.
- 2026-06-14: CLI payload changes must cover both fresh `openwolf init` and existing-project `openwolf update`; update must copy helper scripts such as `complete-review.js` plus sibling `.wolf/utils/*.js` dependencies, not just hook entrypoints.

- [2026-06-16] After editing TypeScript hook sources, verify and synchronize the compiled/runtime JS copies (`src/hooks/*.js`, `templates/wolf/hooks/*.js`, `.wolf/hooks/*.js`) before claiming the hook behavior changed; the QA falsification for review nudge lifecycle caught a stale JS copy.
- [2026-06-17] Review completion supersede must be based on each pending file's current hash being covered by completed reviews, not file-set subset/superset containment; see `.wolf/qa/review-completion-supersede.md`.
- [2026-06-17] Quality-gate reductions belong to the edited file's nearest `.wolf/qa` in cross-project sessions, and language-specific test files such as `_test.go` / `test_*.py` should not become source reduction obligations; see `.wolf/qa/quality-gate-cross-project.md`.
- [2026-06-17] When a falsifier crosses a process/shell/network/file/tool boundary, test the receiving context rather than grepping producer source; presence is not correctness. See `.wolf/qa/qa-template-receiving-context.md`.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
- 2026-06-09: Use canonical config `openwolf.claim_calibration` and log type `claim_calibration`; keep legacy `openwolf.scientific_mode` config and `scientific_mode` log suppression compatibility during migration.
- 2026-06-09: Scientific Mode MVP uses `openwolf.scientific_mode` config and logs `type: "scientific_mode"` entries in `.wolf/qa/_gate-log.json`; it skips if verify-conclusions already fired to avoid double-nudging.
