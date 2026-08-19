# Blast-Radius Checklist (defense-layer changes)

Audience: anyone editing this harness's permissions, hooks, or sandbox settings, or pushing any
change to registered projects. Project sessions get the two-sentence summary in `OPENWOLF.md`
(`## Staged Rollout`); the full checklist lives here, where it is read at edit time.

**Blast radius scales with enforcement strength — so scope inversely.**

- `permissions.deny/ask` errors hurt only the agent. Hook errors hurt the agent. Sandbox errors hurt
  **every process on the machine**, including ones the agent merely launched.
- Never `denyRead` a directory that mixes config and credentials (`~/.ssh`, `~/.aws`, `~/.config/gh`,
  `~/.npmrc`, docker/kube/vercel equivalents) — the legitimate tool that must read its own config dies
  with the secret. Deny the credential file, not the directory (`~/.ssh/id_*`, not `~/.ssh`).
- **Restrictions inherit, exemptions don't**: a sandbox exemption matches the launched command only,
  not its children (exempting `gh` does nothing when `git` spawns it as a credential helper).
- **Never close the escape hatch in the same change as a new block.** One at a time, so a bad block
  stays recoverable.
- **Stage before widening:** new restrictive rule → one project's local settings → exercise the real
  paths it touches (push, install, ssh) → only then user scope or fleet-wide. A user-scope or fleet
  mistake deploys everywhere instantly.
- **A change to the harness itself is a fleet change.** It lands in one project and survives one real
  session before `openwolf update` propagates it. For prose changes to `OPENWOLF.md`, "exercise" means
  reading the rendered section in a real session: confirm it does not contradict adjacent sections or
  bloat the import. Per-project timestamped backups give rollback, not detection — they are not a
  substitute for the canary.

Before adding any block, search this repo's own ledgers first (`.wolf/buglog.json`, `.wolf/cerebrum.md`)
— "what does this setting break?" is often already recorded. See the Bug Logging and Cerebrum Learning
sections of `OPENWOLF.md` for the obligation to record it when it is not.

## Verifying a fleet rollout

Verify by **content**, not by heading. `scripts/verify-fleet-section.mjs` iterates
`~/.openwolf/registry.json` (the only root-agnostic ground truth — registered projects are not all
under one root), binds the canonical section hash from `src/templates/OPENWOLF.md`, and fails unless
`checked == registry count`, `missing == 0`, and `drifted == 0`.

```bash
node scripts/verify-fleet-section.mjs '## Section Heading'
```

Known vacuity traps this replaced, each logged with a reduction:

| Trap | Symptom | Bug |
|---|---|---|
| `grep -L` over a `**` glob | globstar off → 1 file examined; empty stdout reads as full coverage | bug-066 |
| Path extraction guessing key names | 0 paths extracted → "0 outside root" reported as a finding | bug-691 |
| Heading-presence coverage | stale/reverted section body verifies as covered | bug-692 |
| `process.cwd()`-relative template | run from elsewhere → silent degrade to heading-only PASS | bug-693 |

The rule behind all four: **a check must be able to fail for the reason it exists.** Assert the
denominator, bind the content, and fail closed when the binding is unavailable.
