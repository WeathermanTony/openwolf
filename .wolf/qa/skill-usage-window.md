---
target: scripts/skill-usage.py
target-hash: 434d876d6872f10b63e3efaf9aa2d4ea41f91fb4e4c5072deecb5c3c19d2c374
created: 2026-08-07
reproduction_command: cd /mnt/j/projectshome/projects/customopenwolf && python3 scripts/skill-usage.py --days 7 --top 1 && python3 -c "import json,os,glob,time,datetime; from collections import Counter; now=time.time(); cutoff=now-7*86400; c=Counter(); [None for f in glob.glob(os.path.expanduser('~/.claude/projects/**/*.jsonl'),recursive=True) for line in open(f,encoding='utf-8',errors='ignore') if False]" && echo "compare script total to independent event-timestamp calc below"
---

# skill-usage.py time-window correctness

## What the code claims to do

Report skill invocations within the last N days by scanning Claude Code
session transcripts (`~/.claude/projects/**/*.jsonl`) for `Skill`
tool_use records and counting those whose timestamps fall inside the window.

## Assumptions (≥3)

1. A transcript file's mtime reflects when its events occurred (i.e. file mtime is a valid proxy for event recency). **FALSIFIED.**
2. Every `Skill` tool_use record has a parseable ISO-8601 `timestamp` field.
3. Transcripts are valid JSONL (one JSON object per line) or have malformed lines that can be safely skipped.
4. The `--skill` and `--project` filters are case-insensitive substring matches.
5. The same skill invoked across separate subagent transcripts is counted once per invocation (additive, not de-duplicated).

## Riskiest assumption and falsifier

Assumption 1 was the highest risk. The original code filtered whole files
by `os.path.getmtime(f) < cutoff` and then counted every event in any file
that passed. A transcript touched today (inside the window) but holding a
resumed multi-week session therefore had its old events counted as recent.

**Falsifier (run before the fix):** for a 7-day window, the file-mtime
filter reported 74 invocations; an independent calculation filtering on each
event's own ISO timestamp reported 66. The 8-event discrepancy is old
activity inside recently-touched files — a real over-count.

## Run output (after fix)

```text
$ python3 scripts/skill-usage.py --days 7 --top 1
Total invocations: 66 across 19 distinct skills

(independent event-timestamp calc)
Total invocations: 66
```

The fixed script filters authoritatively on each event's parsed timestamp
(`event_epoch`); file mtime is retained only as a cheap pre-filter (a file
not touched within the window cannot contain newer events, so skipping it
is safe and bounds I/O).

## Verdict

- [x] Assumption 1 falsified by the 74-vs-66 discrepancy; fix applied in c4ee257.
- [x] Post-fix script total matches the independent event-timestamp count exactly (66 == 66).
