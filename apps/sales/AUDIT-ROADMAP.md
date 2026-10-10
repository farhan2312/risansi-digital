# AUDIT-ROADMAP.md

Read-only audit of the Risansi sales portal (commit `a2bc561`). No code was changed by the audit. Full register in [AUDIT-FINDINGS.md](AUDIT-FINDINGS.md); architecture and data model in [AUDIT-MAP.md](AUDIT-MAP.md).

## Executive summary (plain English)

The portal is a capable, feature-rich internal sales system, and most of it is built carefully — the write layer is transactional in the right places, money is handled consistently, and the tour-based "who can see which client" model is real and mostly enforced. The audit found **1 critical and 11 high-severity issues**, and they cluster into one theme: **authorization is applied unevenly**. The proxy protects pages by URL, but individual server actions and API routes each have to remember to check "is this record yours" — and several forget. The result is that any logged-in user can, today, read or tamper with data belonging to teams they're not on: another team's contacts, tasks, sales orders. Two API endpoints answer to *anyone on the internet* with no login at all, leaking client names and codes. One data-loss bug can wipe the wrong month's revenue on an undo. Separately, the database connection does not verify its TLS certificate.

None of these require deep expertise to exploit — they are "change the number in the URL" problems. The good news is that most are small, self-contained fixes that reuse helpers the codebase already has. Below is a four-wave plan that stops the bleeding first (a day or two of work), then clears the quick wins, then addresses performance, cost and polish. The lower-severity findings are mostly cosmetic or hygiene: a few dark-mode colours, some leftover debug logging, timezone-edge date bugs, and dead code.

## Health scorecard (1–5, 5 = excellent)

| Lens | Score | One-line justification |
|------|-------|------------------------|
| Security | **2** | Uneven per-action/route authz; 2 unauthenticated endpoints; TLS verification off; stored-XSS on quote upload. Page-level gating and the visibility model itself are sound. |
| Correctness | **3** | Solid transactional writes, but an error-swallowing `q()` on the dashboard, several timezone date-shift bugs, and unhandled rejections that hang UI. |
| Performance | **3** | Good use of `Promise.all`; a few unpaginated queries ship the whole client base to the browser; correlated subqueries are fine at current volumes. |
| Data layer | **4** | Clean transactional migration runner, money typed correctly, FKs present. Docked for `schema_migrations` drift and a missing `upload_id` on revenue. |
| UI / UX | **3** | Consistent design system and states in most places; broken shimmer skeletons, hardcoded light colours in dark mode, some silent-failure buttons. |
| Simplification | **3** | Some dead components (`RisansiSidebar`, `FYSelector`), a duplicated filter builder, leftover debug blocks. |
| Governance | **2** | No tests, no error monitoring, console-only logging, debug logs left in production, no CI checks. |
| Cost | **4** | Lean — no always-on compute beyond Vercel, cron not polling. Docked only for a few unbounded result sets. |
| Workflow / integration | **4** | Crons are authed and idempotent; email is best-effort. Little logic lives outside the app. |

## The ten highest-leverage fixes (impact ÷ effort)

