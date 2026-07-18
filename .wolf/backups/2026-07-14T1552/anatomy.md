# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-07-14T14:19:34.729Z
> Files: 153 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.editorconfig` — Editor configuration (~51 tok)
- `.gitignore` — Git ignore rules (~252 tok)
- `CLAUDE.md` — Wolfpack (~74 tok)
- `package-lock.json` — npm lock file (~69275 tok)
- `package.json` — Node.js package manifest (~577 tok)
- `README.md` — Project documentation (~504 tok)
- `tsconfig.json` — TypeScript configuration (~140 tok)
- `VERSION` (~4 tok)

## .claude/

- `settings.json` (~627 tok)

## .claude/rules/

- `openwolf.md` (~371 tok)

## bin/

- `openwolf.ts` — Declares major (~97 tok)

## scripts/

- `verify-install.js` — root: rel, fileExists, parseJson + 13 more (~4386 tok)

## src/buglog/

- `bug-matcher.ts` — Re-export from bug-tracker for convenience (~32 tok)
- `bug-tracker.ts` — Exports getBugLogPath, readBugLog, logBug, findSimilarBugs, searchBugs (~1265 tok)

## src/cli/

- `bug-cmd.ts` — Exports bugSearch (~310 tok)
- `cerebrum-cmd.ts` — Exports lintCerebrum, cerebrumLint (~723 tok)
- `cron-cmd.ts` — Exports cronList, cronRun, cronRetry (~1448 tok)
- `daemon-cmd.ts` — Exports getPm2NameForRoot, hasPm2, isActivePm2Process, hasOpenWolfPm2Daemon + 5 more (~3394 tok)
- `dashboard.ts` — Exports dashboardCommand (~816 tok)
- `designqc-cmd.ts` — Exports designqcCommand (~478 tok)
- `index.ts` — Exports createProgram (~2259 tok)
- `init.ts` — Exports initCommand (~9455 tok)
- `qa-cmd.ts` — Exports QaStatus, buildQaStatusReport, qaStatus (~1289 tok)
- `registry.ts` — Central registry of all OpenWolf-managed projects. (~852 tok)
- `review-cmd.ts` — Exports reviewList, reviewShow, reviewHash, reviewComplete (~1646 tok)
- `scan.ts` — Exports scanCommand (~441 tok)
- `status.ts` — Exports statusCommand (~1067 tok)
- `trace-cmd.ts` — Exports traceCommand (~887 tok)
- `update.ts` — openwolf update — Update all registered OpenWolf projects. (~6012 tok)

## src/config/

- `default-config.json` (~1306 tok)

## src/daemon/

- `cron-engine.ts` — Exports TaskRunResult, enqueueCronStateWrite, normalizeCronState, updateCronState + 4 more (~5343 tok)
- `file-watcher.ts` — Exports startFileWatcher (~678 tok)
- `health.ts` — Exports getHealth (~336 tok)
- `startup-guard.ts` — Exports shouldStartDaemonForProject (~101 tok)
- `wolf-daemon.ts` — API routes: GET (2 endpoints) (~6280 tok)

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

- `complete-review.js` — @ts-nocheck (~3493 tok)
- `complete-review.ts` — @ts-nocheck (~3448 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-read.ts` — @ts-nocheck (~793 tok)
- `post-write.js` — @ts-nocheck (~9924 tok)
- `post-write.ts` — @ts-nocheck (~9913 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-read.ts` — @ts-nocheck (~908 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `pre-write.ts` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2245 tok)
- `session-start.js` — Declares main (~1006 tok)
- `session-start.ts` — @ts-nocheck (~998 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~17262 tok)
- `shared.ts` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~17674 tok)
- `stop.js` — Atomically claim a per-session nudge slot for the given counter field. (~24834 tok)
- `stop.ts` — Atomically claim a per-session nudge slot for the given counter field. (~25694 tok)

## src/scanner/

- `anatomy-scanner.ts` — Scan the project and return the anatomy content and file count WITHOUT writing to disk. (~2598 tok)
- `description-extractor.ts` — ─── Known files ───────────────────────────────────────────── (~12506 tok)
- `project-root.ts` — Exports findProjectRoot (~260 tok)

## src/templates/

- `anatomy.md` — anatomy.md (~54 tok)
- `buglog.json` (~10 tok)
- `cerebrum.md` — Cerebrum (~164 tok)
- `claude-md-snippet.md` — Wolfpack (~74 tok)
- `claude-rules-openwolf.md` (~371 tok)
- `config.json` (~1306 tok)
- `cron-manifest.json` (~10 tok)
- `cron-state.json` (~38 tok)
- `designqc-report.json` (~26 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~3758 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)
- `reviewlog.json` (~11 tok)
- `suggestions.json` (~14 tok)
- `token-ledger.json` (~121 tok)

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
- `fs-safe.ts` — Exports readJSON, tryWriteJSON, writeJSON, readText + 4 more (~836 tok)
- `logger.js` — Exports Logger (~1118 tok)
- `logger.ts` — Exports LogLevel, LoggerRotation, Logger (~1138 tok)
- `paths.js` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~190 tok)
- `paths.ts` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~204 tok)
- `platform.js` — Exports isWindows, isMac, isLinux, whichCommand (~101 tok)
- `platform.ts` — Exports isWindows, isMac, isLinux, whichCommand (~99 tok)
- `port-allocator.js` — Exports deterministicBasePort, isPortFree, allocateProjectPorts (~307 tok)
- `port-allocator.ts` — @ts-nocheck (~312 tok)
- `size-discipline.js` — size-discipline.ts (~10030 tok)
- `size-discipline.ts` — size-discipline.ts (~10022 tok)

## templates/claude/

- `settings.json` (~508 tok)

## templates/claude/rules/

- `openwolf.md` (~371 tok)

## templates/wolf/

- `anatomy.md` — anatomy.md (~54 tok)
- `cerebrum.md` — Cerebrum (~164 tok)
- `config.json` (~1306 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~3758 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)

## templates/wolf/hooks/

- `complete-review.js` — @ts-nocheck (~3493 tok)
- `package.json` — Node.js package manifest (~7 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-write.js` — @ts-nocheck (~9924 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `session-start.js` — Declares main (~1006 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~17262 tok)
- `stop.js` — Atomically claim a per-session nudge slot for the given counter field. (~24834 tok)

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

- `daemon-cmd.test.js` — Declares dir (~554 tok)
- `qa-cmd.test.js` — sha256: fixture (~656 tok)
- `review-cmd.test.js` — repoRoot: fixture, sha256, manifestHash, runWolf (~1291 tok)
- `review-completion.test.js` — repoRoot: fixture, writeReviewLog, readReviewLog + 6 more (~5505 tok)
- `trace-cerebrum-cmd.test.js` — Exports target (~852 tok)
