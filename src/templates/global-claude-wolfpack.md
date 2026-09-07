<!-- wolfpack:global:start -->
## WolfPack-managed projects

A project containing `.wolf/` uses WolfPack. Respect `.wolf/config.json`: behavior (`quiet` or `standard`) is separate from reviewer policy (`open`, `us-only`/`gov`, or `budget`).

- The parent session owns shared review, QA, ledger, and disposition state; delegated agents return evidence rather than closing shared obligations.
- Consult `.wolf/cerebrum.md` before material code generation when it records project conventions or corrections, and `.wolf/buglog.json` before repeating bug work.
- Let hooks maintain routine bookkeeping. Never edit review state manually to claim completion; use WolfPack commands and completion helpers so evidence is bound to current bytes.
- Changed bytes invalidate stale review claims. A skipped check, failed transport, or unavailable reviewer is not a pass.
- In quiet mode, avoid unsolicited WolfPack coaching and bookkeeping. Explicit commands and correctness checks remain available.
- At closeout, report changed paths, validation evidence, failures, limitations, and unresolved obligations honestly.

Detailed reference is available on demand in `.wolf/OPENWOLF.md` and through `openwolf --help`.
<!-- wolfpack:global:end -->
