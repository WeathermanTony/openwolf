# Memory

| 23:32 | Validated commit 8bda36b in a detached clean worktree and obtained a bounded current-byte companion review | src/cli/index.ts, src/cli/init.ts, src/cli/update.ts, tests/init-root-scope.test.js, tests/update-source-exclusion.test.js | 278/278, verify PASS, ChatGPT VERDICT CLEAN; GLM transport attempt produced no verdict | ~4k |
| 23:35 | Canaried 1.2.0-custom.26 on mt5_dgm_lite, then completed the authorized fleet rollout | 96 managed projects plus mt5 canary | canary protected 415/415; fleet updated 96, skipped canonical source checkout, 0 daemon starts | ~4k |
| 23:38 | Verified final fleet against actual producer bytes and rollout-time protected backups | 96 non-source roots | 1,920 managed, 96 settings/version, 1,056 protected preserved, 0 failures | ~3k |

| 23:20 | Reconciled hook-created bug-796 and allocated bug-797/798 with lock-backed mutation; audited ledgers | .wolf/buglog.json | bug/review IDs clean; reductions linked, commits pending | ~2k |
| 23:24 | Recorded staged canary/fleet evidence and generalized rollout lessons | .wolf/qa/fleet-rollout-1.2.0-custom.26.md, .wolf/cerebrum.md | actual producer paths, exact init root, and cross-worktree exclusion documented | ~3k |

> Chronological action log. Hooks and AI append to this file automatically.
> Old sessions are consolidated by the daemon weekly.

## Session: 2026-09-13 02:55

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|

## Session: 2026-09-13 02:56

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|

## Session: 2026-09-13 03:49

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|

