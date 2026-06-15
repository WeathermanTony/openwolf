---
target: src/cli/update.ts
target-hash: 04c0c1278ea21b2073b243033e2cdef16563ec918e01338a2039c37ef4588afd
created: 2026-06-14
---

# Update installs review helper dependencies

## Assumptions

1. `openwolf update` resolves the compiled hook source directory to `dist/src/hooks` when run from the linked custom fork, so copying `complete-review.js` from that directory installs the helper into existing projects.
2. Hook and helper runtime imports that use `../utils/*.js` resolve against `.wolf/utils` as a sibling of `.wolf/hooks`, so update must copy compiled JS utilities from `dist/src/utils` into that destination and give that utility directory an ESM package scope.
3. Updating hooks and utilities is safe for existing OpenWolf projects because user-owned state files (`memory.md`, `cerebrum.md`, `buglog.json`, `reviewlog.json`, etc.) are not in the hook or utility copy set.
4. A project initialized before the helper existed can recover through `openwolf update` alone after stale/missing `.wolf/hooks/complete-review.js` and `.wolf/utils/size-discipline.js` are absent.
5. The update path should preserve existing registered-project behavior; verification must target a registered fixture rather than only a hand-written `.wolf` directory.

## Falsification test

Riskiest assumption: `openwolf update` might report success but still fail to restore the review completion helper or its utility dependency in an already registered project, or restore utilities without an ESM package scope. The runnable test creates a fresh registered fixture with `openwolf init`, deletes the helper, size utility, and utils package metadata to simulate an older install, runs `openwolf update --project <fixture>`, and checks that the files and ESM scope are restored.

Command:

```bash
tmp=$(mktemp -d); ( cd "$tmp" && git init -q && printf '{"name":"fixture"}\n' > package.json && openwolf init >/tmp/openwolf-init-for-update.log 2>&1 && rm -f .wolf/hooks/complete-review.js .wolf/utils/size-discipline.js .wolf/utils/package.json && printf 'old stop\n' > .wolf/hooks/stop.js && openwolf update --project "$tmp" >/tmp/openwolf-update-fixture.log 2>&1; rc=$?; printf 'rc=%s\n' "$rc"; if [ "$rc" -ne 0 ]; then cat /tmp/openwolf-update-fixture.log; else test -f .wolf/hooks/complete-review.js && echo complete-review-present; test -f .wolf/utils/size-discipline.js && echo size-discipline-present; test -f .wolf/utils/package.json && grep -q '"type": "module"' .wolf/utils/package.json && echo utils-module-package-present; fi ); rm -rf "$tmp"
```

Actual output:

```text
rc=0
complete-review-present
size-discipline-present
utils-module-package-present
```

Full build/test verification:

```bash
npm run build && npm test && npm run verify
```

Actual output excerpt:

```text
> customopenwolf@1.2.0-custom.0 build
> tsc && npm run build:dashboard && npm run postbuild:chmod

✓ built in 13.92s

> customopenwolf@1.2.0-custom.0 test
> node --test "tests/**/*.test.js"

1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0

> customopenwolf@1.2.0-custom.0 verify
> node scripts/verify-install.js

OpenWolf install verification passed.
```
