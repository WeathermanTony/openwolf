---
target: src/hooks/nudges/rules/conclusion.ts
target-hash: 733d241cb947ecfdbbcba65449420c20cdc1be5cf274acffca3d8d0cec24a93e
target-js: src/hooks/nudges/rules/conclusion.js
target-hash-js: b5c7a0b3fe68b6a7708a57fb8c3b4045477e5a4786297f072dc44e19986e9d6e
target-template: templates/wolf/hooks/nudges/rules/conclusion.js
target-hash-template: b5c7a0b3fe68b6a7708a57fb8c3b4045477e5a4786297f072dc44e19986e9d6e
created: 2026-08-12
reproduction_command: npm run build && node --test tests/nudge-engine.test.js
---

# Conclusion-gate owner and QA-path diagnostics

## What the code claims to do

A conclusion candidate identifies the nearest Wolfpack owner and places its canonical owner root plus the absolute QA directory actually inspected at the start of the rendered reason. Ownership, evidence, target hashes, and fingerprint semantics remain unchanged.

## Assumptions

1. `groupByOwner()` selects the nearest enclosing `.wolf` project for nested files.
2. `qaDir` is exactly `<owner.wolfDir>/qa`, not the driving project's QA directory.
3. Putting owner/path first keeps both diagnostics visible when `formatCandidate()` truncates a long message.
4. Unattributed files remain unattributed rather than falling back to a convenient project.
5. Presentation-only reason changes do not alter `evidence.qa_dir` or target-hash identity.
6. Missing or unterminated YAML frontmatter fails closed and cannot claim coverage from body text.

## Riskiest assumption

Truncation is riskiest because correct diagnostics placed later in the message would still disappear under the ordinary output budget.

## Falsification test

The test creates an outer project and nested Wolfpack project, edits eight long-named files under the nested project, collects a real conclusion candidate, and formats it with a 220-character cap. It requires both the nested owner root and its absolute `.wolf/qa` path to survive, while the outer QA path is absent. A separate orphan fixture must produce no candidate and return the file as unattributed.

## Actual run output

```text
# Subtest: 8b. conclusion diagnostics name exact nearest owner and inspected QA path first
ok 10 - 8b. conclusion diagnostics name exact nearest owner and inspected QA path first
# Subtest: 8c. conclusion gate leaves unattributed files unattributed
ok 11 - 8c. conclusion gate leaves unattributed files unattributed
1..39
# tests 39
# pass 39
# fail 0
```

## Verdict

- [x] Nearest nested ownership is preserved.
- [x] The exact absolute QA directory inspected is visible first.
- [x] Owner/path survive bounded formatting.
- [x] Unattributed files do not acquire a fallback owner.
- [x] Evidence retains the existing relative `.wolf/qa` field and unchanged hash inputs.
- [x] Unterminated frontmatter cannot suppress an obligation with a body hash.