## Session: 2026-09-13 03:49

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 04:14 | Edited src/cli/cron-cmd.ts | added 1 condition(s) | ~147 |
| 04:14 | Created tests/cron-result-truth.test.js | — | ~513 |
| 04:14 | Edited tests/cron-result-truth.test.js | inline fix | ~14 |
| 04:15 | Edited src/scanner/description-extractor.ts | added 2 condition(s) | ~202 |
| 04:15 | Edited src/scanner/anatomy-scanner.ts | inline fix | ~16 |
| 04:15 | Edited src/scanner/anatomy-scanner.ts | 2→2 lines | ~38 |
| 04:15 | Created src/scanner/exclusions.ts | — | ~838 |
| 04:16 | Edited src/scanner/anatomy-scanner.ts | added 1 import(s) | ~50 |
| 04:16 | Edited src/scanner/exclusions.ts | inline fix | ~9 |
| 04:16 | Edited src/scanner/anatomy-scanner.ts | modified walkDir() | ~51 |
| 04:16 | Edited src/scanner/anatomy-scanner.ts | added 2 condition(s) | ~93 |
| 04:16 | Edited src/scanner/anatomy-scanner.ts | inline fix | ~16 |
| 04:16 | Edited src/scanner/anatomy-scanner.ts | 8→10 lines | ~76 |
| 04:17 | Edited src/config/default-config.json | expanded (+14 lines) | ~90 |
| 04:17 | Edited src/templates/config.json | expanded (+14 lines) | ~90 |
| 04:17 | Edited templates/wolf/config.json | expanded (+14 lines) | ~90 |
| 04:17 | Edited src/hooks/shared.ts | added 1 import(s) | ~38 |
| 04:18 | Edited src/hooks/shared.ts | added error handling | ~539 |
| 04:18 | Edited src/hooks/pre-read.ts | inline fix | ~47 |
| 04:18 | Edited src/hooks/pre-read.ts | 3→1 lines | ~10 |
| 04:18 | Edited src/hooks/pre-read.ts | added nullish coalescing | ~700 |
| 04:19 | Edited src/hooks/post-read.ts | inline fix | ~52 |
| 04:19 | Edited src/hooks/post-read.ts | 3→1 lines | ~10 |
| 04:19 | Edited src/hooks/post-read.ts | 10→8 lines | ~132 |
| 04:19 | Edited src/hooks/post-read.ts | inline fix | ~15 |
| 04:19 | Edited src/hooks/post-read.ts | added nullish coalescing | ~139 |
| 04:19 | Edited src/hooks/session-start.ts | inline fix | ~42 |
| 04:19 | Edited src/hooks/session-start.ts | added error handling | ~139 |
| 04:20 | Edited src/hooks/session-start.ts | writeJSON() → mutateJSON() | ~148 |
| 04:20 | Edited src/hooks/shared.ts | modified catch() | ~107 |
| 04:20 | Edited src/hooks/session-start.ts | 3→4 lines | ~62 |
| 04:20 | Edited src/hooks/session-start.ts | added 1 condition(s) | ~76 |
| 04:20 | Edited src/hooks/session-start.ts | added 1 condition(s) | ~18 |
| 04:20 | Edited src/hooks/session-start.ts | added nullish coalescing | ~141 |
| 04:21 | Edited src/hooks/session-start.ts | inline fix | ~40 |
| 04:21 | Edited src/hooks/post-write.ts | inline fix | ~100 |
| 04:21 | Edited src/hooks/post-write.ts | 3→1 lines | ~21 |
| 04:21 | Edited src/hooks/post-write.ts | 1→2 lines | ~34 |
| 04:21 | Edited src/hooks/stop.ts | inline fix | ~36 |
| 04:21 | Edited src/hooks/stop.ts | removed 3 lines | ~8 |
| 04:21 | Edited src/hooks/stop.ts | 3→4 lines | ~50 |
| 04:22 | Edited src/hooks/stop.ts | inline fix | ~8 |
| 04:22 | Edited src/hooks/post-write.ts | inline fix | ~16 |
| 04:23 | Session end: 43 writes across 13 files (cron-cmd.ts, cron-result-truth.test.js, description-extractor.ts, anatomy-scanner.ts, exclusions.ts) | 25 reads | ~120721 tok |
| 04:24 | Created tests/scanner-hygiene.test.js | — | ~844 |
| 04:25 | Created tests/hook-state-safety.test.js | — | ~1166 |
| 04:25 | Edited src/cli/registry.ts | added 1 import(s) | ~32 |
| 04:25 | Edited src/cli/registry.ts | added error handling | ~385 |
| 04:25 | Edited src/cli/registry.ts | modified registerProject() | ~172 |
| 04:25 | Edited src/cli/registry.ts | modified unregisterProject() | ~70 |
| 04:25 | Edited src/cli/registry.ts | modified if() | ~93 |
| 04:26 | Created tests/registry-concurrency.test.js | — | ~674 |
| 04:26 | Edited src/daemon/cron-engine.ts | added 1 import(s) | ~37 |
| 04:26 | Edited src/daemon/cron-engine.ts | added error handling | ~347 |
| 04:27 | Edited src/daemon/cron-engine.ts | added 1 condition(s) | ~257 |
| 04:27 | Edited src/daemon/cron-engine.ts | 7→3 lines | ~37 |
| 04:27 | Edited src/cli/update.ts | added error handling | ~234 |
| 04:27 | Edited src/scanner/exclusions.ts | modified isVirtualenvDir() | ~82 |
| 04:27 | Edited src/cli/update.ts | added 1 import(s) | ~54 |
| 04:27 | Edited src/cli/update.ts | added optional chaining | ~104 |
| 04:28 | Edited src/cli/update.ts | inline fix | ~23 |
| 04:28 | Created tests/config-merge-safety.test.js | — | ~638 |
| 04:29 | Created tests/cron-state-concurrency.test.js | — | ~684 |
| 04:30 | Created tests/session-start-concurrency.test.js | — | ~672 |
| 04:31 | Edited src/hooks/session-start.ts | 5→5 lines | ~85 |
| 04:32 | Edited src/hooks/session-start.ts | added 1 condition(s) | ~137 |
| 04:33 | Edited src/hooks/shared.ts | added 1 condition(s) | ~100 |
| 04:33 | Edited src/hooks/shared.ts | modified catch() | ~69 |
| 04:33 | Edited src/hooks/shared.ts | modified if() | ~37 |
| 04:33 | Edited src/hooks/shared.ts | added 1 condition(s) | ~94 |
| 04:34 | Edited src/utils/size-discipline.ts | added nullish coalescing | ~109 |
| 04:34 | Edited src/utils/size-discipline.ts | added optional chaining | ~72 |
| 04:35 | Edited src/hooks/session-start.ts | added 1 condition(s) | ~109 |
| 04:35 | Edited src/hooks/shared.ts | modified mutateJSON() | ~33 |
| 04:36 | Edited src/hooks/shared.ts | 9→6 lines | ~40 |
| 04:36 | Edited src/hooks/shared.ts | 4→2 lines | ~20 |
| 04:36 | Edited src/hooks/shared.ts | 9→5 lines | ~49 |
| 04:36 | Edited src/utils/size-discipline.ts | removed 4 lines | ~11 |
| 04:36 | Edited src/utils/size-discipline.ts | modified catch() | ~40 |
| 04:36 | Edited tests/session-start-concurrency.test.js | expanded (+6 lines) | ~118 |
| 04:36 | Edited tests/session-start-concurrency.test.js | 3→5 lines | ~61 |
| 04:41 | Edited src/hooks/shared.ts | added nullish coalescing | ~462 |
| 04:41 | Edited src/hooks/pre-read.ts | inline fix | ~50 |
| 04:41 | Edited src/hooks/post-read.ts | inline fix | ~54 |
| 04:41 | Edited src/hooks/pre-write.ts | inline fix | ~32 |
| 04:41 | Edited src/hooks/post-write.ts | inline fix | ~103 |
| 04:41 | Edited src/hooks/session-start.ts | inline fix | ~45 |
| 04:41 | Edited src/hooks/pre-read.ts | inline fix | ~2 |
| 04:41 | Edited src/hooks/post-read.ts | inline fix | ~2 |
| 04:41 | Edited src/hooks/pre-write.ts | inline fix | ~2 |
| 04:41 | Edited src/hooks/post-write.ts | inline fix | ~2 |
| 04:41 | Edited src/hooks/session-start.ts | inline fix | ~2 |
| 04:42 | Edited src/hooks/pre-read.ts | inline fix | ~8 |
| 04:42 | Edited src/hooks/post-read.ts | inline fix | ~8 |
| 04:42 | Edited src/hooks/pre-write.ts | inline fix | ~8 |
| 04:42 | Edited src/hooks/post-write.ts | inline fix | ~8 |
| 04:42 | Edited src/hooks/session-start.ts | inline fix | ~9 |
| 04:42 | Edited src/hooks/stop.ts | inline fix | ~184 |
| 04:42 | Edited src/hooks/stop.ts | modified exitWithStopHookResult() | ~47 |
| 04:42 | Edited src/hooks/stop.ts | added 1 condition(s) | ~61 |
| 04:43 | Edited src/hooks/stop.ts | added 1 condition(s) | ~36 |
| 04:43 | Edited src/hooks/stop.ts | 2→2 lines | ~25 |
| 04:45 | Edited src/cli/init.ts | added 1 import(s) | ~51 |
| 04:45 | Edited src/cli/update.ts | added 1 import(s) | ~51 |
| 04:45 | Edited src/cli/status.ts | added 1 import(s) | ~50 |
| 04:45 | Edited src/cli/init.ts | — | ~0 |
| 04:45 | Edited src/cli/update.ts | — | ~0 |
| 04:46 | Edited src/cli/init.ts | modified if() | ~253 |
| 04:46 | Edited src/cli/init.ts | "module" → "\n" | ~27 |
| 04:46 | Edited src/cli/update.ts | modified if() | ~246 |
| 04:46 | Edited src/cli/status.ts | added nullish coalescing | ~616 |
| 04:47 | Edited src/cli/hook-manifest.ts | expanded (+6 lines) | ~69 |
| 04:47 | Edited src/cli/init.ts | inline fix | ~44 |
| 04:47 | Edited src/cli/update.ts | inline fix | ~44 |
| 04:47 | Edited src/cli/status.ts | inline fix | ~41 |
| 04:47 | Edited src/cli/init.ts | 2→3 lines | ~80 |
| 04:47 | Edited src/cli/update.ts | 2→3 lines | ~80 |
| 04:47 | Edited src/cli/status.ts | 2→3 lines | ~39 |
| 04:47 | Edited src/hooks/session-start.ts | added error handling | ~431 |
| 04:48 | Edited src/cli/hook-manifest.ts | 2→2 lines | ~48 |
| 04:48 | Edited src/cli/status.ts | inline fix | ~37 |
| 04:48 | Edited src/cli/hook-manifest.ts | 2→3 lines | ~56 |
| 04:50 | Edited src/hooks/complete-review.ts | added 1 condition(s) | ~90 |
| 04:53 | Edited src/cli/nudge-cmd.ts | added error handling | ~290 |
| 04:55 | Edited src/cli/nudge-cmd.ts | 3→1 lines | ~15 |
| 04:56 | Edited src/daemon/file-watcher.ts | 2→4 lines | ~32 |
| 04:56 | Edited src/templates/.gitignore | 2→4 lines | ~20 |
| 04:56 | Edited templates/wolf/.gitignore | 2→4 lines | ~20 |
| 04:56 | Edited src/cli/init.ts | inline fix | ~22 |
| 04:57 | Edited scripts/verify-install.js | reduced (-11 lines) | ~94 |
| 04:57 | Edited scripts/verify-install.js | 2→3 lines | ~28 |
| 04:57 | Edited scripts/verify-install.js | 1→2 lines | ~25 |
| 04:58 | Edited scripts/verify-install.js | modified checkSettings() | ~204 |
| 04:58 | Edited scripts/verify-install.js | 2→4 lines | ~42 |
| 04:59 | Edited scripts/verify-install.js | 2→3 lines | ~29 |
| 05:02 | Edited src/hooks/pre-write.ts | inline fix | ~14 |
| 05:02 | Edited src/hooks/complete-review.ts | added 1 condition(s) | ~35 |
| 05:02 | Edited src/hooks/complete-review.ts | inline fix | ~23 |
| 05:03 | Edited src/hooks/stop.ts | inline fix | ~14 |
| 05:04 | Edited src/hooks/stop.ts | added nullish coalescing | ~540 |
| 05:04 | Edited src/hooks/stop.ts | inline fix | ~15 |
| 05:04 | Edited src/hooks/stop.ts | added 1 condition(s) | ~59 |
| 05:05 | Edited src/daemon/cron-engine.ts | added error handling | ~320 |
| 05:06 | Edited src/cli/nudge-cmd.ts | inline fix | ~12 |
| 05:07 | Edited tests/hook-manifest-health.test.js | 2→3 lines | ~70 |
| 05:08 | Edited tests/hook-manifest-health.test.js | added 1 condition(s) | ~519 |
| 05:13 | Edited src/hooks/stop.ts | added optional chaining | ~44 |
| 05:15 | Edited src/hooks/stop.ts | 3→2 lines | ~20 |
| 05:18 | Edited src/hooks/shared.ts | added error handling | ~235 |
| 05:18 | Edited src/hooks/session-start.ts | inline fix | ~20 |
| 05:19 | Edited tests/review-cmd.test.js | inline fix | ~26 |
| 05:19 | Edited tests/review-cmd.test.js | 2→3 lines | ~87 |
| 05:23 | Edited scripts/verify-install.js | 3→1 lines | ~8 |
| 05:24 | Edited scripts/verify-install.js | modified for() | ~69 |
| 05:39 | Edited tests/hook-manifest-health.test.js | expanded (+23 lines) | ~398 |
| 05:40 | Created VERSION | — | ~5 |
| 05:50 | Created tests/buglog-baseline-integrity.test.js | — | ~335 |
| 05:53 | Session end: 93 writes across 23 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 33 reads | ~252307 tok |

