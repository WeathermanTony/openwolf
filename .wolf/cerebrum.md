# Cerebrum

> Wolfpack/OpenWolf project learning memory.
> Last updated: 2026-07-12

## User Preferences

- Present this enhanced workflow as **Wolfpack**, not vanilla OpenWolf; keep `.wolf/`, `openwolf`, and `openwolf.*` as compatibility/runtime namespaces unless intentionally migrated.
- Do not initialize or use OpenWolf inside AI plugin staging/runtime directories; keep plugin stages minimal and isolated to avoid nested hooks, token waste, daemon confusion, and contaminated model comparisons.
- User runs `openwolf init` before every session; if that command copies from this local fork, future initialized projects receive the fork's current template/runtime behavior.
- User wants Wolfpack to improve AI git/version discipline: nudge agents to inspect/report git state, avoid broad staging, distinguish pre-existing changes, and consider version/changelog/document revision impacts.

## Key Learnings

- **Project:** customopenwolf.
- `/home/tony/projects/customopenwolf` and `/mnt/j/projectshome/projects/customopenwolf` are the same physical J: drvfs repo; treat them as one git history.
- The fork has a source/runtime/template split: `src/` and source templates drive durable changes, `.wolf/` is the installed runtime payload, and scaffold templates must remain generic.
- Scientific Mode became default-enabled Claim Calibration: a compact Stop-hook reasoning gate using observation/inference/limit/falsifier framing, with legacy `openwolf.scientific_mode` compatibility during migration.
- Runtime/template changes usually need three-layer sync: source, installed `.wolf/`, and templates/update payloads. Hook behavior often spans `src/hooks/*`, `.wolf/hooks/*`, `templates/wolf/hooks/*`, shared utilities, and config copies.
- Existing-project `openwolf update` must copy helper scripts and sibling `.wolf/utils/*.js` dependencies, not only hook entrypoints.
- Review gate lifecycle: pending review entries must be completed with `complete-review.js` or `wolfpack review complete`, never by manual JSON edits, so content hashes and reviewer provenance are verified.
- Reviewer recommendations are profile-driven and project-local: `gov/us-only` suppresses non-US/open-profile models; `open` can advertise broader plugins; `budget` should prefer plentiful-token GLM/Kimi/MiMo/MiniMax before escalating.
- Wolfpack review prompts select policy and explicit current files; standardized provider companions own `review --file` staging, subprocesses, redaction, hashing, cleanup, and transport. Companion receipt hashes are not Wolfpack manifest hashes, so stale reviews require refresh, actual current-byte re-review, then `--reviewed-current`.
- Operational evidence defaults to the provider-neutral `/ops:live-debug` and `/ops:deploy-verify` skills. Health and functional probes remain independent, and Wolfpack must not duplicate their collectors.
- Open-profile redteam diversity should include GLM, MiMo, MiniMax when available; GLM-5.2 is a high-value finder/grader candidate, Kimi is useful as an independent contrast grader, and MiMo/MiniMax are good cheap diverse finders.
- DeepSeek and Qwen reviewer plugins are available as non-US open-profile options, but budget guidance should not prefer them because their tokens are not as plentiful.
- Version durable OpenWolf changes by incrementing the custom prerelease suffix and keeping `package.json`, `package-lock.json`, and `VERSION` synchronized.
- Git/version discipline is now a Stop-hook gate: command-level safety nudges (broad staging, destructive Git, commit without cached diff) are always eligible, while status/version footers are materiality-gated to avoid nagging on mini edits.
- PM2 daemon liveness requires `status: "online"` plus a positive integer `pid`; stopped or pid-less PM2 rows are stale and should not count as active daemons.
- Daemon startup/heartbeat paths must refuse missing project/runtime directories and avoid recreating manually deleted project roots by writing `.wolf` state during shutdown.
- Redteam plugin files live outside this repo at `~/.claude/plugins/marketplaces/tony-local/plugins/redteam/`; QA reductions for external edits made from this repo still belong in this project's `.wolf/qa`.
- Wolfpack's coding-quality controls are hook-based and do not require PM2; the dashboard, cron scheduler, heartbeat, and live broadcasts are optional background services.

## Do-Not-Repeat

