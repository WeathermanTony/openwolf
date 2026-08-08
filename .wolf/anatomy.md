# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-08-08T21:38:29.777Z
> Files: 215 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../home/tony/.claude/plans/

- `jaunty-splashing-globe.md` — Context (~2254 tok)

## ../../../../../tmp/

- `add-hook-ledger-bug.mjs` — Declares file (~509 tok)
- `normalize-ledger-rollout.mjs` — Declares cli (~1073 tok)

## ./

- `.editorconfig` — Editor configuration (~51 tok)
- `.gitignore` — Git ignore rules (~315 tok)
- `CLAUDE.md` — Wolfpack (~74 tok)
- `package-lock.json` — npm lock file (~69276 tok)
- `package.json` — Node.js package manifest (~578 tok)
- `README.md` — Project documentation (~752 tok)
- `tsconfig.json` — TypeScript configuration (~140 tok)
- `VERSION` (~5 tok)

## .claude/

- `settings.json` (~627 tok)

## .claude/rules/

- `openwolf.md` (~371 tok)

## .claude/skills/quality-reduction/

- `SKILL.md` — Quality Reduction (~1149 tok)

## .wolf/experiments/mem0-canary/

- `extractor.mjs` — Pure deterministic ADD-only unreviewed candidate extractor (~900 tok)
- `fixtures.json` — 48 protected synthetic explicit-learning and adversarial cases (~1500 tok)
- `manifest.json` — SHA-256 identities for protected evaluator inputs (~150 tok)
- `official-output.json` — Complete per-case official scorer evidence and metrics (~6000 tok)
- `rubric.json` — Offline conformance thresholds, allowed fields, and limitations (~250 tok)
- `scorer.mjs` — Manifest/schema validation, control/treatment scoring, and fail-closed verdicts (~1500 tok)

## .wolf/experiments/superpowers-canary/


## .wolf/qa/

- `hermes-agent-evaluation-2026-08-08.md` — Source-level Hermes Agent mechanism evaluation and no-integration disposition (~1260 tok)
- `hook-ledger-recurrence.md` — Real hook-runtime safe-suffix and atomic-persistence reduction (~430 tok)
- `mem0-canary-2026-08-08.md` — Protected offline fixture-conformance evidence, initial secret-filter falsification, fix, and survivor-for-design disposition (~1700 tok)
- `mem0-evaluation-2026-08-08.md` — Source-level Mem0 evaluation and bounded ADD-only candidate-extraction canary recommendation (~1400 tok)

## bin/

- `openwolf.ts` — Declares major (~97 tok)

## scripts/