## Session summary — 2026-09-13 selective OpenWolf adoption

- Adopted only reliability mechanisms: canonical hook registration/payload manifest, exact install/update/status verification, executable self-checks, transactional hook health, strict cross-process state mutation, legacy/keyed session compatibility, scanner hygiene, and truthful cron outcomes. No dashboard feature work was added.
- Synchronized authoritative sources, compiled JavaScript, installed `.wolf` runtime, and portable templates; normalized mirror audit matched 15 hook payload files plus 1 utility file.
- Added adversarial reductions: `.wolf/qa/cross-process-state-transactions.md`, `hook-runtime-manifest-health.md`, `scanner-io-and-exclusions.md`, `truthful-cron-results.md`, `path-containment-and-session-isolation.md`, `malformed-config-and-state-preservation.md`, and `buglog-baseline-restoration.md`.
- Detected and repaired bug-767 during closeout: working buglog had 76 records versus 404 in HEAD and omitted 382 exact baseline records. Locked merge restored every committed record byte-for-byte, retained 54 new records, and the final corpus contains 459 records; regression test pins monotonic retention.
- Version advanced from `1.2.0-custom.23` to `1.2.0-custom.24` in `package.json`, `package-lock.json`, and `VERSION`.
- Validation: production build passed; final full suite passed 270/270 with 0 skipped; install verification passed; `git diff --check` passed.
- Companion review: ChatGPT GPT-5.5 reviewed 31 exact current source/test files and returned CLEAN with scope hashes; `review-0097` completed through the helper at manifest `a1d485f69602627cdb6e57d75e09658a355b8902e57f9eeefadf18c14f52fdd4`, and `review show` reports every one of its 13 files unchanged.
- No commit, push, or PR was created.

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 09:56 | Closed selective upstream reliability adoption | source/runtime/templates/tests/QA | build PASS; tests 270/270; verify PASS; review-0097 CLEAN/current | — |
| 05:57 | Session end: 93 writes across 23 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 33 reads | ~252307 tok |
| 05:59 | Edited src/hooks/complete-review.ts | modified if() | ~56 |
| 06:00 | Edited tests/review-completion.test.js | expanded (+18 lines) | ~280 |
| 06:00 | Edited src/hooks/complete-review.js | modified if() | ~56 |
| 06:00 | Edited templates/wolf/hooks/complete-review.js | modified if() | ~56 |
| 06:07 | Edited tests/buglog-baseline-integrity.test.js | added 2 condition(s) | ~327 |

**Correction — bug-767:** The earlier closeout line treated the live buglog as the whole corpus. Wolfpack intentionally archives records older than the rolling window into `.wolf/archive/buglog-*.json`. After retention reran, the live+archive audit found all 404 committed bug IDs present (0 missing). The incorrect byte-for-byte live-only reduction was removed and replaced by `.wolf/qa/buglog-archive-retention.md`; the regression now checks the two-tier ID union.
| 06:08 | Session end: 98 writes across 25 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 34 reads | ~257167 tok |
| 06:10 | Edited tests/review-completion.test.js | expanded (+19 lines) | ~302 |
| 06:10 | Edited tests/review-completion.test.js | expanded (+17 lines) | ~251 |
| 06:14 | Session end: 100 writes across 25 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 34 reads | ~257974 tok |
| 06:18 | Edited tests/review-completion.test.js | notEqual() → equal() | ~42 |
| 06:18 | Edited tests/review-completion.test.js | notEqual() → equal() | ~58 |
| 06:19 | Session end: 102 writes across 25 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 34 reads | ~258074 tok |
| 06:31 | Edited tests/hook-manifest-health.test.js | 2→3 lines | ~64 |
| 06:31 | Edited src/hooks/nudges/state.ts | added 2 condition(s) | ~421 |
| 06:31 | Edited src/hooks/complete-review.ts | inline fix | ~67 |
| 06:32 | Edited src/hooks/complete-review.ts | added 1 condition(s) | ~96 |
| 06:32 | Edited src/hooks/complete-review.ts | added 1 condition(s) | ~150 |
| 06:32 | Edited src/hooks/complete-review.ts | inline fix | ~8 |
| 06:32 | Edited src/hooks/complete-review.ts | persistReviewLog() → atomicWriteJson() | ~16 |
| 06:33 | Edited src/hooks/complete-review.ts | added optional chaining | ~577 |
| 06:33 | Edited tests/review-completion.test.js | modified runHelper() | ~91 |
| 06:34 | Edited tests/review-completion.test.js | expanded (+20 lines) | ~318 |
| 06:34 | Edited tests/review-completion.test.js | added error handling | ~732 |
| 06:34 | Edited tests/review-completion.test.js | added 1 import(s) | ~35 |
| 06:35 | Edited tests/review-completion.test.js | fsExists() → existsSync() | ~43 |
| 06:35 | Edited tests/review-completion.test.js | modified runCheck() | ~13 |
| 06:38 | Edited src/hooks/complete-review.ts | 2→2 lines | ~41 |
| 06:38 | Edited tests/review-completion.test.js | inline fix | ~17 |
| 06:46 | Edited src/hooks/complete-review.ts | added 1 condition(s) | ~97 |
| 06:47 | Edited src/hooks/complete-review.ts | added optional chaining | ~426 |
| 06:47 | Edited src/hooks/complete-review.ts | removed 6 lines | ~21 |
| 06:47 | Edited tests/hook-manifest-health.test.js | 3→3 lines | ~80 |
| 06:47 | Edited tests/hook-manifest-health.test.js | "dist" → "src" | ~32 |
| 06:48 | Edited tests/review-completion.test.js | expanded (+24 lines) | ~342 |
| 06:48 | Edited tests/review-completion.test.js | modified for() | ~395 |
| 06:50 | Edited tests/hook-manifest-health.test.js | "src" → "dist" | ~28 |
| 07:04 | Edited src/hooks/complete-review.js | 3→3 lines | ~43 |
| 07:04 | Edited src/hooks/complete-review.ts | 3→3 lines | ~43 |
| 07:04 | Edited tests/review-completion.test.js | modified reviewBaselineFixture() | ~42 |
| 07:05 | Edited tests/review-completion.test.js | 15→19 lines | ~225 |
| 07:05 | Edited tests/review-completion.test.js | expanded (+24 lines) | ~358 |
| 07:06 | Edited tests/review-completion.test.js | expanded (+6 lines) | ~523 |
| 07:06 | Edited tests/review-completion.test.js | 2→2 lines | ~22 |
| 07:15 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 36 reads | ~315237 tok |
| 07:22 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 36 reads | ~315237 tok |
| 07:23 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 36 reads | ~315237 tok |
| 07:23 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 36 reads | ~315237 tok |

