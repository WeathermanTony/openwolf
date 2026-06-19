# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-06-19T16:00:03.586Z
> Files: 142 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.editorconfig` — Editor configuration (~51 tok)
- `.gitignore` — Git ignore rules (~252 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `OPENWOLF-ISSUES-from-stress-test.md` — OpenWolf Issues & Suggestions — found via live stress-testing (~3958 tok)
- `package-lock.json` — npm lock file (~69262 tok)
- `package.json` — Node.js package manifest (~562 tok)
- `README.md` — Project documentation (~341 tok)
- `tsconfig.json` — TypeScript configuration (~140 tok)
- `VERSION` (~4 tok)

## .claude/

- `settings.json` (~627 tok)

## .claude/rules/

- `openwolf.md` (~371 tok)

## bin/

- `openwolf.ts` — Declares major (~97 tok)

## scripts/

- `verify-install.js` — root: rel, fileExists, parseJson + 7 more (~2569 tok)

## src/buglog/

- `bug-matcher.ts` — Re-export from bug-tracker for convenience (~32 tok)
- `bug-tracker.ts` — Exports getBugLogPath, readBugLog, logBug, findSimilarBugs, searchBugs (~993 tok)

## src/cli/

- `bug-cmd.ts` — Exports bugSearch (~310 tok)
- `cron-cmd.ts` — Exports cronList, cronRun, cronRetry (~1448 tok)
- `daemon-cmd.ts` — Exports getPm2NameForRoot, hasPm2, hasOpenWolfPm2Daemon, ensurePm2Daemon + 4 more (~3363 tok)
- `dashboard.ts` — Exports dashboardCommand (~816 tok)
- `designqc-cmd.ts` — Exports designqcCommand (~478 tok)
- `index.ts` — Exports createProgram (~1452 tok)
- `init.ts` — Exports initCommand (~7788 tok)
- `registry.ts` — Central registry of all OpenWolf-managed projects. (~852 tok)
- `scan.ts` — Exports scanCommand (~441 tok)
- `status.ts` — Exports statusCommand (~1067 tok)
- `update.ts` — openwolf update — Update all registered OpenWolf projects. (~5310 tok)

## src/config/

- `default-config.json` (~1296 tok)

## src/daemon/

- `cron-engine.ts` — Exports TaskRunResult, enqueueCronStateWrite, normalizeCronState, updateCronState + 4 more (~5343 tok)
- `file-watcher.ts` — Exports startFileWatcher (~678 tok)
- `health.ts` — Exports getHealth (~336 tok)
- `wolf-daemon.ts` — API routes: GET (2 endpoints) (~6101 tok)

## src/dashboard/app/

- `App.tsx` — ProjectOverview — uses useState (~1212 tok)
- `index.html` — OpenWolf Dashboard (~159 tok)
- `main.tsx` — root (~76 tok)
- `vite.config.ts` — Vite build configuration (~132 tok)

## src/dashboard/app/components/layout/

- `Header.tsx` — Header (~254 tok)
- `Layout.tsx` — Layout (~60 tok)
- `Sidebar.tsx` — navItems (~1391 tok)

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

- `complete-review.js` — @ts-nocheck (~1861 tok)
- `complete-review.ts` — @ts-nocheck (~1852 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-read.ts` — @ts-nocheck (~793 tok)
- `post-write.js` — Declares main (~9825 tok)
- `post-write.ts` — @ts-nocheck (~9818 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-read.ts` — @ts-nocheck (~908 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `pre-write.ts` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2245 tok)
- `session-start.js` — Declares main (~1006 tok)
- `session-start.ts` — @ts-nocheck (~998 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~15253 tok)
- `shared.ts` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~15245 tok)
- `stop.js` — Atomically claim a per-session nudge slot for the given counter field. (~22580 tok)
- `stop.ts` — Atomically claim a per-session nudge slot for the given counter field. (~22572 tok)

## src/scanner/

- `anatomy-scanner.ts` — Scan the project and return the anatomy content and file count WITHOUT writing to disk. (~2598 tok)
- `description-extractor.ts` — ─── Known files ───────────────────────────────────────────── (~12506 tok)
- `project-root.ts` — Exports findProjectRoot (~260 tok)

## src/templates/

- `anatomy.md` — anatomy.md (~1236 tok)
- `buglog.json` — /*.lock`, and `.wolf/**/*.lock.reclaim`; expanded `scripts/verify-install.js` to assert those ignores and syntax-check installed, source, and templ... (~13194 tok)
- `cerebrum.md` — Cerebrum (~930 tok)
- `claude-md-snippet.md` — OpenWolf (~57 tok)
- `claude-rules-openwolf.md` (~371 tok)
- `config.json` (~1296 tok)
- `cron-manifest.json` (~927 tok)
- `cron-state.json` (~511 tok)
- `designqc-report.json` (~26 tok)
- `identity.md` — Identity (~89 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — OpenWolf Operating Protocol (~3134 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)
- `reviewlog.json` (~14302 tok)
- `suggestions.json` (~14 tok)
- `token-ledger.json` (~126062 tok)

## src/templates/qa/

- `_gate-log.json` (~11747 tok)
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

- `anatomy.md` — anatomy.md (~501 tok)
- `cerebrum.md` — Cerebrum (~156 tok)
- `config.json` (~1296 tok)
- `identity.md` — Identity (~89 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — OpenWolf Operating Protocol (~3134 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)

## templates/wolf/hooks/

- `complete-review.js` — @ts-nocheck (~1861 tok)
- `package.json` — Node.js package manifest (~7 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-write.js` — Declares main (~9825 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `session-start.js` — Declares main (~1006 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~15253 tok)
- `stop.js` — Atomically claim a per-session nudge slot for the given counter field. (~22580 tok)

## templates/wolf/qa/

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

- `review-completion.test.js` — Exports feature (~3242 tok)
