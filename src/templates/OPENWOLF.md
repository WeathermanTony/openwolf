# WolfPack Reference

WolfPack is a Claude Code quality harness using the `.wolf` compatibility namespace. This file is an on-demand reference; it is not a per-session instruction file.

## Operating contract

- `.wolf/config.json` controls behavior (`quiet` or `standard`) and reviewer policy (`open`, `us-only`/`gov`, or `budget`). Do not conflate them.
- The parent session owns shared ledgers, review coordination, QA consolidation, and final dispositions. Delegated agents return evidence; they do not independently close shared obligations.
- Consult `.wolf/cerebrum.md` before material code generation when it contains project conventions or corrections. Consult `.wolf/buglog.json` before repeating bug work.
- Search ledgers by symptom rather than reading them whole; aged entries rotate to `.wolf/archive/` automatically.
- Close a fixed bug with `openwolf bug close <id> --commit <sha> --reduction <path>`, never by hand.
- Hooks maintain routine session, anatomy, write, review, and QA state. Do not duplicate automatic bookkeeping manually.
- Never edit `.wolf/reviewlog.json` to claim completion. Use `openwolf review`, `openwolf qa`, and the installed completion helpers so evidence is checked against current bytes.
- Changed bytes invalidate stale review claims. Refresh the evidence or explicitly record a current-byte disposition.
- A missing test, failed transport, skipped check, or unavailable reviewer is not a passing verdict. Report observed evidence, limitations, and a concrete falsifier honestly.

## Commands and detailed guidance

Use `openwolf --help` and `openwolf <command> --help` for current command syntax. Specialized procedures live in installed Claude skills and these project references:

- QA: `.wolf/qa/_README.md` and the `quality-reduction` skill
- UI framework migration: `.wolf/reframe-frameworks.md`
- Review receipts: `openwolf review --help`
- Status and policy: `openwolf status`
- Backups and restore: `openwolf restore`