## Selective upstream reliability adoption — final closeout

- Adopted only isolated reliability mechanisms; no dashboard-focused feature work and no wholesale upstream merge.
- Final local validation: `npm run build` PASS; `npm test` PASS (279/279, 0 failed, 0 skipped); `npm run verify` PASS; `git diff --check` PASS; source/runtime/template mirror checks PASS.
- GLM-5.2 current-byte fix verification: `VERDICT: CLEAN`. It verified refresh/attestation mode exclusivity and production-bound covered-token basis transitions with executable negative controls; no newly introduced reachable defect survived review.
- `review-0098` was refreshed and completed through `.wolf/hooks/complete-review.js` only: 23 current files, reviewer `glm-5.2`, lineage round 1, `requires_rereview: false`; subsequent `--check` returned CURRENT and no pending review remains.
- Bug evidence is resolved through `bug-786`; new reductions: `.wolf/qa/review-covered-token-basis.md`, updated `.wolf/qa/review-check-completed.md`, and updated `.wolf/qa/review-lineage-transaction-order.md`.
- Release version remains synchronized at `1.2.0-custom.24`.
- No commit, push, or PR was created.
| 07:27 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 36 reads | ~315237 tok |
| 13:32 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 36 reads | ~315237 tok |
| 13:38 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 46 reads | ~315237 tok |
| 13:47 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 46 reads | ~315237 tok |
| 13:48 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 46 reads | ~315237 tok |
| 13:49 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 52 reads | ~324434 tok |
| 13:55 | Session end: 155 writes across 30 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 61 reads | ~361438 tok |
| 14:01 | Edited src/hooks/pre-read.ts | added 5 condition(s) | ~1577 |
| 14:03 | Edited src/config/default-config.json | 8→13 lines | ~97 |
| 14:03 | Edited src/templates/config.json | 8→13 lines | ~97 |
| 14:03 | Edited templates/wolf/config.json | 8→13 lines | ~97 |
| 14:03 | Edited src/cli/init.ts | 2→3 lines | ~94 |
| 14:05 | Edited tests/config-merge-safety.test.js | expanded (+25 lines) | ~539 |
| 14:05 | Edited scripts/verify-install.js | added 2 condition(s) | ~353 |
| 14:06 | Edited scripts/verify-install.js | 2→3 lines | ~30 |
| 14:08 | Edited tests/pre-read-oversized-guard.test.js | 7→9 lines | ~146 |
| 14:10 | Edited package.json | inline fix | ~8 |
| 14:10 | Edited package-lock.json | inline fix | ~8 |
| 14:10 | Edited VERSION | inline fix | ~4 |
| 14:17 | Session end: 168 writes across 37 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~365744 tok |
| 14:18 | Edited src/config/default-config.json | — | ~0 |
| 14:19 | Edited src/templates/config.json | — | ~0 |
| 14:19 | Edited templates/wolf/config.json | — | ~0 |
| 14:19 | Edited src/cli/init.ts | — | ~0 |
| 14:19 | Edited package.json | inline fix | ~8 |
| 14:19 | Edited package-lock.json | inline fix | ~8 |
| 14:19 | Edited VERSION | inline fix | ~4 |
| 14:20 | Edited scripts/verify-install.js | — | ~0 |
| 14:20 | Edited scripts/verify-install.js | 3→2 lines | ~21 |
| 14:20 | Edited tests/config-merge-safety.test.js | — | ~0 |
| 14:26 | Session end: 179 writes across 37 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~365848 tok |
| 14:30 | Session end: 181 writes across 37 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~366227 tok |
| 14:36 | Edited src/hooks/pre-write.ts | inline fix | ~23 |
| 14:36 | Edited src/hooks/pre-write.js | inline fix | ~23 |
| 14:36 | Edited templates/wolf/hooks/pre-write.js | inline fix | ~23 |
| 14:36 | Edited src/templates/.gitignore | 2→2 lines | ~7 |
| 14:36 | Edited templates/wolf/.gitignore | 2→2 lines | ~7 |
| 14:37 | Edited src/cli/init.ts | inline fix | ~8 |
| 14:38 | Edited tests/hook-manifest-health.test.js | 2→3 lines | ~63 |
| 14:38 | Edited tests/hook-manifest-health.test.js | modified for() | ~983 |
| 14:45 | Created ../../../../../tmp/add-review-fix-bugs.mjs | — | ~1023 |
| 14:45 | Edited package.json | inline fix | ~8 |
| 14:45 | Edited package-lock.json | inline fix | ~8 |
| 14:45 | Edited VERSION | inline fix | ~4 |
| 14:52 | Session end: 195 writes across 41 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~370765 tok |
| 14:56 | Edited tests/hook-manifest-health.test.js | 3→5 lines | ~103 |
| 14:56 | Edited tests/hook-manifest-health.test.js | added 1 condition(s) | ~472 |
| 14:57 | Edited tests/hook-manifest-health.test.js | "src" → "dist" | ~27 |
| 14:59 | Created ../../../../../tmp/add-review-hardening-bugs.mjs | — | ~891 |
| 15:03 | Session end: 200 writes across 42 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~373950 tok |
| 15:15 | Edited src/cli/init.ts | modified if() | ~66 |
| 15:15 | Edited src/cli/init.ts | expanded (+53 lines) | ~314 |
| 15:16 | Edited tests/hook-manifest-health.test.js | inline fix | ~21 |
| 15:17 | Edited tests/hook-manifest-health.test.js | 5→6 lines | ~86 |
| 15:17 | Edited tests/hook-manifest-health.test.js | modified if() | ~86 |
| 15:18 | Edited tests/hook-manifest-health.test.js | modified for() | ~328 |
| 15:20 | Created ../../../../../tmp/add-template-fallback-bugs.mjs | — | ~877 |
| 15:25 | Edited src/cli/init.ts | added 1 condition(s) | ~80 |
| 15:25 | Edited scripts/verify-install.js | inline fix | ~56 |
| 15:28 | Session end: 212 writes across 44 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~378427 tok |

## Selective upstream token-discipline and review hardening — final closeout

