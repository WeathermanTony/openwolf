# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-10-07T18:17:22.330Z
> Files: 468 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../tmp/

- `latest-additions-recurrence-probe.mjs` — repository: digestInputs, latestSession, categorize (~2731 tok)
- `wolf-nudge-live-20261006.mjs` — root: local, execute, worker (~1892 tok)
- `wolf-nudge-verify-20261006.mjs` — Declares root (~962 tok)
- `wolfpack-latest-recall-evaluation.mjs` — /.wolf/OPENWOLF.md";'}, (~2321 tok)

## ../rag/.wolf/canaries/nudge-qualification-2026-10-05-v2/

- `canary.mjs` — API routes: GET (1 endpoints) (~5279 tok)

## ../rag/.wolf/canaries/nudge-qualification-2026-10-05/

- `canary.mjs` — API routes: GET (1 endpoints) (~3756 tok)
- `cases.json` — Declares normalization (~1376 tok)
- `manifest.json` (~285 tok)
- `preflight.json` (~462 tok)
- `protocol.md` — Wolfpack offline qualification canary — RAG (~1777 tok)

## ../rag/.wolf/qa/

- `nudge-qualification-canary.md` — Offline optional-advisory qualification: repaired v2 setup (~2099 tok)

## ./

- `.editorconfig` — Editor configuration (~51 tok)
- `.gitignore` — Git ignore rules (~315 tok)
- `package-lock.json` (~69276 tok)
- `package.json` — Node.js package manifest (~584 tok)
- `README.md` — Project documentation (~752 tok)
- `tsconfig.json` — TypeScript configuration (~140 tok)
- `VERSION` (~5 tok)

## .claude/

- `settings.json` — Declares p (~827 tok)

## .claude/skills/quality-reduction/

- `SKILL.md` — Quality Reduction (~1149 tok)

## .claude/worktrees/wolfpack-quiet-modernization/

- `.editorconfig` — Editor configuration (~51 tok)
- `.gitignore` — Git ignore rules (~315 tok)
- `CLAUDE.md` — Wolfpack (~74 tok)
- `package-lock.json` — npm lock file (~69276 tok)
- `package.json` — Node.js package manifest (~578 tok)
- `README.md` — Project documentation (~752 tok)
- `tsconfig.json` — TypeScript configuration (~140 tok)
- `VERSION` (~5 tok)

## .claude/worktrees/wolfpack-quiet-modernization/.claude/

- `settings.json` (~627 tok)

## .claude/worktrees/wolfpack-quiet-modernization/.claude/rules/

- `openwolf.md` (~371 tok)

## .claude/worktrees/wolfpack-quiet-modernization/.claude/skills/quality-reduction/

- `SKILL.md` — Quality Reduction (~1149 tok)

## .claude/worktrees/wolfpack-quiet-modernization/bin/

- `openwolf.ts` — Declares major (~97 tok)

## .claude/worktrees/wolfpack-quiet-modernization/docs/

- `blast-radius.md` — Blast-Radius Checklist (defense-layer changes) (~826 tok)
- `receipt-hash-interop.md` — Proposal: receipt-hash interop for cross-provider review verification (~1399 tok)

## .claude/worktrees/wolfpack-quiet-modernization/scripts/