1. **Delete `/api/debug-db`** — unauthenticated live-data endpoint. One-line removal. *(HIGH, S)*
2. **Gate `/api/risansi/validate-revenue-codes`** — add session + admin check; it's an open client-enumeration oracle. *(HIGH, S)*
3. **Fix `deleteUpload` to delete by `upload_id`** — the one CRITICAL; add the column, stamp it on insert. *(CRITICAL, M)*
4. **Add ownership checks to the task actions** — `deleteTask`, `updateTaskStatus` (and mirror on `addTask`) so cross-tour tampering stops. *(HIGH, S each)*
5. **Add ownership checks to the contact actions** — `add/update/deleteContact` leak/tamper contact PII by id. *(HIGH, S)*
6. **Session-gate `listSalesOrders` / `listPurchaseOrders`** — exported actions with no auth. *(HIGH, S)*
7. **Harden the quotation upload** — require PDF magic bytes; serve with a hardcoded content-type + `nosniff` to kill the stored-XSS. *(HIGH, S)*
8. **Turn on TLS verification for Postgres** — ship the provider CA, `rejectUnauthorized: true`. *(HIGH, S)*
9. **A shared `requireApprovedSession()` for every API route** — one helper, applied across `/api/risansi/**`, fixes the systemic "each route decides for itself" gap and closes the revoked-user-still-works hole. *(HIGH, M)*
10. **Log inside the `q()` wrapper (and add error monitoring)** — a swallowed query error currently renders the exec dashboard as ₹0 with no signal. *(MEDIUM, M — but very high leverage: it's how every other bug hides.)*

## Quick wins (CRITICAL/HIGH at effort S)

Do these first — each is under an hour: #1, #2, #4, #5, #6, #7, #8 above, plus the `is_active=FALSE` on `revokeAccess`. Roughly a day together, and they close every open-internet and cross-tenant hole except the CRITICAL (which is M) and the systemic route helper (M).

## Sequenced plan

### Wave 1 — Stop the bleeding (security CRITICAL/HIGH + the data-loss bug)
Items: quick-wins list above + the CRITICAL `deleteUpload` fix + `requireApprovedSession()` rollout. Dependencies: the route helper (#9) should land before or with the per-route gates so they share one implementation. **Effort: ~1.5 days.**
Verify after: hit `/api/debug-db` and `/api/risansi/validate-revenue-codes` unauthenticated → expect 401/404; as a rep, attempt `deleteTask`/`updateTaskStatus`/contact edits on another tour's records → expect rejection; upload a non-PDF as a quote → expect rejection; re-run an upload+undo across two same-month uploads → expect only the undone one removed; confirm the DB connects with `rejectUnauthorized: true`.

### Wave 2 — Quick wins & correctness (S-effort MEDIUM/LOW that mislead users)
Items: log inside `q()`; scope the `field/page.tsx` Activities query for managers (currently leaks all tasks company-wide); fix the timezone date-shift bugs (overdue flags, export filenames, planned-visit default); remove leftover debug `console.log` blocks; add try/catch to `DeleteOppButton` and the silent upload-delete buttons; backfill `schema_migrations` for 0041–0047. **Effort: ~1 day.**
Verify: a manager sees only their tours' actions; a task due today is not flagged overdue in IST; `migrate.mjs --status` shows nothing pending.

### Wave 3 — Performance & cost
Items: add `LIMIT`/tab-guards to the unbounded Map-tab and roster queries; paginate any full-table client fetch shipped to the browser; review the correlated-subquery hot paths if the client base grows. **Effort: ~0.5–1 day.** Depends on nothing above.
Verify: network payloads on the Field map and dashboard drop; no query returns the full client set to the client.

### Wave 4 — UX simplification & governance
Items: fix the broken `.shimmer`/`.skeleton` skeletons; replace hardcoded light hex with dark-mode tokens (filter pills, Add-Rep/Tour modals, layout backgrounds); delete dead code (`RisansiSidebar`, `FYSelector`, unused `_isMobile`); add response security headers (CSP, X-Frame-Options, nosniff, HSTS); stand up minimal CI (tsc + lint + build) and an error monitor; finish the shared-filter-builder swap on the board. **Effort: multi-day.**
Verify: dark mode has no light bands; `next build` in CI blocks on type/lint errors; errors surface in a monitor rather than the console.

## Coverage and blind spots

- The **arch** and **journeys** mapping agents were cut off by the session usage limit; those sections in AUDIT-MAP.md are hand-authored from this session's tracing. Re-run the `infra,map-arch,map-journeys` wave after the limit resets for an independent pass.
- **Runtime behaviour** (bell polling, autosave restore, drag-drop, email deliverability) is unverifiable by static read — exercise in a browser.
- **Not audited:** `design/`, `public/`, `.claude/`, and git history for deleted secrets. The three already-known items from the pre-audit spot-check (contact IDOR, `deleteOpportunity` cascade, `updateOpportunity` NULL-wipe) are folded into the register.
- Author's note: several findings concern code written earlier in this same session (offer-revision, stage, filter modules; the `schema_migrations` drift is self-caused). They were held to the same adversarial-verification bar as everything else.
