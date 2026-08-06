---
target: src/cli/scientific-skills.ts
target-hash: d53f9564526b3ef41d0021ab08a1f85f6c3adaedee93e544ac7e0abbca26db6b
created: 2026-08-06
reproduction_command: cd /mnt/j/projectshome/projects/customopenwolf && npm run build && node --test tests/scientific-skills.test.js tests/skillsbench.test.js tests/skill-deployment.test.js && npm run verify && npm test
---

# K-Dense scientific skills manager

## What the code claims to do

The manager fetches nine explicitly selected K-Dense skills, validates and hashes their source trees, constructs an immutable user-scope plugin release, atomically activates only its own marketplace, supports rollback and doctor checks, and maintains a schedule independent from SkillsBench.

## Assumptions (≥3)

1. Every configured path remains inside the checked-out K-Dense repository and has a `SKILL.md` whose frontmatter name exactly matches its configured ID.
2. Selected trees contain only regular files/directories; symlinks and special entries are rejected before release activation.
3. Copied plugin bytes hash identically to the selected upstream bytes before the release becomes active.
4. The K-Dense state directory, marketplace name, plugin ID, update lock, cron marker, log, and checkout cannot overwrite SkillsBench or unrelated user plugin state.
5. POSIX quoting preserves apostrophes, dollar expressions, and command-substitution-looking text literally in the scheduled executable, entrypoint, and log paths.
6. A registration failure or explicit rollback restores a complete prior release rather than leaving mismatched active and marketplace links.

## Riskiest assumption and falsifier

Manager isolation and shell quoting are the highest-risk boundaries. Temporary-HOME fixtures create local Git sources, unrelated marketplace state, release/update/rollback cycles, malformed paths, symlink trees, and executable/log paths containing apostrophes plus `$HOME`, `$USER`, and `$(id -u)`. They execute the cron command and assert exact literal argv.

## Run output

```text
# focused tests 15
# focused pass 15
# focused fail 0
OpenWolf install verification passed.
# full tests 131
# full pass 131
# full fail 0
```

## Verdict

- [x] The selected assumptions survived the fixture and complete-suite falsifiers.
- [x] A bounded GLM current-byte review returned CLEAN for the manager, CLI routes, and tests.
