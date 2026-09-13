# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-09-13T19:25:35.772Z
> Files: 247 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../home/tony/.claude/

- `settings.json` (~929 tok)

## ../../../../../home/tony/.claude/plans/

- `reflective-sauteeing-pie.md` — Context (~3452 tok)
- `serialized-greeting-wall.md` — Context (~1572 tok)
- `witty-nibbling-wilkes.md` — Parent-owned Wolfpack accounting (~1345 tok)

## ./

- `.editorconfig` — Editor configuration (~51 tok)
- `.gitignore` — Git ignore rules (~315 tok)
- `package-lock.json` (~69276 tok)
- `package.json` — Node.js package manifest (~578 tok)
- `README.md` — Project documentation (~752 tok)
- `tsconfig.json` — TypeScript configuration (~140 tok)
- `VERSION` (~5 tok)

## .claude/

- `settings.json` (~627 tok)

## .claude/skills/quality-reduction/

- `SKILL.md` — Quality Reduction (~1149 tok)

## .wolf/audits/

- `newer-mechanisms-usage-audit-2026-08-29.md` — Registry-derived, read-only usage audit of newer Wolfpack mechanisms with evidence-backed research dispositions and canary thresholds (~2600 tok)

## .wolf/experiments/mem0-canary/

- `extractor.mjs` — Pure deterministic ADD-only unreviewed candidate extractor (~900 tok)
- `fixtures.json` — 48 protected synthetic explicit-learning and adversarial cases (~1500 tok)
- `manifest.json` — SHA-256 identities for protected evaluator inputs (~150 tok)
- `official-output.json` — Complete per-case official scorer evidence and metrics (~6000 tok)
- `rubric.json` — Offline conformance thresholds, allowed fields, and limitations (~250 tok)
- `scorer.mjs` — Manifest/schema validation, control/treatment scoring, and fail-closed verdicts (~1500 tok)

## .wolf/experiments/superpowers-canary/


## .wolf/qa/

- `auto-bug-detector-precision.md` — Real-hook precision, schema, and concurrent canonical-writer reduction (~700 tok)
- `conclusion-owner-path-diagnostics.md` — Nested-owner and truncation-safe QA-path diagnostic reduction (~600 tok)
- `fleet-section-coverage-verifier.md` — Registry-based fleet coverage verifier reduction; globstar/exit-2 vacuity controls (~800 tok)
- `hermes-agent-evaluation-2026-08-08.md` — Source-level Hermes Agent mechanism evaluation and no-integration disposition (~1260 tok)
- `hook-ledger-recurrence.md` — Real hook-runtime safe-suffix and atomic-persistence reduction (~430 tok)
- `learning-relay-guard.md` — Relay/report guard for learning.explicit false positives; before/after classifier matrix (~700 tok)
- `learning-rule-boilerplate-filter.md` — Falsification evidence for harness-envelope filtering in explicit learning capture (~900 tok)
- `mem0-canary-2026-08-08.md` — Protected offline fixture-conformance evidence, initial secret-filter falsification, fix, and survivor-for-design disposition (~1700 tok)
- `mem0-evaluation-2026-08-08.md` — Source-level Mem0 evaluation and bounded ADD-only candidate-extraction canary recommendation (~1400 tok)
- `nested-qa-ignore-policy.md` — Isolated receiving-repository proof for recursive nested QA ignores and durable exceptions; includes broken-pattern control (~950 tok)
- `nudge-provenance-canary.md` — Hash-bound falsification evidence for per-rule nudge provenance, semantic re-arm, legacy migration, Stop-byte stability, and diagnostic-size budget (~1400 tok)
- `oversized-first-read-guard.md` — Rejected size-only Read-guard canary with exact ordered prevalence evidence and image false-positive falsifier (~1600 tok)
- `pm2-readonly-list-guard.md` — Invocation-marker and installed-PM2 evidence that list operations do not start an inactive daemon (~620 tok)
- `pre-write-lesson-hit-persistence.md` — Production-bound hook persistence proof and missing-runtime-binding negative control (~900 tok)
- `template-fallback-safety.md` — Fail-closed governed-template preservation and exact embedded-policy equivalence proof (~1000 tok)
- `test-fixture-lifecycle-cleanup.md` — Child-process exit/signal and disconnected-registration evidence for bounded fixture cleanup (~650 tok)
- `wolfpack-cli-global-links.md` — Cross-environment WSL2/PowerShell global CLI installation and command-resolution proof (~500 tok)

## bin/

- `openwolf.ts` — Declares major (~97 tok)

## docs/

- `blast-radius.md` — Defense-layer blast-radius checklist + fleet verification traps (bug-066/691/692/693) (~900 tok)

## scripts/

