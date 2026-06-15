# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-06-13T23:19:34.880Z
> Files: 62 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../home/tony/.claude/plans/

- `silly-herding-cake.md` — Plan: Bootstrap `customopenwolf` as the canonical custom OpenWolf fork (~1500 tok)
- `unified-kindling-rose.md` — Plan: Generalize review support and fix recurring buglog false-positive nudges (~1421 tok)

## ./

- `.editorconfig` (~51 tok)
- `.gitignore` — Git ignore rules (~252 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `package.json` — Node.js package manifest (~102 tok)
- `README.md` — Project documentation (~341 tok)
- `VERSION` (~4 tok)

## .claude/

- `settings.json` (~508 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## .wolf/

- `buglog.json` — structured bug history for known fixes and recurring issues (~2 tok)
- `cerebrum.md` — project learning memory, user preferences, do-not-repeat, decisions (~68 tok)
- `config.json` — OpenWolf configuration including quality gate settings (~216 tok)
- `cron-manifest.json` — OpenWolf scheduled task manifest (~2 tok)
- `cron-state.json` — OpenWolf scheduled task runtime state (~2 tok)
- `identity.md` — OpenWolf project identity metadata (~79 tok)
- `memory.md` — chronological session/action log (~50 tok)
- `reviewlog.json` — structured review history (~2 tok)
- `suggestions.json` — OpenWolf suggestion storage (~2 tok)
- `token-ledger.json` — OpenWolf token tracking ledger (~2 tok)

## .wolf/hooks/

- `_session.json` — hook session state (~253 tok)
- `complete-review.js` — Completes pending reviewlog entries after verifying stored content_hashes still match current reviewed files (~1300 tok)
- `package.json` — Node package metadata for OpenWolf hooks (~90 tok)
- `post-read.js` — hook run after reads (~632 tok)
- `post-write.js` — hook run after writes (~803 tok)
- `pre-read.js` — hook run before reads (~867 tok)

## .wolf/qa/

- `_gate-log.json` — quality gate event log (~455 tok)
- `_README.md` — quality gate README (~330 tok)
- `_template.md` — adversarial reduction template (~235 tok)
- `review-buglog-suppression.md` — QA reduction for review nudge and buglog false-positive acknowledgement suppression (~650 tok)
- `autonomy-continuation.md` — QA reduction for Stop-hook autonomy continuation reminder (~650 tok)

## .wolf/utils/

- `paths.js` — OpenWolf path helpers (~298 tok)
- `platform.js` — platform detection helper (~247 tok)
- `port-allocator.js` — deterministic port allocation helper (~824 tok)

## scripts/

- `verify-install.js` — root: rel, fileExists, parseJson + 4 more (~1974 tok)

## src/config/

- `default-config.json` — default OpenWolf configuration copied from installed `.wolf/config.json` (~216 tok)

## src/hooks/

- `complete-review.js` — Source copy of review completion helper; verifies pending content_hashes before marking reviews completed (~1300 tok)
- `post-read.js` — source copy of hook run after reads (~632 tok)
- `post-write.js` — source copy of hook run after writes (~803 tok)
- `pre-read.js` — source copy of hook run before reads (~867 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~15020 tok)
- `stop.js` — Atomically claim a per-session nudge slot for the given counter field. (~20750 tok)

## src/utils/

- `paths.js` — source copy of OpenWolf path helpers (~298 tok)
- `platform.js` — source copy of platform detection helper (~247 tok)
- `port-allocator.js` — source copy of deterministic port allocation helper (~824 tok)
- `size-discipline.js` — size-discipline.ts (~10030 tok)

## templates/claude/

- `settings.json` — install template for Claude Code hooks (~508 tok)

## templates/claude/rules/

- `openwolf.md` — install template for OpenWolf Claude Code rules (~313 tok)

## templates/wolf/

- `config.json` — install template for OpenWolf configuration (~216 tok)
- `identity.md` — install template for OpenWolf project identity (~79 tok)
- `memory.md` — Memory (~65 tok)

## templates/wolf/hooks/

- `complete-review.js` — Template copy of review completion helper for installed OpenWolf projects (~1300 tok)
- `package.json` — install template for hook package metadata (~90 tok)
- `post-read.js` — install template hook run after reads (~632 tok)
- `post-write.js` — install template hook run after writes (~803 tok)
- `pre-read.js` — install template hook run before reads (~867 tok)

## templates/wolf/qa/

- `_README.md` — install template quality gate README (~330 tok)
- `_template.md` — install template adversarial reduction template (~235 tok)

## templates/wolf/utils/

- `paths.js` — install template OpenWolf path helpers (~298 tok)
- `platform.js` — install template platform detection helper (~247 tok)
- `port-allocator.js` — install template deterministic port allocation helper (~824 tok)
- `size-discipline.js` — size-discipline.ts (~10030 tok)

## tests/

- `review-completion.test.js` — Exports feature (~3242 tok)