- Retained ordered per-call Read telemetry, but rejected and fully removed the proposed 256 KiB first-unbounded-Read guard: across 12 sessions its eight apparent candidates were seven legitimate PNG screenshots and one already-failed config read, with zero successful oversized text reads that would have benefited.
- Resolved bugs `bug-789` through `bug-794`: restored lesson-hit persistence, made nested QA ignore verification independent of repository-root and user-global excludes, exercised the embedded producer, made required-template fallback fail closed without replacing installed bytes, and bound embedded `.gitignore` bytes to canonical policy.
- Version advanced and synchronized to `1.2.0-custom.25` in `package.json`, `package-lock.json`, and `VERSION`.
- Final validation: `npm run build` PASS; `npm test` PASS (282/282, 0 failed, 0 skipped); `npm run verify` PASS; `git diff --check` PASS; anatomy drift check PASS (247/247, zero findings).
- GLM-5.2 exact-current-byte companion review returned `VERDICT: CLEAN`; `review-0099` was completed through `.wolf/hooks/complete-review.js`, covers 30 files in lineage `lin-c8bc2d432d9fe6fb` round 1, and its final `--check` returned CURRENT.
- No commit, push, PR, dashboard work, or fleet rollout was performed.
| 15:39 | Session end: 212 writes across 44 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~378427 tok |
| 15:49 | Session end: 212 writes across 44 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~378427 tok |
| 15:51 | Session end: 212 writes across 44 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 62 reads | ~378427 tok |
| 15:54 | Session end: 212 writes across 44 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 65 reads | ~385994 tok |
| 15:54 | Session end: 212 writes across 44 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 65 reads | ~385994 tok |
| 18:55 | Edited src/cli/update.ts | added error handling | ~266 |
| 18:56 | Created tests/update-source-exclusion.test.js | — | ~572 |
| 19:02 | Edited src/cli/index.ts | 4→5 lines | ~82 |
| 19:02 | Edited src/cli/init.ts | modified initCommand() | ~30 |
| 19:02 | Edited src/cli/init.ts | added 1 condition(s) | ~109 |
| 19:03 | Created tests/init-root-scope.test.js | — | ~729 |
| 19:04 | Edited tests/init-root-scope.test.js | — | ~0 |
| 19:26 | Edited ../../../../../tmp/corrected-fleet-verifier.sh | inline fix | ~11 |
| 19:26 | Edited ../../../../../tmp/corrected-fleet-verifier.sh | inline fix | ~4 |
| 19:26 | Edited ../../../../../tmp/corrected-fleet-verifier.sh | inline fix | ~12 |
| 19:27 | Edited ../../../../../tmp/corrected-fleet-verifier.sh | inline fix | ~40 |
| 19:27 | Edited ../../../../../tmp/corrected-fleet-verifier.sh | inline fix | ~159 |
| 19:28 | Edited ../../../../../tmp/corrected-fleet-verifier.sh | inline fix | ~92 |
| 19:31 | Session end: 232 writes across 53 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 69 reads | ~395320 tok |
| 20:45 | Session end: 232 writes across 53 files (session-start.ts, shared.ts, size-discipline.ts, session-start-concurrency.test.js, pre-read.ts) | 69 reads | ~395320 tok |

## Session: 2026-09-17 15:31

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|

## Session: 2026-10-03 11:47

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|

### ECC nudge-system assessment

- Compared pinned ECC source (`ef648e01899ba3e8dc6371642deaaf64b4477775`) against current Wolfpack implementation; read-only source exploration, no ECC execution or installation.
- Report: `.wolf/audits/ecc-nudge-assessment-2026-10-03.md`. Ranked candidates: bounded approved-lesson disclosure, early outcome-aware no-progress feedback, optional batched read-only validation. Wholesale integration rejected; benefit remains unmeasured.
- Recorded disposition in Cerebrum and indexed the report in Anatomy. No runtime/source changes, tests, commit, publication, or fleet rollout.
| 12:18 | Created src/hooks/lesson-recall.ts | — | ~1256 |
| 12:20 | Edited src/hooks/pre-write.ts | added 3 import(s) | ~90 |
| 12:20 | Edited src/hooks/pre-write.ts | added optional chaining | ~397 |
| 12:21 | Edited src/hooks/pre-write.ts | added error handling | ~720 |
| 12:22 | Edited src/cli/hook-manifest.ts | 2→3 lines | ~17 |
| 12:22 | Edited src/config/default-config.json | 4→9 lines | ~57 |
| 12:22 | Edited src/templates/config.json | 4→9 lines | ~57 |
| 12:22 | Edited templates/wolf/config.json | 4→9 lines | ~57 |
| 12:24 | Edited src/hooks/lesson-recall.ts | 2→3 lines | ~20 |
| 12:24 | Edited src/hooks/lesson-recall.ts | added 4 condition(s) | ~149 |
| 12:24 | Edited src/hooks/lesson-recall.ts | modified for() | ~30 |
| 12:25 | Edited src/hooks/lesson-recall.ts | inline fix | ~34 |
| 12:26 | Edited src/hooks/lesson-recall.ts | 1→5 lines | ~105 |
| 12:27 | Edited src/hooks/lesson-recall.ts | added nullish coalescing | ~200 |
| 12:27 | Edited src/hooks/pre-write.ts | inline fix | ~34 |
| 12:30 | Created tests/lesson-recall.test.js | — | ~3850 |
| 12:36 | Edited src/hooks/lesson-recall.ts | 1→2 lines | ~62 |
| 12:36 | Edited src/hooks/lesson-recall.ts | 3→6 lines | ~106 |
| 12:37 | Edited src/hooks/lesson-recall.ts | 1→2 lines | ~51 |
| 12:39 | Created scripts/lesson-recall-canary.mjs | — | ~2378 |
| 12:43 | Edited package.json | inline fix | ~8 |
| 12:43 | Edited package-lock.json | inline fix | ~8 |
| 12:43 | Edited VERSION | inline fix | ~4 |
| 12:43 | Created docs/relevant-lessons.md | — | ~1107 |
| 12:51 | Edited src/hooks/lesson-recall.ts | inline fix | ~21 |
| 12:51 | Edited src/hooks/lesson-recall.ts | added 1 condition(s) | ~70 |
| 12:51 | Edited src/hooks/lesson-recall.ts | 2→2 lines | ~42 |
| 12:52 | Edited src/hooks/lesson-recall.ts | 1→4 lines | ~114 |
| 12:52 | Edited src/hooks/lesson-recall.ts | inline fix | ~44 |
| 12:52 | Edited src/hooks/lesson-recall.ts | 1→2 lines | ~57 |
| 12:52 | Edited src/hooks/pre-write.ts | added optional chaining | ~18 |
| 12:53 | Edited src/hooks/pre-write.ts | added 1 condition(s) | ~89 |
| 12:53 | Edited src/hooks/lesson-recall.ts | "Relevant lesson excerpts;" → "Cerebrum excerpts (contex" | ~25 |
| 12:54 | Edited src/hooks/lesson-recall.ts | 4→5 lines | ~96 |
| 12:54 | Edited src/hooks/shared.ts | modified toString() | ~119 |
| 12:56 | Edited scripts/lesson-recall-canary.mjs | modified replay() | ~43 |
| 12:57 | Edited scripts/lesson-recall-canary.mjs | added 1 condition(s) | ~25 |
| 12:57 | Edited scripts/lesson-recall-canary.mjs | added 1 condition(s) | ~321 |
| 12:58 | Edited tests/lesson-recall.test.js | added optional chaining | ~792 |
| 13:00 | Edited src/hooks/lesson-recall.ts | 2→2 lines | ~37 |
| 13:14 | Edited docs/relevant-lessons.md | expanded (+6 lines) | ~309 |

### Relevant-lesson local canary closeout — 2026-10-03

