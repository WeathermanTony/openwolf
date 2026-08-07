# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-08-07T15:48:09.471Z
> Files: 198 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../home/tony/.claude/

- `CLAUDE.md` — Claude Code Behaviour Guidelines (~4318 tok)

## ../../../../../home/tony/.claude/plans/

- `fizzy-doodling-pascal.md` — Context (~2700 tok)

## ../../../../../tmp/claude-1000/-mnt-j-projectshome-projects-customopenwolf/c4387010-c00b-4112-8227-289ad1848c57/scratchpad/

- `add-bug-restore.mjs` — Declares p (~644 tok)
- `add-bug-swallow.mjs` — Declares p (~656 tok)
- `add-bug474.mjs` — Declares p (~487 tok)
- `add-bug475.mjs` — Declares p (~551 tok)
- `add-bug478.mjs` — Declares p (~737 tok)
- `add-round4-bugs.mjs` — ` exclude suppressed the post-write nudge while the Stop hook still fired; symmetrically a root-anch (~2337 tok)
- `add-zero-bug.mjs` — Declares p (~647 tok)
- `clean-stubs.mjs` — Declares p (~301 tok)
- `dedupe-anatomy.mjs` — anatomy.md listed several files twice within the same directory section -- (~575 tok)
- `fix-bug474.mjs` — Declares p (~588 tok)

## ./

- `.editorconfig` — Editor configuration (~51 tok)
- `.gitignore` — Git ignore rules (~315 tok)
- `CLAUDE.md` — Wolfpack (~74 tok)
- `package-lock.json` — npm lock file (~69275 tok)
- `package.json` — Node.js package manifest (~577 tok)
- `README.md` — Project documentation (~752 tok)
- `tsconfig.json` — TypeScript configuration (~140 tok)
- `VERSION` (~4 tok)

## .claude/

- `settings.json` (~627 tok)

## .claude/rules/

- `openwolf.md` (~371 tok)

## .claude/skills/quality-reduction/

- `SKILL.md` — Project-local workflow for falsifiable QA reductions and manifest-bound skill receipts (~1150 tok)

## .wolf/qa/

- `skillsbench-cli.md` — Current-byte built CLI discovery evidence for the SkillsBench command group (~350 tok)
- `skillsbench-manager.md` — Current-byte adversarial release transaction evidence for the user-scope SkillsBench manager (~550 tok)

## bin/

- `openwolf.ts` — Declares major (~97 tok)

## scripts/

- `skill-usage.py` — /*.jsonl for `Skill` tool_use records and prints (~1574 tok)
- `verify-install.js` — root: rel, fileExists, parseJson + 10 more (~5051 tok)

## src/buglog/

- `bug-matcher.ts` — Re-export from bug-tracker for convenience (~32 tok)
- `bug-tracker.ts` — Exports getBugLogPath, readBugLog, logBug, findSimilarBugs, searchBugs (~1265 tok)

## src/cli/

- `.wolf/qa/managed-skill-package-verifier.md` — Current-byte package/fresh-init verifier evidence for managed skill distribution and receipt hygiene (~450 tok)
- `.wolf/qa/managed-skill-update.md` — Current-byte falsification evidence for scoped update, atomic backups, review-history preservation, and restore symmetry (~500 tok)
- `bug-cmd.ts` — Exports bugSearch (~310 tok)
- `cerebrum-cmd.ts` — Exports lintCerebrum, cerebrumLint (~723 tok)
- `cron-cmd.ts` — Exports cronList, cronRun, cronRetry (~1448 tok)
- `daemon-cmd.ts` — Exports getPm2NameForRoot, hasPm2, Pm2ProcessInfo, listPm2Processes + 13 more (~4280 tok)
- `dashboard.ts` — Exports isExpectedDashboardHealth, dashboardCommand (~1171 tok)
- `designqc-cmd.ts` — Exports designqcCommand (~478 tok)
- `index.ts` — Exports createProgram (~2749 tok)
- `init.ts` — Exports initCommand; installs managed Claude skills and fresh hook/runtime payloads (~10700 tok)
- `managed-skills.ts` — Explicit ownership manifest plus install/backup/restore helpers for Wolfpack-managed Claude skill files (~450 tok)
- `nudge-cmd.ts` — Exports nudgeList, nudgeShow, nudgeResolve, nudgeDismiss, nudgeSnooze, nudgeStats (~1500 tok)
- `qa-cmd.ts` — Exports QaStatus, buildQaStatusReport, qaStatus (~1289 tok)
- `registry.ts` — Central registry of all OpenWolf-managed projects. (~1161 tok)
- `review-cmd.ts` — Exports reviewList, reviewShow, reviewHash, reviewComplete (~1646 tok)
- `scan.ts` — Exports scanCommand (~441 tok)
- `scientific-skills.ts` — Independent user-scope K-Dense scientific skills manager with staged releases, hashes, rollback, doctor checks, and weekly schedule (~4300 tok)
- `skillsbench.ts` — User-scope SkillsBench release manager: staged Git sync, plugin marketplace, hashes, rollback, and weekly schedule (~4300 tok)
- `status.ts` — Exports statusCommand (~1298 tok)
- `trace-cmd.ts` — Exports traceCommand (~887 tok)
- `update.ts` — openwolf update — Update all registered OpenWolf projects. (~6936 tok)

## src/config/

- `default-config.json` (~1876 tok)

## src/daemon/

- `cron-engine.ts` — Exports TaskRunResult, enqueueCronStateWrite, normalizeCronState, updateCronState + 4 more (~5343 tok)
- `file-watcher.ts` — Exports startFileWatcher (~678 tok)
- `health.ts` — Exports getHealth (~336 tok)
- `startup-guard.ts` — Exports shouldStartDaemonForProject (~101 tok)
- `wolf-daemon.ts` — API routes: GET (2 endpoints) (~6671 tok)

## src/dashboard/app/

- `App.tsx` — ProjectOverview — uses useState (~1212 tok)
- `index.html` — Wolfpack Dashboard (~159 tok)
- `main.tsx` — root (~76 tok)
- `vite.config.ts` — Vite build configuration (~132 tok)

## src/dashboard/app/components/layout/

- `Header.tsx` — Header (~254 tok)
- `Layout.tsx` — Layout (~60 tok)
- `Sidebar.tsx` — navItems (~1366 tok)

## src/dashboard/app/components/panels/

- `ActivityTimeline.tsx` — ActivityTimeline — uses useState, useMemo (~1385 tok)
- `AISuggestions.tsx` — sections (~843 tok)
- `AnatomyBrowser.tsx` — buildTree — uses useState, useMemo (~1663 tok)
- `BugLog.tsx` — BugLog — uses useState (~1604 tok)
- `CerebrumViewer.tsx` — CerebrumViewer — uses useState (~2169 tok)
- `CronStatus.tsx` — CronStatus — renders table — uses useState (~2121 tok)
- `DesignQC.tsx` — DesignQC (~793 tok)
- `MemoryViewer.tsx` — MemoryViewer — renders table — uses useState (~1350 tok)
- `ProjectOverview.tsx` — ProjectOverview (~1112 tok)
- `TokenUsage.tsx` — TokenUsage — renders chart (~1568 tok)

## src/dashboard/app/components/shared/

- `EmptyState.tsx` — EmptyState (~141 tok)
- `LiveIndicator.tsx` — LiveIndicator (~74 tok)
- `StatusBadge.tsx` — variants (~447 tok)
- `TokenBadge.tsx` — TokenBadge (~117 tok)

## src/dashboard/app/hooks/

- `useLiveUpdates.ts` — Exports useLiveUpdates (~109 tok)
- `useTheme.ts` — Exports Theme, useTheme (~202 tok)
- `useWolfData.ts` — Exports WolfData, useWolfData (~1637 tok)

## src/dashboard/app/lib/

- `file-parsers.ts` — Exports AnatomyEntry, MemorySession, CerebrumData, parseAnatomy + 2 more (~1048 tok)
- `utils.ts` — Exports cn, relativeTime, formatTokens, formatSchedule (~304 tok)
- `wolf-client.ts` — Exports openWolfAuthHeaders, WolfClient (~547 tok)

## src/dashboard/app/styles/

- `globals.css` — Styles: 12 rules, 46 vars, 1 animations (~771 tok)

## src/designqc/

- `designqc-capture.ts` — Capture a full page as sectioned viewport-height screenshots. (~2561 tok)
- `designqc-engine.ts` — Exports DesignQCEngine (~1707 tok)
- `designqc-types.ts` — Exports DesignQCOptions, Viewport, Screenshot, CaptureResult, DEFAULT_VIEWPORTS (~193 tok)

## src/hooks/

- `complete-review.js` — @ts-nocheck (~3470 tok)
- `complete-review.ts` — @ts-nocheck (~3426 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-read.ts` — @ts-nocheck (~793 tok)
- `post-write.js` — @ts-nocheck (~9924 tok)
- `post-write.ts` — Declares main (~10300 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-read.ts` — @ts-nocheck (~908 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `pre-write.ts` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2245 tok)
- `session-start.js` — Declares main (~1006 tok)
- `session-start.ts` — Declares main (~1309 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~17922 tok)
- `shared.ts` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~25068 tok)
- `stop.js` — Atomically claim a per-session nudge slot for the given counter field. (~26726 tok)
- `stop.ts` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37148 tok)

## src/hooks/nudges/

- `engine.js` — NudgeEngine: suppress → rank → budget → claim → emit; output budget + diagnostics (~1600 tok)
- `engine.ts` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~3693 tok)
- `project-scope.js` — resolveOwningProject/groupByOwner: attribute writes to nearest .wolf ancestor (~700 tok)
- `project-scope.ts` — Project ownership resolution. (~1181 tok)
- `state.js` — Fingerprints, dispositions, leased claims, lineage rounds, injectable io seam (~2600 tok)
- `state.ts` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7013 tok)

## src/hooks/nudges/rules/

- `cerebrum.js` — Project-scoped cerebrum freshness (content-hash baseline, mtime fallback) (~700 tok)
- `cerebrum.ts` — Cerebrum freshness rule — PROJECT-SCOPED. (~1328 tok)
- `conclusion.js` — Evidence-gated conclusion rule: prose AND target-hash mismatch (~900 tok)
- `conclusion.ts` — Conclusion / reduction gate — EVIDENCE-GATED. (~1824 tok)
- `review.js` — Review supersede, lineage round cap, risk-weighted thresholds (~1500 tok)
- `review.ts` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3575 tok)

## src/scanner/

- `anatomy-scanner.ts` — Scan the project and return the anatomy content and file count WITHOUT writing to disk. (~2598 tok)
- `description-extractor.ts` — ─── Known files ───────────────────────────────────────────── (~12506 tok)
- `project-root.ts` — Exports findProjectRoot (~260 tok)

## src/templates/

- `.gitignore` — Git ignore rules (~238 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `buglog.json` (~10 tok)
- `cerebrum.md` — Cerebrum (~164 tok)
- `claude-md-snippet.md` — Wolfpack (~74 tok)
- `claude-rules-openwolf.md` (~371 tok)
- `config.json` (~1876 tok)
- `cron-manifest.json` (~10 tok)
- `cron-state.json` (~38 tok)
- `designqc-report.json` (~26 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~4973 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)
- `reviewlog.json` (~11 tok)
- `suggestions.json` (~14 tok)
- `token-ledger.json` (~121 tok)

## src/templates/claude/skills/quality-reduction/

- `SKILL.md` — Managed template for falsifiable QA reductions and manifest-bound skill receipts (~1150 tok)

## src/templates/qa/

- `_gate-log.json` (~11 tok)
- `_README.md` — Quality Gate — Adversarial Reductions (~613 tok)
- `_template.md` — <short title> (~463 tok)

## src/tracker/

- `token-estimator.ts` — Exports ContentType, detectContentType, estimateTokens (~222 tok)
- `token-ledger.ts` — Exports getLedgerPath, readLedger, writeLedger, incrementSessions, addSessionToLedger (~993 tok)
- `waste-detector.ts` — Exports detectWaste (~1130 tok)

## src/utils/

- `fs-safe.js` — Exports readJSON, writeJSON, readText, writeText + 2 more (~790 tok)
- `fs-safe.ts` — Exports readJSON, tryWriteJSON, writeJSON, readText + 5 more (~1226 tok)
- `logger.js` — Exports Logger (~1118 tok)
- `logger.ts` — Exports LogLevel, LoggerRotation, Logger (~1138 tok)
- `paths.js` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~190 tok)
- `paths.ts` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~204 tok)
- `platform.js` — Exports isWindows, isMac, isLinux, whichCommand (~101 tok)
- `platform.ts` — Exports isWindows, isMac, isLinux, whichCommand (~99 tok)
- `port-allocator.js` — Exports deterministicBasePort, isPortFree, allocateProjectPorts (~307 tok)
- `port-allocator.ts` — @ts-nocheck (~312 tok)
- `size-discipline.js` — size-discipline.ts (~10030 tok)
- `size-discipline.ts` — size-discipline.ts (~10492 tok)

## templates/claude/

- `settings.json` (~508 tok)

## templates/claude/rules/

- `openwolf.md` (~371 tok)

## templates/wolf/

- `.gitignore` — Git ignore rules (~238 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `cerebrum.md` — Cerebrum (~164 tok)
- `config.json` (~1876 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~4500 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)

## templates/wolf/hooks/

- `complete-review.js` — @ts-nocheck (~3470 tok)
- `package.json` — Node.js package manifest (~7 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-write.js` — @ts-nocheck (~9924 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `session-start.js` — Declares main (~1006 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~17922 tok)
- `stop.js` — Atomically claim a per-session nudge slot for the given counter field. (~26726 tok)

## templates/wolf/qa/

- `_gate-log.json` (~11 tok)
- `_README.md` — Quality Gate — Adversarial Reductions (~613 tok)
- `_template.md` — <short title> (~463 tok)

## templates/wolf/utils/

- `fs-safe.js` — Exports readJSON, writeJSON, readText, writeText + 2 more (~790 tok)
- `logger.js` — Exports Logger (~1118 tok)
- `paths.js` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~190 tok)
- `platform.js` — Exports isWindows, isMac, isLinux, whichCommand (~101 tok)
- `port-allocator.js` — Exports deterministicBasePort, isPortFree, allocateProjectPorts (~307 tok)
- `size-discipline.js` — size-discipline.ts (~10030 tok)

## tests/

- `daemon-cmd.test.js` — Declares projectRoot (~1816 tok)
- `hook-packaging.test.js` — Hook packaging: every module a hook imports must actually ship. (~1113 tok)
- `nudge-engine.test.js` — 29 regression tests: ownership, convergence, dispositions, concurrency (real subprocesses), fault injection (~4200 tok)
- `qa-cmd.test.js` — sha256: fixture (~656 tok)
- `queue-watch.test.js` — repoRoot: removeOp, userTurn, injection, transcriptFixture (~2012 tok)
- `registry.test.js` — Tests for bug-440: malformed registry entries (missing root/name) must not (~1109 tok)
- `review-cmd.test.js` — repoRoot: fixture, sha256, manifestHash, runWolf (~1291 tok)
- `review-completion.test.js` — repoRoot: fixture, writeReviewLog, readReviewLog + 7 more (~19724 tok)
- `scientific-skills.test.js` — Temporary-HOME/local-Git fixture tests for the K-Dense scientific plugin, validation, rollback, and shell quoting (~1400 tok)
- `skill-deployment.test.js` — Disposable-project tests for managed skill init/update/dry-run/restore and utility ESM scope (~1700 tok)
- `skill-receipt.test.js` — Contract tests for canonical manifests, receipt validation, stale detection, and review compatibility (~1800 tok)
- `skillsbench.test.js` — Temporary-HOME/local-Git fixture tests for SkillsBench release, plugin isolation, rollback, and path rejection (~1300 tok)
- `trace-cerebrum-cmd.test.js` — Exports target (~852 tok)
