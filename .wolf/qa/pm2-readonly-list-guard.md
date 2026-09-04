---
target: src/cli/daemon-cmd.ts
target-hash: d42245310306ef5cfdf8ff4f60dca1c2423fe332be4ed86ecd24d682ed83df83
created: 2026-09-04
reproduction_command: npm run build && node --test tests/daemon-cmd.test.js
evidence_source: executed now
---

# PM2 read-only listing guard

## What the code claims to do

`listPm2Processes()` invokes `pm2 jlist` only when the configured PM2 home contains a fully valid PID file whose process is alive; otherwise it returns an empty list without starting or contacting PM2.

## Assumptions (≥3)

1. **PID validation is complete** — only a full-string positive decimal that converts to a safe integer can reach the liveness probe.
2. **Signal-zero semantics are correct** — success and `EPERM` mean alive, while `ESRCH` and other errors mean unavailable.
3. **Home resolution matches PM2** — a non-empty trimmed `PM2_HOME` wins; empty or absent `PM2_HOME` falls back to `os.homedir()/.pm2`.
4. **The early return prevents side effects** — missing, malformed, and dead PID files return before the constant `pm2 jlist` command is executed.
5. **Live-daemon failure remains benign** — command or JSON failure still returns `[]` through the existing catch path.

## Pick the riskiest assumption

The early-return assumption is riskiest because checking only the returned empty array would be vacuous: unguarded `pm2 jlist` also returns an empty array while silently starting a God Daemon.

## Falsification test

Place a fake `pm2` executable first on `PATH` and have it write an invocation marker. Exercise missing, malformed, dead, and live PID files, then temporarily disconnect the compiled early guard to prove the marker-based test fails.

```bash
npm run build && node --test tests/daemon-cmd.test.js
```

## Evidence source

**executed now** — focused tests, the disconnected-guard control, and an installed-PM2 isolated-home probe were run in this session.

## Expected / Actual

- **Expected:** No fake-PM2 marker for missing/malformed/dead PID files; a marker and parsed rows for a live PID; the disconnected guard makes the focused test fail; an isolated inactive PM2 home remains absent with no additional God Daemon.
- **Actual:** All 12 daemon tests passed. Disconnecting the guard failed the no-invocation test. The real isolated-home probe returned `[]`, left the PM2 home absent, and kept the God Daemon count at 3.

## Run output

```
# tests 12
# pass 12
# fail 0
# duration_ms 739.623208

not ok 1 - PM2 listing does not invoke pm2 without a live daemon pid
# fail 1
negative_control_exit=1

[]
pm2_home_contents=<absent>
god_daemons_before=3 after=3
```

## Verdict

- [x] Assumption survived the test. The invocation marker detects the exact side effect, and the installed-PM2 probe independently preserved an inactive home.
- [ ] Assumption falsified.

## Follow-ups

Treat PM2 CLI list commands as potentially mutating unless daemon liveness has already been established without invoking PM2.