- Implemented and enabled only this checkout; canonical default/scaffold configs stay off. Local lexical matching supplements governing reads, with owner scope, bounded section-labeled excerpts/source pointers and existing nudge lifecycle. No ECC installation, memory promotion, fleet rollout, commit or publication.
- Changed code: src/hooks/lesson-recall.ts/js, pre-write.ts/js, shared.ts/js; src/cli/hook-manifest.ts; config/scaffold defaults and local opt-in; corresponding portable/installed helper/runtime/manifest copies. Added tests/lesson-recall.test.js, scripts/lesson-recall-canary.mjs and docs/relevant-lessons.md. Package/package-lock/VERSION now 1.2.0-custom.27. Unrelated dirty changes preserved.
- Validation: build PASS; 333/333 tests PASS; install verification PASS. Two actual runtime-negative controls exit 1 for intended missing injection and EOF liveness defects; temporary probes removed and originals hash-verified unchanged. Final source-byte independent review CLEAN after reproduced fixes; rejected intermediate Git-SHA-1 receipt and verified final kept-stage SHA-256 receipt. Three review executions total; no further review required.
- Historical evidence is a pre-closeout corpus snapshot: 158 lessons, 18 transcript files (2 tail-limited), 22 eligible edits, sample 9 edits/3 sessions. Three isolated injections versus two under default shared-session state; single paired excerpt 643→421 bytes, aggregate isolated treatment 1400 bytes versus baseline 643. Different stderr/context channels are not token costs; no improved task outcomes or fleet-general precision demonstrated.
- Parent-owned consolidation: bug-812 through bug-823 bind concrete defects/evaluation/accounting errors to .wolf/qa/lesson-recall.md; auto bug-801 through bug-811 retain original heuristic claims with explicit assessments/proof links rather than being silently deleted or counted as reproduced fixes. All remain open with commit null because no commit was requested. Canonical lock/max-ID/atomic writer used; 25 baseline-only entries verified retained in archives, no ledger repair needed.
- Durable evidence: .wolf/qa/lesson-recall.md, lesson-recall-canary.json, lesson-recall-controls.json, lesson-recall-review.json. Review list had no pending entries. Governing memory records measured local-only decision and receipt-domain lesson. Trust boundary remains repository-controlled Cerebrum: no authorship authentication; recalled commands never execute automatically.
- Final closeout checks: all 24 evidence hashes still match; compiled helper/pre-write twins and three EOF runtime seams pass; config/version alignment and git diff --check pass; bug/review identities clean, no pending review IDs. Preserved actual full-suite summary and install-verification output in review evidence. Historical global QA status is not clean (39 current, 131 stale, 4 orphan, 22 broken); those older records were not refreshed or represented as passing. This canary reduction is CURRENT.
| 13:48 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
- Stop created review-0100 after the completion response. All 12 obligation hashes matched saved evidence; supporting config/version/docs changes inspected without another companion pass. Completed through canonical complete-review.js with honest composite reviewer and reviewed-current fallback; full-set hash was not falsely attributed to the companion. Receipt preserved in lesson-recall-review.json. No additional review executions; source bytes unchanged.
| 13:50 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
| 13:51 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
| 17:16 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
| 17:17 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
| 17:17 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
- User clarified the perceived double Stop with two successive “Ran 3 stop hooks” passes. Investigation found Wolfpack plus security-guidance/ralph-loop Stop types, and identical Wolfpack registration declarations at project/parent levels; duplicate execution not proven. Actual markerPresent substring check rejected “Version is …” as version-impact evidence, causing the second corrective reply. No hook registrations, configuration or runtime code changed; learning recorded.
| 17:24 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
| 17:24 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |
| 17:30 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 34 reads | ~267936 tok |

### agent-improvement-loop source assessment — 2026-10-03

- Pinned c4c34708a6fb8cfe5557f7ea17107dbf817d481c; inspected substantive miner/store source, selected tests and design/skill docs. Ten downloaded files Git-blob verified. Third-party tests were inspected, not run; no install, scheduler, external publication or functional changes.
- Parent accepted source-supported candidates only: distinct-incident/post-fix recurrence reporting; exact local transcript locators; parser-coverage diagnostics. Wolfpack already covers conservative capture/promotion, dispositions, protected experiments, review hashes and bounded lesson recall. No measured local/fleet value yet; no implementation authorized.
- Rejected wholesale integration/new store/background promotion/review chain/public-content pipeline. Silent-empty detector and skill/correction temporal association need stronger local evidence; scanner runs cannot stand for independent incidents. Assessment: .wolf/audits/agent-improvement-loop-assessment-2026-10-03.md.
- Resolved research pin assertion/domain error is bug-824 with proof linked; canonical lock/max-ID/atomic writer used. Current source/runtime/version files untouched. Version impact: none for this assessment; prior 1.2.0-custom.27 canary unchanged. Nothing staged, committed, pushed or fleet-deployed.
| 17:41 | Session end: 42 writes across 13 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 44 reads | ~301642 tok |
| 17:50 | Created tests/bug-recurrence.test.js | — | ~4734 |
| 17:50 | Edited tests/bug-recurrence.test.js | 2→3 lines | ~66 |
| 17:50 | Edited tests/bug-recurrence.test.js | 2→4 lines | ~74 |
| 17:52 | Edited tests/bug-recurrence.test.js | inline fix | ~32 |
| 17:55 | Created src/buglog/recurrence-report.ts | — | ~5772 |
| 17:56 | Created src/cli/bug-recurrence-cmd.ts | — | ~924 |
| 17:56 | Edited src/cli/index.ts | expanded (+16 lines) | ~287 |
| 17:57 | Edited src/buglog/recurrence-report.ts | inline fix | ~45 |
| 18:00 | Edited src/buglog/recurrence-report.ts | added nullish coalescing | ~286 |
| 18:01 | Edited src/buglog/recurrence-report.ts | 2→3 lines | ~66 |
| 18:01 | Edited tests/bug-recurrence.test.js | modified for() | ~789 |
| 18:01 | Edited src/buglog/recurrence-report.ts | added 1 condition(s) | ~121 |
| 18:01 | Edited package.json | inline fix | ~8 |
| 18:01 | Edited package-lock.json | inline fix | ~8 |
| 18:01 | Edited VERSION | inline fix | ~4 |
| 18:03 | Created docs/bug-recurrence.md | — | ~1514 |
| 18:07 | Edited package.json | inline fix | ~19 |
| 18:10 | Edited tests/bug-recurrence.test.js | 3→7 lines | ~120 |
| 18:10 | Created scripts/recurrence-controls.mjs | — | ~1323 |
| 18:10 | Edited scripts/recurrence-controls.mjs | 2→4 lines | ~99 |
| 18:10 | Edited tests/bug-recurrence.test.js | modified for() | ~1485 |

| 2026-10-03 | Implemented read-only recurrence CLI; real corpus exposed archive overlap, fixed conservative coalescing and diagnostic exclusions; bounded npm test file concurrency after a CLI fixture timeout | src/buglog/recurrence-report.ts, src/cli/bug-recurrence-cmd.ts, src/cli/index.ts, tests/bug-recurrence.test.js, scripts/recurrence-controls.mjs, docs/bug-recurrence.md, package metadata | 16 focused controls and earlier344-test full run pass; final review/QA pending; no commit, publish, hook or fleet changes | ~8k |
| 18:24 | Edited src/buglog/recurrence-report.ts | added 1 condition(s) | ~123 |
| 18:24 | Edited src/buglog/recurrence-report.ts | 3→2 lines | ~46 |
| 18:24 | Edited tests/bug-recurrence.test.js | expanded (+70 lines) | ~1198 |
| 18:24 | Edited src/buglog/recurrence-report.ts | modified for() | ~12 |
| 18:25 | Edited scripts/recurrence-controls.mjs | added 1 import(s) | ~26 |
| 18:25 | Edited scripts/recurrence-controls.mjs | added 1 condition(s) | ~443 |
| 18:25 | Edited scripts/recurrence-controls.mjs | inline fix | ~35 |
| 18:29 | Edited scripts/recurrence-controls.mjs | added 1 condition(s) | ~124 |
| 18:30 | Edited scripts/recurrence-controls.mjs | modified for() | ~394 |
| 18:30 | Edited scripts/recurrence-controls.mjs | added nullish coalescing | ~253 |

