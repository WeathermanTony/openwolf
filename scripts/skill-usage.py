#!/usr/bin/env python3
"""Ad-hoc skill-usage report from Claude Code transcripts.

Scans ~/.claude/projects/**/*.jsonl for `Skill` tool_use records and prints
per-skill invocation counts, last-used timestamps, and which projects used them.

Usage:
  python3 scripts/skill-usage.py                 # last 30 days, all projects
  python3 scripts/skill-usage.py --days 7        # last week
  python3 scripts/skill-usage.py --skill pdf     # one skill's history
  python3 scripts/skill-usage.py --project metabase

No runtime cost — reads data Claude Code already writes. Nothing is installed
or hooked; this is a read-only query.
"""
import json, os, glob, argparse, time
from collections import Counter, defaultdict

def project_name(transcript_path, raw_dir):
    # /home/tony/.claude/projects/-mnt-j-projectshome-projects-<name>/...
    base = os.path.basename(raw_dir)
    return base

def main():
    ap = argparse.ArgumentParser(description="Skill-usage report from Claude Code transcripts")
    ap.add_argument("--days", type=int, default=30, help="lookback window in days (default 30)")
    ap.add_argument("--skill", type=str, default=None, help="filter to one skill name")
    ap.add_argument("--project", type=str, default=None, help="filter to projects matching this substring")
    ap.add_argument("--top", type=int, default=25, help="top N skills to show (default 25)")
    args = ap.parse_args()

    cutoff = time.time() - args.days * 86400
    by_skill = Counter()
    by_project_for_skill = defaultdict(Counter)
    last_used = {}  # skill -> (timestamp, project)
    skill_filter = args.skill.lower() if args.skill else None

    files = glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True)
    for f in files:
        try:
            if os.path.getmtime(f) < cutoff:
                continue
        except OSError:
            continue
        raw_dir = os.path.dirname(f)
        proj = project_name(f, raw_dir)
        if args.project and args.project.lower() not in proj.lower():
            continue
        try:
            for line in open(f, encoding="utf-8"):
                try:
                    d = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                if d.get("type") != "assistant":
                    continue
                for p in (d.get("message", {}).get("content") or []):
                    if not (isinstance(p, dict) and p.get("type") == "tool_use" and p.get("name") == "Skill"):
                        continue
                    s = p.get("input", {}).get("skill", "?")
                    if skill_filter and skill_filter not in s.lower():
                        continue
                    ts = d.get("timestamp", "")
                    by_skill[s] += 1
                    by_project_for_skill[s][proj] += 1
                    if s not in last_used or ts > last_used[s][0]:
                        last_used[s] = (ts, proj)
        except OSError:
            continue

    if not by_skill:
        print(f"No skill invocations found (days={args.days}, skill={args.skill}, project={args.project}).")
        return

    print(f"--- SKILL USAGE (last {args.days} days){f' skill={args.skill}' if args.skill else ''}{f' project~{args.project}' if args.project else ''} ---")
    for s, c in by_skill.most_common(args.top):
        lu_ts, lu_proj = last_used.get(s, ("?", "?"))
        lu_proj_short = lu_proj.replace("-mnt-j-projectshome-projects-", "")[:40]
        print(f"  {c:4d}  {s:32s} last: {lu_ts[:10]}  in {lu_proj_short}")
        if args.skill:
            for proj, pc in by_project_for_skill[s].most_common(5):
                proj_short = proj.replace("-mnt-j-projectshome-projects-", "")[:50]
                print(f"         {pc:3d}  {proj_short}")
    print()
    print(f"Total invocations: {sum(by_skill.values())} across {len(by_skill)} distinct skills")

if __name__ == "__main__":
    main()
