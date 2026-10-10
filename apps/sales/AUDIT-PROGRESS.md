# Audit progress

**Status: SUBSTANTIALLY COMPLETE.** Read-only. No code changed by the audit.

Ran as four workflow waves of area auditors (9 lenses each) plus adversarial
verification of every CRITICAL/HIGH, then a hand audit of the infra layer.
Consolidated into [AUDIT-MAP.md](AUDIT-MAP.md), [AUDIT-FINDINGS.md](AUDIT-FINDINGS.md)
(176-row register) and [AUDIT-ROADMAP.md](AUDIT-ROADMAP.md).

## Batch status

| Batch | Status |
|---|---|
| actions-core (`app/actions/risansi.ts`) | REVIEWED (pre-audit spot-check, 23 findings) |
| map-authx (auth model + secrets) | REVIEWED |
| map-data (schema vs live DB) | REVIEWED |
| actions-rest (12 action files) | REVIEWED |
| api-platform (auth/cron/debug-db) | REVIEWED |
| api-domain (~26 risansi API routes) | REVIEWED |
| lib-1 (auth core + 13 libs) | REVIEWED |
| pages-shell / dashboard / clients / pipeline / ops / admin | REVIEWED |
| comp-1 / comp-2 / comp-3 / comp-4 / comp-ui | REVIEWED |
| lib-2 (16 libs) | REVIEWED |
| infra (migrations, scripts, config) | REVIEWED (hand audit) |
| **map-arch** | HAND-AUTHORED — agent cut off by session limit |
| **map-journeys** | HAND-AUTHORED — agent cut off by session limit |
| completeness-critic | NOT RUN (session limit) |

263 file-review records; the 319-file census is covered except `design/`,
`public/`, `.claude/`, and git history.

## Totals

176 findings after dedupe: **1 CRITICAL, 11 HIGH, 72 MEDIUM, 92 LOW.**
3 HIGH candidates were adversarially REFUTED and excluded (signup role-escalation
blocked by the Pending-status gate; the NEXTAUTH_SECRET fallback not reached via
the middleware path).

## To fully close out (after the 2:10am Asia/Dubai limit reset)

Re-run the last wave for an independent arch + journeys pass and the
completeness critic:

```
Workflow({ scriptPath: ".../scratchpad/audit-wave.js", args: "infra,map-arch,map-journeys" })
```

The infra batch will corroborate the hand audit; map-arch / map-journeys will
cross-check the hand-authored MAP sections. Nothing else is outstanding.

## Remediation (applied after the audit)

The read-only audit above proposed fixes; these were then applied in four waves,
each tsc-clean, production-build-clean, and verified before commit.

| Wave | Scope | Commit | Status |
|---|---|---|---|
| 1 | Security CRITICAL/HIGH + the data-loss bug | `d86304c` | ✅ shipped |
| 2 | Correctness quick-wins (silent-catch logging, manager task scope, timezone date-shifts, debug blocks, silent-fail buttons) | `42276d9` | ✅ shipped |
| 3 | Performance & cost (session dedupe via React cache, task indexes / migration 0049, tab-gated + debounced queries) | `4c84e82` | ✅ shipped |
| 4 | UX + governance (security headers, broken skeletons, dark-mode tokens, dead-code deletion, minimal CI) | `6b63250` | ✅ shipped |

**The 1 CRITICAL and all 11 HIGH findings are resolved** (Wave 1). A 13-agent
reconciliation of the full register against the current working tree (commit
`d713680`) gives, for the original 176: **40 resolved, 10 partial, 125 open, 1
obsolete** (breakdown table in [AUDIT-FINDINGS.md](AUDIT-FINDINGS.md)). Every
open/partial item is MEDIUM or LOW.

That reconciliation's adversarial diff-review also surfaced **8 new items
(#177–184)** introduced or discovered during remediation — including three real
regressions from my own waves (a broken Field-tab overdue indicator, a dark-mode
button-contrast drop, two missed loader colours), all fixed in `d713680`.
Combined resolved: **45 / 184**.

### Deferred (still open in the register)

- **Error monitoring / Sentry** (#64, #80, #84, #175) — needs an account + DSN and
  a paid-tier decision; the CI header notes where a build+monitor job slots in.
- **Automated test suite** (#69, #79, #84, #176) — multi-day; needs a test-infra
  choice (Vitest + pg-mem vs a throwaway test schema). CI runs tsc today.
- **Larger performance refactors** (#57, #67, #58, #74, #171) — batching the cron
  email sends and the pump/revenue upserts, trimming pipeline/coverage column
  lists, action-queue pagination, the quotation-parser regex (#175).
- **Remaining scattered LOW cosmetics** — the Client-360 page's own hardcoded hex
  (#120, #128), the shared sort/filter-builder dedup (#123, #134, #152), and the
  many LOW timezone/date-string and a11y-label items.