- `skill-usage.py` — /*.jsonl for `Skill` tool_use records and prints (~1574 tok)
- `verify-fleet-section.mjs` — /.wolf/OPENWOLF.md`, which reports success (~1514 tok)
- `verify-install.js` — root: rel, fileExists, parseJson + 10 more (~5593 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/ai/

- `claude-cli-summarizer.ts` — Exports SummarizeSource, SummarizeRequest, SummarizeResult, Summarizer, ClaudeCliSummarizer (~889 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/buglog/

- `bug-matcher.ts` — Re-export from bug-tracker for convenience (~32 tok)
- `bug-tracker.ts` — Exports getBugLogPath, readBugLog, logBug, findSimilarBugs, searchBugs (~1532 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/cli/

- `bug-cmd.ts` — Exports bugSearch (~310 tok)
- `cerebrum-cmd.ts` — Exports lintCerebrum, cerebrumLint (~723 tok)
- `cerebrum-record.ts` — @ts-nocheck (~1629 tok)
- `compact-cmd.ts` — Exports CompactProtection, CompactSurfacePlan, CompactProjectPlan, CompactManifest + 2 more (~8848 tok)
- `cron-cmd.ts` — Exports cronList, cronRun, cronRetry (~1448 tok)
- `daemon-cmd.ts` — Exports getPm2NameForRoot, hasPm2, Pm2ProcessInfo, isPm2DaemonPidAlive + 12 more (~4537 tok)
- `dashboard.ts` — Exports isExpectedDashboardHealth, dashboardCommand (~1171 tok)
- `designqc-cmd.ts` — Exports designqcCommand (~478 tok)
- `drift-cmd.ts` — `openwolf foo`, `wolfpack foo bar` — captures the first subcommand token only. (~4067 tok)
- `experiment-cmd.ts` — @ts-nocheck (~7228 tok)
- `index.ts` — Exports createProgram (~6812 tok)
- `init.ts` — Exports initCommand (~10837 tok)
- `instruction-consolidation.ts` — Exports ClaudeMdClassification, ClaudeMdPlan, planClaudeMd, mergeGlobalContract + 5 more (~4249 tok)
- `ledger-cmd.ts` — Exports LedgerCommandOptions, ledgerAudit, ledgerRepair, ledgerNormalize, ledgerRecover (~1621 tok)
- `managed-payload.ts` — Exports MANAGED_TEMPLATE_FILES, CREATE_IF_MISSING_FILES, MANAGED_HOOK_FILES, MANAGED_RUNTIME_UTILITIES + 9 more (~2512 tok)
- `managed-skills.ts` — Exports MANAGED_CLAUDE_SKILL_FILES, installManagedClaudeSkills, backupManagedClaudeSkills, restoreManagedClaudeSkills (~727 tok)
- `nudge-cmd.ts` — `wolfpack nudge …` — explicit disposition commands. (~3606 tok)
- `qa-cmd.ts` — Exports QaStatus, buildQaStatusReport, qaStatus (~1289 tok)
- `registry.ts` — Central registry of all OpenWolf-managed projects. (~1666 tok)
- `review-cmd.ts` — Exports reviewList, reviewShow, reviewHash, reviewComplete (~1843 tok)
- `scan.ts` — Exports scanCommand (~441 tok)
- `scientific-skills.ts` — Exports ScientificSkillsConfig, DEFAULT_SCIENTIFIC_SKILLS_CONFIG, hashDirectory (~5805 tok)
- `skillsbench.ts` — Exports SkillsBenchConfig, DEFAULT_SKILLSBENCH_CONFIG, hashDirectory, providerWordingHits, extractDescription (~6503 tok)
- `status.ts` — Exports statusCommand (~2000 tok)
- `trace-cmd.ts` — Exports traceCommand (~1271 tok)
- `update.ts` — openwolf update — Update all registered OpenWolf projects. (~10058 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/config/

- `default-config.json` (~2188 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/daemon/

- `cron-engine.ts` — Exports TaskRunResult, enqueueCronStateWrite, normalizeCronState, updateCronState + 4 more (~5005 tok)
- `file-watcher.ts` — Exports startFileWatcher (~678 tok)
- `health.ts` — Exports getHealth (~336 tok)
- `startup-guard.ts` — Exports shouldStartDaemonForProject (~101 tok)
- `wolf-daemon.ts` — API routes: GET (2 endpoints) (~6671 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/dashboard/app/

- `App.tsx` — ProjectOverview — uses useState (~1212 tok)
- `index.html` — Wolfpack Dashboard (~159 tok)
- `main.tsx` — root (~76 tok)
- `vite.config.ts` — Vite build configuration (~132 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/dashboard/app/components/layout/

- `Header.tsx` — Header (~254 tok)
- `Layout.tsx` — Layout (~60 tok)
- `Sidebar.tsx` — navItems (~1366 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/dashboard/app/components/panels/

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

## .claude/worktrees/wolfpack-quiet-modernization/src/dashboard/app/components/shared/

- `EmptyState.tsx` — EmptyState (~141 tok)
- `LiveIndicator.tsx` — LiveIndicator (~74 tok)
- `StatusBadge.tsx` — variants (~447 tok)
- `TokenBadge.tsx` — TokenBadge (~117 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/dashboard/app/hooks/

- `useLiveUpdates.ts` — Exports useLiveUpdates (~109 tok)
- `useTheme.ts` — Exports Theme, useTheme (~202 tok)
- `useWolfData.ts` — Exports WolfData, useWolfData (~1637 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/dashboard/app/lib/

- `file-parsers.ts` — Exports AnatomyEntry, MemorySession, CerebrumData, parseAnatomy + 2 more (~1048 tok)
- `utils.ts` — Exports cn, relativeTime, formatTokens, formatSchedule (~304 tok)
- `wolf-client.ts` — Exports openWolfAuthHeaders, WolfClient (~547 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/dashboard/app/styles/

- `globals.css` — Styles: 12 rules, 46 vars, 1 animations (~771 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/designqc/

- `designqc-capture.ts` — Capture a full page as sectioned viewport-height screenshots. (~2561 tok)
- `designqc-engine.ts` — Exports DesignQCEngine (~1707 tok)
- `designqc-types.ts` — Exports DesignQCOptions, Viewport, Screenshot, CaptureResult, DEFAULT_VIEWPORTS (~193 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/hooks/

- `complete-review.js` — @ts-nocheck (~3866 tok)
- `complete-review.ts` — @ts-nocheck (~3982 tok)
- `post-read.js` — @ts-nocheck (~829 tok)
- `post-read.ts` — @ts-nocheck (~818 tok)
- `post-write.js` — @ts-nocheck (~9535 tok)
- `post-write.ts` — @ts-nocheck (~9524 tok)
- `pre-read.js` — @ts-nocheck (~944 tok)
- `pre-read.ts` — @ts-nocheck (~934 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2281 tok)
- `pre-write.ts` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2270 tok)
- `session-start.js` — @ts-nocheck (~1346 tok)
- `session-start.ts` — @ts-nocheck (~1335 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~29785 tok)
- `shared.ts` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~29713 tok)
- `stop.js` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37692 tok)
- `stop.ts` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37605 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/hooks/nudges/

- `engine.js` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~4545 tok)
- `engine.ts` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~4555 tok)
- `project-scope.js` — Project ownership resolution. (~1181 tok)
- `project-scope.ts` — Project ownership resolution. (~1181 tok)
- `state.js` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7574 tok)
- `state.ts` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7475 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/hooks/nudges/rules/

- `cerebrum.js` — Cerebrum freshness rule — PROJECT-SCOPED. (~1400 tok)
- `cerebrum.ts` — Cerebrum freshness rule — PROJECT-SCOPED. (~1400 tok)
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1980 tok)
- `conclusion.ts` — Conclusion / reduction gate — EVIDENCE-GATED. (~1951 tok)
- `learning.js` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1761 tok)
- `learning.ts` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1735 tok)
- `review.js` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3784 tok)
- `review.ts` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3762 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/ledger/

- `ledger-integrity.ts` — Exports LedgerKind, LedgerClassification, LedgerRecord, LedgerAudit + 13 more (~10781 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/scanner/

- `anatomy-scanner.ts` — Scan the project and return the anatomy content and file count WITHOUT writing to disk. (~2598 tok)
- `description-extractor.ts` — ─── Known files ───────────────────────────────────────────── (~12506 tok)
- `project-root.ts` — Exports findProjectRoot (~260 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/templates/

- `.gitignore` — Git ignore rules (~278 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `buglog.json` (~10 tok)
- `cerebrum.md` — Cerebrum (~184 tok)
- `claude-rules-openwolf.md` (~371 tok)
- `config.json` (~2188 tok)
- `cron-manifest.json` (~10 tok)
- `cron-state.json` (~38 tok)
- `designqc-report.json` (~26 tok)
- `global-claude-wolfpack.md` — WolfPack-managed projects (~308 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — WolfPack Reference (~439 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)
- `reviewlog.json` (~11 tok)
- `suggestions.json` (~14 tok)
- `token-ledger.json` (~121 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/templates/claude/skills/quality-reduction/

- `SKILL.md` — Quality Reduction (~1149 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/templates/qa/

- `_gate-log.json` (~11 tok)
- `_README.md` — Quality Gate — Adversarial Reductions (~613 tok)
- `_template.md` — <short title> (~1111 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/tracker/

- `token-estimator.ts` — Exports ContentType, detectContentType, estimateTokens (~222 tok)
- `token-ledger.ts` — Exports getLedgerPath, readLedger, writeLedger, incrementSessions, addSessionToLedger (~993 tok)
- `waste-detector.ts` — Exports detectWaste (~1130 tok)

## .claude/worktrees/wolfpack-quiet-modernization/src/utils/

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

## .claude/worktrees/wolfpack-quiet-modernization/templates/claude/

- `settings.json` (~508 tok)

## .claude/worktrees/wolfpack-quiet-modernization/templates/claude/rules/

- `openwolf.md` (~371 tok)

## .claude/worktrees/wolfpack-quiet-modernization/templates/wolf/

- `.gitignore` — Git ignore rules (~278 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `cerebrum.md` — Cerebrum (~184 tok)
- `config.json` (~2188 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — WolfPack Reference (~439 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)

## .claude/worktrees/wolfpack-quiet-modernization/templates/wolf/hooks/

- `complete-review.js` — @ts-nocheck (~4034 tok)
- `package.json` — Node.js package manifest (~7 tok)
- `post-read.js` — @ts-nocheck (~829 tok)
- `post-write.js` — @ts-nocheck (~9535 tok)
- `pre-read.js` — @ts-nocheck (~944 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2281 tok)
- `session-start.js` — @ts-nocheck (~1346 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~29785 tok)
- `stop.js` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37692 tok)

## .claude/worktrees/wolfpack-quiet-modernization/templates/wolf/hooks/nudges/

- `engine.js` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~4545 tok)
- `project-scope.js` — Project ownership resolution. (~1181 tok)
- `state.js` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7574 tok)

## .claude/worktrees/wolfpack-quiet-modernization/templates/wolf/hooks/nudges/rules/

- `cerebrum.js` — Cerebrum freshness rule — PROJECT-SCOPED. (~1400 tok)
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1980 tok)
- `learning.js` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1761 tok)
- `review.js` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3784 tok)

## .claude/worktrees/wolfpack-quiet-modernization/templates/wolf/qa/

- `_gate-log.json` (~11 tok)
- `_README.md` — Quality Gate — Adversarial Reductions (~613 tok)
- `_template.md` — <short title> (~552 tok)

## .claude/worktrees/wolfpack-quiet-modernization/templates/wolf/utils/

- `fs-safe.js` — Exports readJSON, writeJSON, readText, writeText + 2 more (~790 tok)
- `logger.js` — Exports Logger (~1118 tok)
- `paths.js` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~190 tok)
- `platform.js` — Exports isWindows, isMac, isLinux, whichCommand (~101 tok)
- `port-allocator.js` — Exports deterministicBasePort, isPortFree, allocateProjectPorts (~307 tok)
- `size-discipline.js` — size-discipline.ts (~10630 tok)

## .claude/worktrees/wolfpack-quiet-modernization/tests/

- `behavior-mode.test.js` — Exports value, value (~1781 tok)
- `compact-cmd.test.js` — fixture: withHome (~2976 tok)
- `daemon-cmd.test.js` — Declares root (~2946 tok)
- `drift-cmd.test.js` — Minimal Wolfpack project: a real file at a root-relative anatomy path. (~3083 tok)
- `experiment-cmd.test.js` — project: inProject (~2898 tok)
- `experiment-journal.test.js` — root: fixture (~870 tok)
- `fixture-cleanup.test.js` — helperUrl: runChild, runSignalCase (~1588 tok)
- `hook-packaging.test.js` — Hook packaging: every module a hook imports must actually ship. (~1113 tok)
- `instruction-consolidation.test.js` — Declares current (~1432 tok)
- `learning-capture.test.js` — root: fixture, transcript, transcriptEntries (~4041 tok)
- `ledger-integrity.test.js` — LEDGER: project, write, hash, fresh (~3671 tok)
- `ledger-writer-safety.test.js` — repoRoot: fixture, entry (~1595 tok)
- `managed-payload-cleanup.test.js` — API routes: GET (3 endpoints) (~1872 tok)
- `mem0-canary.test.js` — root: score, clone (~1914 tok)
- `nudge-engine.test.js` — Regression suite for the evidence-addressed nudge engine. (~17193 tok)
- `nudge-state-safety.test.js` — root: fixture (~1051 tok)
- `parked-uq1-seam.test.js` — Behavioural pin for UQ-1 (see .wolf/parked-questions.md). (~947 tok)
- `post-write-dedup-path.test.js` — HOOK: runHook, setup, f, f (~1074 tok)
- `qa-cmd.test.js` — sha256: fixture (~656 tok)
- `queue-watch.test.js` — repoRoot: removeOp, userTurn, injection + 3 more (~2882 tok)
- `registry.test.js` — Tests for bug-440: malformed registry entries (missing root/name) must not (~1127 tok)
- `review-cmd.test.js` — repoRoot: fixture, sha256, manifestHash, runWolf (~1291 tok)
- `review-completion.test.js` — repoRoot: fixture, writeReviewLog, readReviewLog + 8 more (~21412 tok)
- `scientific-skills.test.js` — root: git, run, fixture + 3 more (~2783 tok)
- `skill-deployment.test.js` — root: fixture, runCli, seedProject, seedRegistry (~2396 tok)
- `skill-description-lint.test.js` — The lint exists to catch descriptions whose trigger surface is narrowed to a (~872 tok)
- `skill-receipt.test.js` — sha256: fixture (~2614 tok)
- `skillsbench.test.js` — root: git, run, fixture + 3 more (~2861 tok)
- `superpowers-canary.test.js` — Declares root (~576 tok)
- `trace-cerebrum-cmd.test.js` — Exports target (~852 tok)
- `update-source-exclusion.test.js` — Declares root (~227 tok)

## .claude/worktrees/wolfpack-quiet-modernization/tests/lib/

- `fixture-cleanup.js` — Exports createHomeFixture, createTmpFixture, cleanupFixture, cleanupAllFixtures (~934 tok)

## .wolf/audits/


## .wolf/hooks/


## .wolf/qa/


## External RAG qualification review evidence


## External canary execution authorization


## External canary repair: /mnt/j/projectshome/projects/rag/


## External canary: /mnt/j/projectshome/projects/rag/


## Lesson recall retirement — 2026-10-07


## Review closeout: external RAG canary


## bin/

- `openwolf.ts` — Declares major (~97 tok)

## docs/

- `blast-radius.md` — Blast-Radius Checklist (defense-layer changes) (~826 tok)
- `bug-recurrence.md` — Recurrence-after-fix evidence report (~1420 tok)
- `receipt-hash-interop.md` — Proposal: receipt-hash interop for cross-provider review verification (~1399 tok)
- `relevant-lessons.md` — Relevant lesson recall (~1294 tok)

## scripts/

- `lesson-recall-canary.mjs` — Local, read-only transcript replay. Never execute an observed edit or project command. (~2690 tok)
- `recurrence-controls.mjs` — Declares repository (~2410 tok)
- `skill-usage.py` — /*.jsonl for `Skill` tool_use records and prints (~1574 tok)
- `verify-fleet-section.mjs` — /.wolf/OPENWOLF.md`, which reports success (~1514 tok)
- `verify-install.js` — root: rel, fileExists, parseJson + 10 more (~5606 tok)

## src/buglog/

- `bug-matcher.ts` — Re-export from bug-tracker for convenience (~32 tok)
- `bug-tracker.ts` — Exports getBugLogPath, readBugLog, logBug, findSimilarBugs, searchBugs (~1532 tok)
- `recurrence-report.ts` — Exports RecurrenceOptions, buildRecurrenceReport (~6115 tok)

## src/cli/

- `bug-cmd.ts` — Exports bugSearch (~310 tok)
- `bug-recurrence-cmd.ts` — Exports BugRecurrenceOptions, bugRecurrence (~924 tok)
- `cerebrum-cmd.ts` — Exports lintCerebrum, cerebrumLint (~723 tok)
- `cerebrum-record.ts` — @ts-nocheck (~1629 tok)
- `cron-cmd.ts` — Exports cronList, cronRun, cronRetry (~1530 tok)
- `daemon-cmd.ts` — Exports getPm2NameForRoot, hasPm2, Pm2ProcessInfo, isPm2DaemonPidAlive + 12 more (~4537 tok)
- `dashboard.ts` — Exports isExpectedDashboardHealth, dashboardCommand (~1171 tok)
- `designqc-cmd.ts` — Exports designqcCommand (~478 tok)
- `drift-cmd.ts` — `openwolf foo`, `wolfpack foo bar` — captures the first subcommand token only. (~4067 tok)
- `experiment-cmd.ts` — @ts-nocheck (~7228 tok)
- `hook-manifest.ts` — Exports HOOK_REGISTRATIONS, HOOK_ENTRY_FILES, HOOK_HELPER_FILES, HOOK_SUPPORT_FILES + 10 more (~1111 tok)
- `index.ts` — Exports createProgram (~6588 tok)
- `init.ts` — Exports initCommand, findTemplatesDir, writeTemplateFile (~10350 tok)
- `ledger-cmd.ts` — Exports LedgerCommandOptions, ledgerAudit, ledgerRepair, ledgerNormalize, ledgerRecover (~1621 tok)
- `managed-skills.ts` — Exports MANAGED_CLAUDE_SKILL_FILES, installManagedClaudeSkills, backupManagedClaudeSkills, restoreManagedClaudeSkills (~727 tok)
- `nudge-cmd.ts` — `wolfpack nudge …` — explicit disposition commands. (~3819 tok)
- `qa-cmd.ts` — Exports QaStatus, buildQaStatusReport, qaStatus (~1289 tok)
- `registry.ts` — Central registry of all OpenWolf-managed projects. (~1546 tok)
- `review-cmd.ts` — Exports reviewList, reviewShow, reviewHash, reviewComplete (~1843 tok)
- `scan.ts` — Exports scanCommand (~441 tok)
- `scientific-skills.ts` — Exports ScientificSkillsConfig, DEFAULT_SCIENTIFIC_SKILLS_CONFIG, hashDirectory (~5805 tok)
- `skillsbench.ts` — Exports SkillsBenchConfig, DEFAULT_SKILLSBENCH_CONFIG, hashDirectory, providerWordingHits, extractDescription (~6503 tok)
- `status.ts` — Exports statusCommand (~1668 tok)
- `trace-cmd.ts` — Exports traceCommand (~1271 tok)
- `update.ts` — openwolf update — Update all registered OpenWolf projects. (~7098 tok)

## src/config/

- `default-config.json` (~2207 tok)

## src/daemon/

- `cron-engine.ts` — Exports TaskRunResult, enqueueCronStateWrite, normalizeCronState, updateCronState + 4 more (~5666 tok)
- `file-watcher.ts` — Exports startFileWatcher (~695 tok)
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

- `complete-review.js` — @ts-nocheck (~4593 tok)
- `complete-review.ts` — @ts-nocheck (~4529 tok)
- `lesson-recall.ts` — Preserve multiline entries and exact source locations; never rewrite Cerebrum. (~1892 tok)
- `post-read.js` — @ts-nocheck (~777 tok)
- `post-read.ts` — @ts-nocheck (~766 tok)
- `post-write.js` — @ts-nocheck (~9410 tok)
- `post-write.ts` — @ts-nocheck (~9402 tok)
- `pre-read.js` — @ts-nocheck (~887 tok)
- `pre-read.ts` — @ts-nocheck (~876 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `pre-write.ts` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2277 tok)
- `session-start.js` — @ts-nocheck (~2051 tok)
- `session-start.ts` — @ts-nocheck (~2039 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~30466 tok)
- `shared.ts` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~30677 tok)
- `stop.js` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37651 tok)
- `stop.ts` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37573 tok)

## src/hooks/nudges/

- `engine.js` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~4555 tok)
- `engine.ts` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~4555 tok)
- `project-scope.js` — Project ownership resolution. (~1201 tok)
- `project-scope.ts` — Project ownership resolution. (~1181 tok)
- `state.js` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7769 tok)
- `state.ts` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7660 tok)

## src/hooks/nudges/rules/

- `cerebrum.js` — Cerebrum freshness rule — PROJECT-SCOPED. (~1411 tok)
- `cerebrum.ts` — Cerebrum freshness rule — PROJECT-SCOPED. (~1400 tok)
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1991 tok)
- `conclusion.ts` — Conclusion / reduction gate — EVIDENCE-GATED. (~1951 tok)
- `learning.js` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1771 tok)
- `learning.ts` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1735 tok)
- `review.js` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3794 tok)
- `review.ts` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3762 tok)

## src/ledger/

- `ledger-integrity.ts` — Exports LedgerKind, LedgerClassification, LedgerRecord, LedgerAudit + 13 more (~10781 tok)

## src/scanner/

- `anatomy-scanner.ts` — Scan the project and return the anatomy content and file count WITHOUT writing to disk. (~2700 tok)
- `description-extractor.ts` — ─── Known files ───────────────────────────────────────────── (~12577 tok)
- `exclusions.ts` — directories. Ambiguous names such as "env" are intentionally omitted; (~906 tok)
- `project-root.ts` — Exports findProjectRoot (~260 tok)

## src/templates/

- `.gitignore` — Git ignore rules (~288 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `buglog.json` (~10 tok)
- `cerebrum.md` — Cerebrum (~184 tok)
- `claude-md-snippet.md` — Wolfpack (~74 tok)
- `claude-rules-openwolf.md` (~371 tok)
- `config.json` (~2215 tok)
- `cron-manifest.json` (~10 tok)
- `cron-state.json` (~38 tok)
- `designqc-report.json` (~26 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~8874 tok)
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
- `_template.md` — <short title> (~1111 tok)

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
- `size-discipline.js` — size-discipline.ts (~10634 tok)
- `size-discipline.ts` — size-discipline.ts (~10598 tok)

## templates/claude/

- `settings.json` — Declares p (~819 tok)

## templates/claude/rules/

- `openwolf.md` (~371 tok)

## templates/wolf/

- `.gitignore` — Git ignore rules (~288 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `cerebrum.md` — Cerebrum (~184 tok)
- `config.json` (~2215 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol (~5375 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)

## templates/wolf/hooks/

- `complete-review.js` — @ts-nocheck (~4593 tok)
- `manifest.json` (~129 tok)
- `package.json` — Node.js package manifest (~7 tok)
- `post-read.js` — @ts-nocheck (~777 tok)
- `post-write.js` — @ts-nocheck (~9410 tok)
- `pre-read.js` — @ts-nocheck (~887 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `session-start.js` — @ts-nocheck (~2051 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~30466 tok)
- `stop.js` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37651 tok)

## templates/wolf/hooks/nudges/

- `engine.js` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~4555 tok)
- `project-scope.js` — Project ownership resolution. (~1201 tok)
- `state.js` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7769 tok)

## templates/wolf/hooks/nudges/rules/

- `cerebrum.js` — Cerebrum freshness rule — PROJECT-SCOPED. (~1411 tok)
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1991 tok)
- `learning.js` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1771 tok)
- `review.js` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3794 tok)

## templates/wolf/qa/

- `_gate-log.json` (~11 tok)
- `_README.md` — Quality Gate — Adversarial Reductions (~613 tok)
- `_template.md` — <short title> (~552 tok)

## templates/wolf/utils/

- `fs-safe.js` — Exports readJSON, writeJSON, readText, writeText + 2 more (~790 tok)
- `logger.js` — Exports Logger (~1118 tok)
- `package.json` — Node.js package manifest (~7 tok)
- `paths.js` — Exports normalizePath, getWolfDir, resolveWolfFile, ensureDir, relativeToCwd (~190 tok)
- `platform.js` — Exports isWindows, isMac, isLinux, whichCommand (~101 tok)
- `port-allocator.js` — Exports deterministicBasePort, isPortFree, allocateProjectPorts (~307 tok)
- `size-discipline.js` — size-discipline.ts (~10634 tok)

## tests/

- `bug-recurrence.test.js` — Exports fixed (~7759 tok)
- `buglog-baseline-integrity.test.js` — Declares repoRoot (~394 tok)
- `config-merge-safety.test.js` — Declares tempFiles (~638 tok)
- `cron-result-truth.test.js` — repoRoot: makeProject (~509 tok)
- `cron-state-concurrency.test.js` — cronModule: runUpdate (~684 tok)
- `daemon-cmd.test.js` — Declares root (~2946 tok)
- `drift-cmd.test.js` — Minimal Wolfpack project: a real file at a root-relative anatomy path. (~3083 tok)
- `experiment-cmd.test.js` — project: inProject (~2898 tok)
- `experiment-journal.test.js` — root: fixture (~870 tok)
- `fixture-cleanup.test.js` — helperUrl: runChild, runSignalCase (~1588 tok)
- `hook-manifest-health.test.js` — repoRoot: runHealthMutation (~3167 tok)
- `hook-packaging.test.js` — Hook packaging: every module a hook imports must actually ship. (~1113 tok)
- `hook-state-safety.test.js` — Exports secret, secret, value, value + 2 more (~1166 tok)
- `init-root-scope.test.js` — Declares repoRoot (~712 tok)
- `learning-capture.test.js` — root: fixture, transcript, transcriptEntries (~4041 tok)
- `ledger-integrity.test.js` — LEDGER: project, write, hash, fresh (~3671 tok)
- `ledger-writer-safety.test.js` — repoRoot: fixture, entry (~1595 tok)
- `lesson-recall.test.js` — repo: fixture, payload, run, context, stats (~4614 tok)
- `mem0-canary.test.js` — root: score, clone (~1914 tok)
- `nudge-engine.test.js` — Regression suite for the evidence-addressed nudge engine. (~17193 tok)
- `nudge-state-safety.test.js` — root: fixture (~1051 tok)
- `parked-uq1-seam.test.js` — Behavioural pin for UQ-1 (see .wolf/parked-questions.md). (~947 tok)
- `post-write-dedup-path.test.js` — HOOK: runHook, setup, f, f (~1074 tok)
- `pre-write-retirement.test.js` — repo: fixture, payload, run (~2907 tok)
- `qa-cmd.test.js` — sha256: fixture (~656 tok)
- `queue-watch.test.js` — repoRoot: removeOp, userTurn, injection, transcriptFixture (~2012 tok)
- `registry-concurrency.test.js` — registryModule: runRegister (~674 tok)
- `registry.test.js` — Tests for bug-440: malformed registry entries (missing root/name) must not (~1127 tok)
- `review-cmd.test.js` — repoRoot: fixture, sha256, manifestHash, runWolf (~1327 tok)
- `review-completion.test.js` — repoRoot: fixture, writeReviewLog, readReviewLog + 8 more (~24121 tok)
- `scanner-hygiene.test.js` — Supplied description. */\nexport const value = 1;"), "Supplied description."); (~844 tok)
- `scientific-skills.test.js` — root: git, run, fixture + 3 more (~2783 tok)
- `session-start-concurrency.test.js` — repoRoot: runSessionStart (~790 tok)
- `skill-deployment.test.js` — root: fixture, runCli, seedProject, seedRegistry (~2396 tok)
- `skill-description-lint.test.js` — The lint exists to catch descriptions whose trigger surface is narrowed to a (~872 tok)
- `skill-receipt.test.js` — sha256: fixture (~2614 tok)
- `skillsbench.test.js` — root: git, run, fixture + 3 more (~2861 tok)
- `superpowers-canary.test.js` — Declares root (~576 tok)
- `trace-cerebrum-cmd.test.js` — Exports target (~852 tok)
- `update-source-exclusion.test.js` — Declares seedSourceCheckout (~572 tok)

## tests/lib/

- `fixture-cleanup.js` — Exports createHomeFixture, createTmpFixture, cleanupFixture, cleanupAllFixtures (~934 tok)

## .wolf/qa/ — lesson recall retirement evidence

- `lesson-recall-retirement.md` — final hash-bound build/test/install/control and scoped-review reduction.
- `lesson-recall-retirement-review.json`, `lesson-recall-retirement-review-initial.txt`, `lesson-recall-retirement-review-fix.txt` — current scope, pass accounting and raw receipts.
- `lesson-recall-retirement-tests.log`, `lesson-recall-retirement-focused.log`, `lesson-recall-retirement-install.log` — actual final validation output.
- `lesson-recall-retirement-basename-before.json` and `lesson-recall-retirement-controls.json` — receiving-process red/green and guard-disconnection evidence.