- [2026-06-13] Do not instruct assistants to manually mark reviewlog entries completed; use `node .wolf/hooks/complete-review.js review-NNNN --reviewer <name> --summary "<outcome>"` so hashes are refreshed and review nudges coalesce.
- [2026-06-13] Never use synchronous busy-wait loops in OpenWolf hooks/runtime code. Daemon start/init paths must be idempotent against PM2 state, and port allocation must test the same wildcard bind mode the daemon uses.
- [2026-06-16] After editing TypeScript hook sources, verify and synchronize compiled/runtime JS copies before claiming hook behavior changed.
- [2026-06-17] Review completion supersede must be based on each pending file's current hash being covered by completed reviews, not file-set subset/superset containment.
- [2026-06-17] Quality-gate reductions belong to the edited file's nearest `.wolf/qa` in cross-project sessions, and language-specific test files should not become source reduction obligations.
- [2026-06-17] When a falsifier crosses a process, shell, network, file, or tool boundary, test the receiving context rather than grepping producer source; presence is not correctness.
- [2026-06-19] To verify another project has the latest fork, check both the global `openwolf` symlink target and the project `.wolf/hooks/stop.js` / `complete-review.js` markers.
- [2026-06-20] Never sync self-hosted `.wolf/cerebrum.md` or `.wolf/anatomy.md` into `src/templates/` or `templates/wolf/`; templates must stay generic.
- [2026-06-21] Stop-hook nudges should use Claude Code's JSON stdout contract with `decision: "block"` and exit 0; do not use stderr + exit 2 for normal Wolfpack feedback.
- [2026-07-06] Prefer reviewer-saw-this-hash receipts over manual assertions. `complete-review.js --reviewed-hash <manifest>` and `wolfpack review hash/complete` are the safe path; keep `--reviewed-current` only as fallback.
- [2026-07-14] Falsifiers for path-scoped gates must run outside excluded scratch paths such as `/tmp/**`; otherwise a missing nudge may prove only that the exclusion worked, not that the gate failed.
- [2026-07-14] Regexes that target literal `.` or `:/` pathspecs must not end with `\b`; use a separator lookahead such as `(?=\s|$|;|&|\|)` or destructive Git forms like `git checkout -- .` silently miss.
- [2026-07-18] Git-init nudge for non-git repos must bypass the materiality gate (min_written_files, min_changed_lines, material_paths) because scope_excludes like `/tmp/**` can filter all writes and make `material=false` even when legitimate work was done. Use `hasAnyWrites` (unfiltered) to decide.
- [2026-07-18] Simplicity nudge added: fires at 500+ output tokens, max 1/session, reminding assistant to check YAGNI, readability, and efficiency. Configurable via `openwolf.simplicity`.
- [2026-07-18] `tryConsumeNudgeSlot(capN=0)` must mean "unlimited" (no cap), not "zero allowed". The `??` operator already distinguishes `0` from `undefined`, but the slot consumer itself must short-circuit `capN === 0` before `prior >= capN` to avoid blocking all nudges when a user explicitly sets `max_fires_per_session: 0`.
- [2026-07-18] PM2 daemon ownership must require all three signals: an `openwolf-` process name, the `wolf-daemon.js` executable, and a matching absolute project root/cwd. An environment variable alone is not safe deletion proof.
- [2026-07-18] Keep Wolfpack PM2 daemons and the dashboard disabled by default. Explicit dashboard startup must use managed PM2 lifecycle and HTTP health identity, never an unmanaged detached child or a bare TCP-port readiness check.
- [2026-07-18] Project identity plus healthy status does not prove dashboard readiness: a background-only daemon exposes health while intentionally omitting UI routes. Health/readiness must also report and require `dashboard_enabled: true` before `openwolf dashboard` takes its reuse fast path.

## Decision Log

- 2026-06-09: Use canonical config `openwolf.claim_calibration` and log type `claim_calibration`; keep legacy `openwolf.scientific_mode` config and `scientific_mode` log suppression compatibility during migration.
- 2026-07-18: Simplicity nudge uses output-token threshold (not line count) because tokens are already tracked in session ledger; no new instrumentation needed. Default 500 tokens ≈ ~30 lines of code.