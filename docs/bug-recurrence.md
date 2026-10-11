# Recurrence-after-fix evidence report

`wolfpack bug recurrence` scans local Claude Code history without changing bug status, promoting lessons, storing scan counts, adding a Stop nudge or executing transcript commands. `openwolf` is the compatibility alias.

```sh
wolfpack bug recurrence --json
wolfpack bug recurrence --transcripts /path/to/claude/project-history --json
wolfpack bug recurrence --bug bug-101 --match 'Connection refused while writing cache' --json
```

The default directory is `~/.claude/projects/<encoded-project-root>` using Claude Code's path encoding. Use `--transcripts` for another spelling, client layout or copied history. Attribution is checked against each record's real `cwd` and nearest `.wolf` owner; the source directory's name is not ownership evidence. Only its direct `.jsonl` files are scanned. Child directories and sidechain/agent records are excluded.

## Matching and chronology

- By default, consider resolved entries in `.wolf/buglog.json` and monthly `.wolf/archive/buglog-YYYY-MM.json` archives. Ledger arrays and object roots with `bugs` are supported. No repair or normalization is written.
- Copies with identical error/file/status/commit/reduction fields are coalesced. Conflicting records sharing an ID are excluded and diagnosed; `--bug` refuses an ambiguous selected ID. Unrelated archive conflicts do not invalidate a specifically selected unambiguous bug.
- Associate a failure only when a direct assistant `tool_use` and user `tool_result` have the same session/tool ID, attributable project `cwd`, and `is_error: true`. Success, a missing error flag, ordinary empty/no-match output and error words in prose do not establish failure.
- Match the ledger's complete `error_message` literally after whitespace normalization, preserving case and numbers. There is no fuzzy clustering or regex. Descriptive bug titles often differ from actual tool output: zero matches can be a signature mismatch. `--match` supplies an explicit signature only with one `--bug`; both default and custom signatures need eight normalized characters. Reports expose the signature's SHA-256, not its text.
- Deduplicate by session plus tool-use ID, not scanner invocation or filename. Copies of an incident do not increase counts. Conflicting call/result evidence for one identity is excluded, not assigned a convenient chronology. Summary counts union incident IDs across bugs; per-bug counts may overlap.
- A recorded watermark requires a resolved entry, a locally resolvable hexadecimal commit and an existing project-contained reduction file. Git committer time is the cutoff. Events at/before it are `pre_fix`; later events are `post_fix_possible`. Reduction presence does **not** prove validation passed. Nor does later time prove the fixed revision/runtime was deployed.
- Missing/invalid event timestamps stay `undated`; file mtime is never a substitute. Open entries can be explicitly selected, but are `unverified_fix`. Unresolvable commits, missing reductions and other unverified fixes cannot produce post-fix claims.

Literal association does not establish the same root cause. The report supplies evidence to inspect, not an automatic regression verdict or bug reopening decision.

## Bounds, evidence and exits

Defaults: newest 200 files by mtime, an 8 MiB tail per file, 64 MiB total. Override with `--max-files`, `--max-file-bytes`, `--max-total-bytes` (positive safe integers). `--exclude-session <id>` excludes a current implementation/evaluation session. Filesystem mtime selects bounded scan order only.

`coverage` reports files/bytes/records, parsed tool calls/results, explicit failure observations, successful/missing-flag results and exclusion/ambiguity/truncation counters. Observed counters include copied records; distinct incident counts do not. `ledger_coverage` reports input records, coalesced copies and ambiguous IDs. Diagnostics are capped at 100 with an explicit omitted count.

Each matched incident contains an absolute local pathname, original-record byte offset/length and raw-record SHA-256 (excluding the newline), plus session/tool identifiers and event time. A tail-relative line number is not presented as an absolute line. Raw results, commands, inputs, bug text and transcript excerpts are not emitted. Pathnames and identifiers remain local metadata: inspect/redact before sharing a report.

Exit codes:

- **0:** report produced with complete coverage within the deliberately supported scope.
- **2:** report produced with incomplete coverage (limits, malformed/unsupported records, symlinks, ambiguous attribution or IDs, changed sources, missing call evidence).
- **1:** no report; invalid arguments, selected ID, directory or unreadable/unsupported ledger. Input bytes remain untouched.

Incomplete reports still show usable captured evidence; a zero result is not proof of no recurrence. Conversation-only or successful-tool-only history may legitimately produce no matches.

## Deliberate boundaries

No Codex/Hermes adapters, scheduler, model calls, database, hook/config changes, cross-project deployment or Git writes. Git inspection uses fixed `execFileSync` arguments without a shell; `WOLFPACK_GIT_BIN`, PATH and common Windows Git locations are supported. Obvious shell directory/target switches and foreign explicit file targets are excluded conservatively; the report does not fully interpret shell commands or prove every tool's true execution target. Local transcript/ledger history is unauthenticated evidence, not trusted executable instruction.

Version impact: additive CLI feature in `1.2.0-custom.28`; source/package version changes do not claim a fleet runtime upgrade.