- `skill-usage.py` — /*.jsonl for `Skill` tool_use records and prints (~1574 tok)
- `verify-install.js` — root: rel, fileExists, parseJson + 10 more (~5507 tok)

## src/buglog/

- `bug-matcher.ts` — Re-export from bug-tracker for convenience (~32 tok)
- `bug-tracker.ts` — Exports getBugLogPath, readBugLog, logBug, findSimilarBugs, searchBugs (~1463 tok)

## src/cli/

- `bug-cmd.ts` — Exports bugSearch (~310 tok)
- `cerebrum-cmd.ts` — Exports lintCerebrum, cerebrumLint (~723 tok)
- `cerebrum-record.ts` — @ts-nocheck (~1629 tok)
- `cron-cmd.ts` — Exports cronList, cronRun, cronRetry (~1448 tok)
- `daemon-cmd.ts` — Exports getPm2NameForRoot, hasPm2, Pm2ProcessInfo, listPm2Processes + 13 more (~4280 tok)
- `dashboard.ts` — Exports isExpectedDashboardHealth, dashboardCommand (~1171 tok)
- `designqc-cmd.ts` — Exports designqcCommand (~478 tok)
- `experiment-cmd.ts` — Exports validateExperiment, verifyExperimentRecord, startExperiment (~5690 tok)
- `index.ts` — Exports createProgram (~5906 tok)
- `init.ts` — Exports initCommand (~10936 tok)
- `ledger-cmd.ts` — Exports LedgerCommandOptions, ledgerAudit, ledgerRepair, ledgerNormalize, ledgerRecover (~1621 tok)
- `managed-skills.ts` — Exports MANAGED_CLAUDE_SKILL_FILES, installManagedClaudeSkills, backupManagedClaudeSkills, restoreManagedClaudeSkills (~727 tok)
- `nudge-cmd.ts` — `wolfpack nudge …` — explicit disposition commands. (~3106 tok)
- `qa-cmd.ts` — Exports QaStatus, buildQaStatusReport, qaStatus (~1289 tok)
- `registry.ts` — Central registry of all OpenWolf-managed projects. (~1161 tok)
- `review-cmd.ts` — Exports reviewList, reviewShow, reviewHash, reviewComplete (~1730 tok)
- `scan.ts` — Exports scanCommand (~441 tok)
- `scientific-skills.ts` — Exports ScientificSkillsConfig, DEFAULT_SCIENTIFIC_SKILLS_CONFIG, hashDirectory (~5805 tok)
- `skillsbench.ts` — Exports SkillsBenchConfig, DEFAULT_SKILLSBENCH_CONFIG, hashDirectory (~5653 tok)
- `status.ts` — Exports statusCommand (~1298 tok)
- `trace-cmd.ts` — Exports traceCommand (~1271 tok)
- `update.ts` — openwolf update — Update all registered OpenWolf projects. (~7186 tok)

## src/config/

- `default-config.json` (~2041 tok)

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

- `complete-review.js` — usage: parseArgs, fail, classifyDrift, formatReviewStaleMessage, markSupersededPendingReviews (~3866 tok)
- `complete-review.ts` — usage: parseArgs, fail, classifyDrift, formatReviewStaleMessage, markSupersededPendingReviews (~3982 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-read.ts` — @ts-nocheck (~793 tok)
- `post-write.js` — Declares main (~10337 tok)
- `post-write.ts` — Declares main (~10326 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-read.ts` — @ts-nocheck (~908 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `pre-write.ts` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2245 tok)
- `session-start.js` — @ts-nocheck (~1309 tok)
- `session-start.ts` — @ts-nocheck (~1309 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~28790 tok)
- `shared.ts` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~28830 tok)
- `stop.js` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37529 tok)
- `stop.ts` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37451 tok)

## src/hooks/nudges/

- `engine.js` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~3709 tok)
- `engine.ts` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~3793 tok)
- `project-scope.js` — Project ownership resolution. (~1181 tok)
- `project-scope.ts` — Project ownership resolution. (~1181 tok)
- `state.js` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7315 tok)
- `state.ts` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7208 tok)

## src/hooks/nudges/rules/

- `cerebrum.js` — Cerebrum freshness rule — PROJECT-SCOPED. (~1305 tok)
- `cerebrum.ts` — Cerebrum freshness rule — PROJECT-SCOPED. (~1328 tok)
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1868 tok)
- `conclusion.ts` — Conclusion / reduction gate — EVIDENCE-GATED. (~1824 tok)
- `learning.js` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1260 tok)
- `learning.ts` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1226 tok)
- `review.js` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3597 tok)
- `review.ts` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3575 tok)

## src/ledger/

- `ledger-integrity.ts` — Exports LedgerKind, LedgerClassification, LedgerRecord, LedgerAudit + 14 more (~9089 tok)

## src/scanner/

- `anatomy-scanner.ts` — Scan the project and return the anatomy content and file count WITHOUT writing to disk. (~2598 tok)
- `description-extractor.ts` — ─── Known files ───────────────────────────────────────────── (~12506 tok)
- `project-root.ts` — Exports findProjectRoot (~260 tok)

## src/templates/

- `.gitignore` — Git ignore rules (~278 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `buglog.json` (~10 tok)
- `cerebrum.md` — Cerebrum (~184 tok)
- `claude-md-snippet.md` — Wolfpack (~74 tok)
- `claude-rules-openwolf.md` (~371 tok)
- `config.json` (~2041 tok)
- `cron-manifest.json` (~10 tok)
- `cron-state.json` (~38 tok)
- `designqc-report.json` (~26 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~5375 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)
- `reviewlog.json` (~11 tok)
- `suggestions.json` (~14 tok)
- `token-ledger.json` (~121 tok)

## src/templates/claude/skills/quality-reduction/

- `SKILL.md` — Quality Reduction (~1149 tok)

## src/templates/qa/

- `_gate-log.json` (~11 tok)
- `_README.md` — Quality Gate — Adversarial Reductions (~613 tok)
- `_template.md` — <short title> (~552 tok)

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
- `size-discipline.js` — size-discipline.ts (~10630 tok)
- `size-discipline.ts` — size-discipline.ts (~10598 tok)

## templates/claude/

- `settings.json` (~508 tok)

## templates/claude/rules/

- `openwolf.md` (~371 tok)

## templates/wolf/

- `.gitignore` — Git ignore rules (~278 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `cerebrum.md` — Cerebrum (~184 tok)
- `config.json` (~2041 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~5375 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)

## templates/wolf/hooks/

- `complete-review.js` — usage: parseArgs, fail, classifyDrift, formatReviewStaleMessage, markSupersededPendingReviews (~4034 tok)
- `package.json` — Node.js package manifest (~7 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-write.js` — Declares main (~10337 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `session-start.js` — @ts-nocheck (~1309 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~28790 tok)
- `stop.js` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37529 tok)

## templates/wolf/hooks/nudges/

- `engine.js` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~3709 tok)
- `project-scope.js` — Project ownership resolution. (~1181 tok)
- `state.js` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7315 tok)

## templates/wolf/hooks/nudges/rules/

- `cerebrum.js` — Cerebrum freshness rule — PROJECT-SCOPED. (~1305 tok)
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1868 tok)
- `learning.js` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1260 tok)
- `review.js` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3597 tok)

## templates/wolf/qa/

- `_gate-log.json` (~11 tok)
- `_README.md` — Quality Gate — Adversarial Reductions (~613 tok)
- `_template.md` — <short title> (~538 tok)

## templates/wolf/utils/

- `fs-safe.js` — Exports readJSON, writeJSON, readText, writeText + 2 more (~790 tok)
- `logger.js` — Exports Logger (~1118 tok)
- `paths.js` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~190 tok)
- `platform.js` — Exports isWindows, isMac, isLinux, whichCommand (~101 tok)
- `port-allocator.js` — Exports deterministicBasePort, isPortFree, allocateProjectPorts (~307 tok)
- `size-discipline.js` — size-discipline.ts (~10630 tok)

## tests/

- `daemon-cmd.test.js` — Declares projectRoot (~1816 tok)
- `experiment-cmd.test.js` — project: inProject (~2898 tok)
- `hook-packaging.test.js` — Hook packaging: every module a hook imports must actually ship. (~1113 tok)
- `learning-capture.test.js` — root: fixture, transcript (~2450 tok)
- `ledger-integrity.test.js` — LEDGER: project, write, hash, fresh (~3541 tok)
- `ledger-writer-safety.test.js` — fixture: entry (~649 tok)
- `mem0-canary.test.js` — root: score, clone (~1914 tok)
- `nudge-engine.test.js` — Regression suite for the evidence-addressed nudge engine. (~13866 tok)
- `qa-cmd.test.js` — sha256: fixture (~656 tok)
- `queue-watch.test.js` — repoRoot: removeOp, userTurn, injection, transcriptFixture (~2012 tok)
- `registry.test.js` — Tests for bug-440: malformed registry entries (missing root/name) must not (~1109 tok)
- `review-cmd.test.js` — repoRoot: fixture, sha256, manifestHash, runWolf (~1291 tok)
- `review-completion.test.js` — repoRoot: fixture, writeReviewLog, readReviewLog + 8 more (~20888 tok)
- `scientific-skills.test.js` — root: git, run, fixture + 3 more (~2783 tok)
- `skill-deployment.test.js` — root: fixture, runCli, seedProject, seedRegistry (~2396 tok)
- `skill-receipt.test.js` — sha256: fixture (~2614 tok)
- `skillsbench.test.js` — root: git, run, fixture + 3 more (~2861 tok)
- `superpowers-canary.test.js` — Declares root (~576 tok)
- `trace-cerebrum-cmd.test.js` — Exports target (~852 tok)
- `update-source-exclusion.test.js` — Declares root (~227 tok)