| 22:55 | Completed read-only recurrence report and current-byte evidence closeout | src/buglog/recurrence-report.ts, src/cli/bug-recurrence-cmd.ts, src/cli/index.ts, tests/bug-recurrence.test.js, scripts/recurrence-controls.mjs, docs/bug-recurrence.md, package metadata, .wolf/qa/bug-recurrence* | 19 focused / 352 full tests; build/install PASS; freshness rejected stale runtime; five expected-negative controls verified; four review findings fixed, final scoped CLEAN receipt preserved with unavailable-stage limits; local real-history exit2/54 failures/no default matches, not no-regression proof; bug-831 assessed and bug-837..841 recorded; custom.28 source only, uncommitted/unpublished/no rollout | ~4k |
| 18:56 | Session end: 77 writes across 19 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 57 reads | ~362148 tok |
| 18:57 | Session end: 77 writes across 19 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 57 reads | ~362148 tok |
| 19:13 | Session end: 77 writes across 19 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 57 reads | ~362148 tok |
| 09:40 | Created ../../../../../tmp/wolfpack-latest-recall-evaluation.mjs | — | ~2170 |
| 09:40 | Created ../../../../../tmp/latest-additions-recurrence-probe.mjs | — | ~2531 |
| 09:41 | Edited ../../../../../tmp/wolfpack-latest-recall-evaluation.mjs | "globstar is off" → "Fleet-coverage checks mus" | ~15 |
| 09:43 | Edited ../../../../../tmp/latest-additions-recurrence-probe.mjs | 1→4 lines | ~245 |
| 09:43 | Edited ../../../../../tmp/wolfpack-latest-recall-evaluation.mjs | 1→4 lines | ~164 |
| 09:43 | Edited ../../../../../tmp/latest-additions-recurrence-probe.mjs | inline fix | ~31 |
| 09:43 | Edited ../../../../../tmp/wolfpack-latest-recall-evaluation.mjs | inline fix | ~18 |

| 13:46 | Started authorized practical evaluation of relevant-lesson recall and recurrence reporting | .wolf/audits/latest-additions-evaluation-2026-10-04.md | Predeclared gates frozen; isolated real-hook tests: 2/6 risk recalls, 0/5 irrelevant injections, caps and owner isolation pass; warm skillsbench subject baseline 9/9 correct, second pass unchanged; real recurrence utility investigation pending; no production configuration change or rollout | ~3k |

| 13:57 | Completed practical qualification and rollout decisions for both latest additions | .wolf/qa/latest-additions-evaluation.md, .wolf/qa/latest-additions-evaluation.json, .wolf/audits/latest-additions-evaluation-2026-10-04.md | No blanket rollout: recall opt-in only (2/6 risk recall, 0/5 noise, ~240ms paired local overhead); warm subject 9/9 before and after, no corrected decisions; recurrence optional occasional CLI only (zero matches both roots, no defensible sampled bug link, 24s/2.5s runs); 42 focused tests and five negative controls pass; 24 original byte locators independently checked; corrections bug-842..846 retained; no production/config/permission changes, deployment or publication | ~4k |
| 09:58 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 60 reads | ~375292 tok |
| 09:59 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 60 reads | ~375292 tok |

| 14:10 | Recorded user decision to skip rollout/promotion of both latest additions | .wolf/cerebrum.md | No deployment/configuration change or source deletion; experimental work remains uncommitted | ~0.3k |
| 10:10 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 60 reads | ~375292 tok |

| 17:39 | Answered peer quiet-hook provenance alert | src/hooks/pre-write.ts, src/hooks/stop.ts, src/hooks/shared.ts | Current canonical source has no quiet-mode early exit; Stop unchanged; latest opt-in recall/recurrence work was not rolled out. Requested exact peer root/flagged hashes; no bypass verdict or target mutation inferred. Repeated guessed test-path lookup tracked under bug-841 | ~0.5k |
| 13:39 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 60 reads | ~375292 tok |
| 13:40 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 60 reads | ~375292 tok |
| 13:49 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~454893 tok |
| 13:50 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~454893 tok |
| 13:56 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~454893 tok |
| 10:41 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~454893 tok |
| 10:42 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~454893 tok |
| 10:42 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~454893 tok |
| 11:34 | Session end: 85 writes across 22 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~454893 tok |
| 13:50 | Created ../rag/.wolf/canaries/nudge-qualification-2026-10-05/cases.json | — | ~1376 |
| 13:53 | Created ../rag/.wolf/canaries/nudge-qualification-2026-10-05/canary.mjs | — | ~3760 |
| 13:53 | Edited ../rag/.wolf/canaries/nudge-qualification-2026-10-05/canary.mjs | inline fix | ~44 |
| 13:55 | Created ../rag/.wolf/canaries/nudge-qualification-2026-10-05/protocol.md | — | ~1896 |
| 13:55 | Created ../rag/.wolf/canaries/nudge-qualification-2026-10-05/manifest.json | — | ~285 |
| 13:58 | Created ../rag/.wolf/canaries/nudge-qualification-2026-10-05/preflight.json | — | ~462 |
| 14:00 | Created ../rag/.wolf/qa/nudge-qualification-canary.md | — | ~1396 |
| 14:03 | Session end: 92 writes across 28 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 66 reads | ~464618 tok |

## Session: 2026-10-05 offline qualification coordination

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
| 18:07 | RRSI-inspired RAG qualification setup | External RAG canary/QA; local cerebrum/anatomy | 13 embedded + five supplementary receiving checks pass; live trials 0. RAG coordinator reports a candidate fresh-context executor, not executed proof. review-0102 pending: 17 files still covered by review-0101; five new canary files in one scoped companion review. | not measured |
| 14:19 | Created ../rag/.wolf/canaries/nudge-qualification-2026-10-05-v2/canary.mjs | — | ~5279 |

| 18:26 | Verified and repaired offline qualification checker | External RAG v2; owner QA/buglog; local metadata | Original review defects reproduced. v2 syntax, 24 embedded, 14 receiving groups and six guard-disconnection controls pass; original frozen bytes preserved. Scoped fix review pending; zero model trials, hooks/config unchanged. | not measured |
| 14:29 | Created ../rag/.wolf/qa/nudge-qualification-canary.md | — | ~2147 |
| 14:32 | Edited ../rag/.wolf/qa/nudge-qualification-canary.md | "claude-companion.mjs revi" → "claude-companion" | ~177 |

| 18:34 | Qualification setup closeout | .wolf/reviewlog.json review-0102 via canonical helper; external RAG review receipts | v2 five-file CLEAN hashes current; 24 embedded + 14 receiving groups + six disconnections pass. Two companion passes, later metadata retrieval not another pass. Coordinator records v2 as sole execution candidate and keeps trials unlaunched pending explicit go-ahead. | not measured |
| 14:35 | Session end: 95 writes across 28 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~472763 tok |