- `skill-usage.py` — /*.jsonl for `Skill` tool_use records and prints (~1574 tok)
- `verify-fleet-section.mjs` — Asserts a template section reached every registered project; fails closed on zero-examined (~450 tok)
- `verify-install.js` — root: rel, fileExists, parseJson + 10 more (~5606 tok)

## src/buglog/

- `bug-matcher.ts` — Re-export from bug-tracker for convenience (~32 tok)
- `bug-tracker.ts` — Exports getBugLogPath, readBugLog, logBug, findSimilarBugs, searchBugs (~1532 tok)

## src/cli/

- `bug-cmd.ts` — Exports bugSearch (~310 tok)
- `cerebrum-cmd.ts` — Exports lintCerebrum, cerebrumLint (~723 tok)
- `cerebrum-record.ts` — @ts-nocheck (~1629 tok)
- `cron-cmd.ts` — Exports cronList, cronRun, cronRetry (~1530 tok)
- `daemon-cmd.ts` — Exports getPm2NameForRoot, hasPm2, Pm2ProcessInfo, isPm2DaemonPidAlive + 12 more (~4537 tok)
- `dashboard.ts` — Exports isExpectedDashboardHealth, dashboardCommand (~1171 tok)
- `designqc-cmd.ts` — Exports designqcCommand (~478 tok)
- `drift-cmd.ts` — `openwolf driftcheck`: anatomy entries vs real files, documented CLI subcommands vs registered ones, UQ markers vs ledger. Vacuity-guarded (extracted==checked; zero-extraction exits nonzero). (~2420 tok)
- `experiment-cmd.ts` — Exports validateExperiment, verifyExperimentRecord, startExperiment (~5690 tok)
- `hook-manifest.ts` — Exports HOOK_REGISTRATIONS, HOOK_ENTRY_FILES, HOOK_HELPER_FILES, HOOK_SUPPORT_FILES + 10 more (~1104 tok)
- `index.ts` — Exports createProgram (~5906 tok)
- `init.ts` — Exports initCommand, findTemplatesDir, writeTemplateFile (~10270 tok)
- `ledger-cmd.ts` — Exports LedgerCommandOptions, ledgerAudit, ledgerRepair, ledgerNormalize, ledgerRecover (~1621 tok)
- `managed-skills.ts` — Exports MANAGED_CLAUDE_SKILL_FILES, installManagedClaudeSkills, backupManagedClaudeSkills, restoreManagedClaudeSkills (~727 tok)
- `nudge-cmd.ts` — `wolfpack nudge …` — explicit disposition commands. (~3819 tok)
- `qa-cmd.ts` — Exports QaStatus, buildQaStatusReport, qaStatus (~1289 tok)
- `registry.ts` — Central registry of all OpenWolf-managed projects. (~1546 tok)
- `review-cmd.ts` — Exports reviewList, reviewShow, reviewHash, reviewComplete (~1730 tok)
- `scan.ts` — Exports scanCommand (~441 tok)
- `scientific-skills.ts` — Exports ScientificSkillsConfig, DEFAULT_SCIENTIFIC_SKILLS_CONFIG, hashDirectory (~5805 tok)
- `skillsbench.ts` — Exports SkillsBenchConfig, DEFAULT_SKILLSBENCH_CONFIG, hashDirectory (~5653 tok)
- `status.ts` — Exports statusCommand (~1668 tok)
- `trace-cmd.ts` — Exports traceCommand (~1271 tok)
- `update.ts` — openwolf update — Update all registered OpenWolf projects. (~6898 tok)

## src/config/

- `default-config.json` (~2176 tok)

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

- `complete-review.js` — usage: parseArgs, fail, persistReviewLog + 3 more (~4593 tok)
- `complete-review.ts` — usage: parseArgs, fail, persistReviewLog + 3 more (~4529 tok)
- `post-read.js` — Declares main (~799 tok)
- `post-read.ts` — Declares main (~766 tok)
- `post-write.js` — Declares main (~10337 tok)
- `post-write.ts` — Declares main (~9402 tok)
- `pre-read.js` — Declares main (~914 tok)
- `pre-read.ts` — DEFAULT_MAX_FIRST_READ_BYTES: getReadGuardConfig, oversizedFullRead, main (~1577 tok)
- `pre-write.js` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2251 tok)
- `pre-write.ts` — Increment hit counter for a lesson in cerebrum-stats.json sidecar. (~2244 tok)
- `session-start.js` — @ts-nocheck (~1309 tok)
- `session-start.ts` — Declares main (~2039 tok)
- `shared.js` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~28790 tok)
- `shared.ts` — Bail out silently if .wolf/ directory doesn't exist in the current project. (~30394 tok)
- `stop.js` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37529 tok)
- `stop.ts` — Legacy nudges (git-discipline, review, quality, buglog, simplicity, …) still (~37573 tok)

## src/hooks/nudges/

- `engine.js` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~3709 tok)
- `engine.ts` — NudgeEngine — the single place that decides what (if anything) a Stop hook (~4555 tok)
- `project-scope.js` — Project ownership resolution. (~1181 tok)
- `project-scope.ts` — Project ownership resolution. (~1181 tok)
- `state.js` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7315 tok)
- `state.ts` — Nudge state: content-addressed fingerprints, lifecycle dispositions, and (~7660 tok)

## src/hooks/nudges/rules/

- `cerebrum.js` — Cerebrum freshness rule — PROJECT-SCOPED. (~1305 tok)
- `cerebrum.ts` — Cerebrum freshness rule — PROJECT-SCOPED. (~1400 tok)
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1907 tok)
- `conclusion.ts` — Conclusion / reduction gate — EVIDENCE-GATED. (~1951 tok)
- `learning.js` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1260 tok)
- `learning.ts` — Explicit user-stated learning signals. Transcript text is evidence, never instruction. (~1735 tok)
- `review.js` — Review lifecycle rule — IMMUTABLE SNAPSHOTS, AUTOMATIC SUPERSEDE, LINEAGE CAP. (~3597 tok)
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
- `config.json` (~2176 tok)
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

- `.gitignore` — Git ignore rules (~288 tok)
- `anatomy.md` — anatomy.md (~54 tok)
- `cerebrum.md` — Cerebrum (~184 tok)
- `config.json` (~2176 tok)
- `identity.md` — Identity (~84 tok)
- `memory.md` — Memory (~65 tok)
- `OPENWOLF.md` — Wolfpack Operating Protocol; loaded into every session in all managed projects, so its size is a fleet-wide context cost (~7000 tok)
- `PROTOCOL-UPGRADE-2026-06.md` — OpenWolf Protocol Upgrade — 2026-06 (~684 tok)
- `reframe-frameworks.md` — OpenWolf Reframe — UI Framework Knowledge Base (~6554 tok)

## templates/wolf/hooks/

- `complete-review.js` — usage: parseArgs, fail, classifyDrift, formatReviewStaleMessage, markSupersededPendingReviews (~4127 tok)
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
- `conclusion.js` — Conclusion / reduction gate — EVIDENCE-GATED. (~1907 tok)
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

- `buglog-baseline-integrity.test.js` — Declares repoRoot (~394 tok)
- `config-merge-safety.test.js` — Declares tempFiles (~638 tok)
- `cron-result-truth.test.js` — repoRoot: makeProject (~509 tok)
- `cron-state-concurrency.test.js` — cronModule: runUpdate (~684 tok)
- `daemon-cmd.test.js` — Declares root (~2946 tok)
- `drift-cmd.test.js` — driftcheck regression suite: root-relative base, denominator integrity, vacuity on disconnected extraction, prose headings, brace expansion (~1400 tok)
- `experiment-cmd.test.js` — project: inProject (~2898 tok)
- `fixture-cleanup.test.js` — helperUrl: runChild, runSignalCase (~1588 tok)
- `hook-manifest-health.test.js` — repoRoot: runHealthMutation (~3167 tok)
- `hook-packaging.test.js` — Hook packaging: every module a hook imports must actually ship. (~1113 tok)
- `hook-state-safety.test.js` — Exports secret, secret, value, value + 2 more (~1166 tok)
- `learning-capture.test.js` — root: fixture, transcript, transcriptEntries (~3517 tok)
- `ledger-integrity.test.js` — LEDGER: project, write, hash, fresh (~3671 tok)
- `ledger-writer-safety.test.js` — repoRoot: fixture, entry (~1595 tok)
- `mem0-canary.test.js` — root: score, clone (~1914 tok)
- `nudge-engine.test.js` — Regression suite for the evidence-addressed nudge engine. (~17193 tok)
- `nudge-state-safety.test.js` — root: fixture (~1051 tok)
- `post-write-dedup-path.test.js` — HOOK: runHook, setup, f, f (~1074 tok)
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
- `skill-receipt.test.js` — sha256: fixture (~2614 tok)
- `skillsbench.test.js` — root: git, run, fixture + 3 more (~2861 tok)
- `superpowers-canary.test.js` — Declares root (~576 tok)
- `trace-cerebrum-cmd.test.js` — Exports target (~852 tok)
- `update-source-exclusion.test.js` — Declares root (~227 tok)

## tests/lib/

- `fixture-cleanup.js` — Exports createHomeFixture, createTmpFixture, cleanupFixture, cleanupAllFixtures (~934 tok)