| 18:36 | Stop review-0103 reconciled canonically | .wolf/reviewlog.json; external RAG v2 receipt | 22 current paths covered by review-0102 plus one current v2 path already in CLEAN fix scope; no extra companion pass. Current-byte check passed. Zero live trials. | not measured |
| 14:36 | Session end: 95 writes across 28 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~472763 tok |
| 11:37 | Session end: 95 writes across 28 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~472763 tok |
| 11:48 | Session end: 95 writes across 28 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~472763 tok |

| 15:50 | Authorized first live RAG v2 canary per user Proceed | External RAG coordinator; frozen manifest 68a0d7ecd36102f479626fc1b3f53248d1c880ba15a5cffccb9f2091b6a5a0ec | Authorization sent; awaiting acknowledgment/results. Ceiling 44 fresh contexts, 20 minutes, 60s/request, <=2 concurrent. No execution or benefit claimed yet. | not measured |
| 11:57 | Created ../../../../../tmp/wolf-nudge-live-20261006.mjs | — | ~1892 |

- [2026-10-06] Actual user authorized Proceed in the customopenwolf parent session. RAG peer declined relayed approval; parent respected that boundary and launched directly here. Frozen v2 preflight passed; executor is CLI 2.1.291, requested model gpt-6.1-sol, effort high, fresh UUID per invocation, bare/tool-free/nonpersistent. Limits 44 invocations, 20 minutes, 60 seconds each, two concurrent; first observation gates further execution on actual init isolation/model/session telemetry. Results pending, not benefit/adoption. Run: `/mnt/j/projectshome/projects/rag/.wolf/canaries/nudge-qualification-2026-10-05-v2/runs/live-20261006-n8NlEh/`.
| 11:58 | Created ../../../../../tmp/wolf-nudge-verify-20261006.mjs | — | ~962 |

- [2026-10-06] First authorized live v2 canary completed: 44/44 fresh tool-free contexts, all rationale/choice checks accepted, held-out 18/18 baseline and treatment, zero protected failures/regressions; receiving checker exit 0, signal reject (no benefit). Run 109738 ms, peak concurrency 2, longest request 7447 ms. Raw evidence and manual disposition: `/mnt/j/projectshome/projects/rag/.wolf/canaries/nudge-qualification-2026-10-05-v2/runs/live-20261006-n8NlEh`. CLI-reported economics remain unattested; no rollout, extra rounds, runtime/config changes, commit or publication.
| 12:02 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~475820 tok |
| 12:02 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~475820 tok |
| 12:02 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~475820 tok |

- [2026-10-06] User accepted keeping current Wolfpack behavior after the completed no-benefit canary: “Sounds like what e have is optimal for now!” No further additions, trials, or rollout pursued.
| 14:01 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 67 reads | ~475820 tok |
| 11:14 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 68 reads | ~493013 tok |
| 11:16 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 68 reads | ~493013 tok |
| 11:18 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 68 reads | ~493013 tok |
| 13:44 | Session end: 97 writes across 30 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 68 reads | ~493013 tok |
| 13:56 | Edited src/hooks/pre-write.ts | — | ~0 |
| 13:57 | Edited src/hooks/pre-write.ts | removed 71 lines | ~136 |
| 13:58 | Edited package.json | inline fix | ~8 |
| 13:58 | Edited package-lock.json | inline fix | ~8 |
| 13:58 | Edited VERSION | inline fix | ~4 |
| 14:02 | Created tests/pre-write-retirement.test.js | — | ~2362 |

- [2026-10-07] Lesson-recall retirement authorized and implemented: private verified backup `/home/tony/.claude/backups/wolfpack-recall-retirement-20261007-OoHfB8` (48 files + dirty-tree patch); removed opt-in config, selector/runtime/template helper, call sites, manifests, canary/script/docs and experiment suite. Restored legacy driving-project checks, kept independent fixes and recurrence. New `tests/pre-write-retirement.test.js` preserves stdin regression and tests legacy behavior/cross-project non-access; build passed, further validation pending. Version 1.2.0-custom.29.
| 14:04 | Edited tests/pre-write-retirement.test.js | inline fix | ~7 |

- [2026-10-07] Retirement validation: final full suite passed 342/342; three supplementary receiving controls reproduce old foreign-state effects, show their absence after retirement, and prove EOF cancellation via expected ETIMEDOUT. Corrected initial mutation-fixture import closure and wrong state-file assertion; bugs bug-847, bug-848, bug-849. Independent review’s initial Git-staging refusal is invalid current-file evidence; corrected companion-owned current-file review pending.
| 14:16 | Edited src/hooks/pre-write.ts | 7→9 lines | ~138 |
| 14:17 | Edited tests/pre-write-retirement.test.js | modified for() | ~572 |

- [2026-10-07] Lesson recall retired and final bytes validated: build passed, 350/350 full tests, 30/30 focused tests, install verification passed, four bound supplementary controls passed. Current three-file companion fix review CLEAN with full verified SHA-256. Review accounting: one unusable agent report, two direct companion passes; metadata continuation adds no valid review. Reproduced/fixed same-basename advice mismatch; additional bugs bug-850, bug-851. Source/runtime/template copies synchronized; 11 protected files and other config fields unchanged; version .29. No fleet update/commit/publication. QA `.wolf/qa/lesson-recall-retirement.md`.
| 14:29 | Session end: 107 writes across 32 files (lesson-recall.ts, pre-write.ts, hook-manifest.ts, default-config.json, config.json) | 71 reads | ~510034 tok |

## Session: 2026-10-10 12:35

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|

## Session: 2026-10-11 11:44

| Time | Action | File(s) | Outcome | ~Tokens |
|------|--------|---------|---------|--------|
- 2026-10-11T15:54:19Z Fixed learning-nudge false positive on peer messages: readRecentUserTurns skips isMeta / origin.kind=peer entries (shared.ts/js, template, .wolf copy) + test. Replied to skills-catalog: nudge belongs in a user-level UserPromptSubmit hook, not WolfPack.
| 12:07 | Session end: 2 writes across 2 files (learning-nudge-peer-messages.md, cron-run-daemon-connect.md) | 0 reads | ~1849 tok |
| 12:24 | Session end: 2 writes across 2 files (learning-nudge-peer-messages.md, cron-run-daemon-connect.md) | 0 reads | ~1849 tok |
| 12:27 | Session end: 2 writes across 2 files (learning-nudge-peer-messages.md, cron-run-daemon-connect.md) | 0 reads | ~1849 tok |
- 2026-10-11T16:30:39Z Merged feature/quiet-mode-modernization (WolfPack Lite) into autonomy-continuation as 8eecb28 (custom.30; 380/380 tests, verify passed). Relinked global openwolf to the main checkout, removed the Lite worktree and branch. Earlier: committed the pending recurrence/pre-write/provenance work and fixed the cron run daemon stall (bug-853).
- 2026-10-11T16:50:04Z Fleet updated to custom.30 (105 projects, reviewed cleanup removed 91 obsolete files, exit 0). Retired the parent-dir rules file, the stale origin branches feat/size-discipline-and-review-hook and fix/copyfile-efs-wsl2, and local master. Backups are in ~/.openwolf/retired/2026-10-11/.
- 2026-10-11T16:52:14Z Broke ties with upstream: force-replaced origin/main (was Dr. Farhan's upstream history, bd69835) with the fork; feature/autonomy-continuation renamed to main and deleted on origin. Old main saved in ~/.openwolf/retired/2026-10-11/openwolf-upstream-main.bundle. Removed dangling global npm link openwolf -> ~/openwolf-upstream.
