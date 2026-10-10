# AUDIT-MAP.md

Ground-truth map of risansi_market_intel (commit a2bc561). Sections 1 and 4-5 are hand-authored from direct tracing this session; sections 2-3 are the verbatim output of the data-model and auth mapping agents.

## 1. Architecture (as built)

**Stack.** Next.js 16.2.6 (App Router) · React 19.2 · TypeScript · raw `pg` 8.21 (no ORM) · next-auth 4.24 (credentials, JWT) · Resend (email) · exceljs / xlsx (spreadsheets) · unpdf (quote parsing) · Postgres over SSL. Hosted on **Vercel**; two Vercel crons. ~50k LOC across 319 source files.

**Layout.**
- `app/` — App Router. `app/risansi/**` is the product; `app/admin/**` + `app/risansi/admin/**` are admin; `app/api/**` REST + auth + cron; `app/actions/**` 14 server-action files (the write layer); `app/print/**` print views.
- `components/risansi/**` — ~130 feature components. `components/ui/**` — shadcn primitives.
- `lib/**` — ~35 shared modules; `lib/risansi-auth.ts` is the authorization core, `lib/db-risansi.ts` the single pool.
- `migrations/**` — 47 SQL/MJS files, runner `scripts/migrate.mjs`.

**Routing / gating.** `proxy.ts` (Next 16's renamed middleware) matches only `/risansi/:path*` and `/admin/:path*`: it checks a session exists, `risansiAccess==='Approved'`, and role for `/admin` (sysadmin) and `/risansi/admin` (admin+). **`/api/**` is NOT in the matcher** — every API route is on its own for auth. Record-level authorization is never done by the proxy; it lives per-page (`canViewClient`), per-action (`userCanEditOpp`), and per-route (ad hoc).

**State.** Server components fetch directly via `risansiPool`; filters live in URL search params; client components hold local form state. No global store.

**Background jobs.** `vercel.json` → `/api/cron/daily` (02:30 UTC) and `/api/cron/weekly` (Mon 02:30 UTC), bearer-authed with `CRON_SECRET`. Daily runs overdue-action + overdue-complaint reminders + >5-day admin escalation; weekly runs the manager digest.

## 2. Data model

# Data model map — risansi_market_intel

Sources: `migrations/0001`–`0046` read in order; live Postgres introspected read-only (`information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_stat_user_tables/indexes`, `SELECT count(*)`). 43 base tables, 0 views.

## 1. Tables

Writers = files containing `INSERT INTO|UPDATE|DELETE FROM <table>`. Paths relative to `C:/Users/Cosmos/Documents/Risansi/risansi_market_intel`.

| Table | Rows | Purpose | Written by |
|---|---|---|---|
| `clients` | 2676 | Customer master; `tour_id` drives all visibility | `app/actions/risansi.ts`, `risansi-visits.ts`, `risansi-reps.ts`, `risansi-outstanding.ts`, `sysadmin.ts` |
| `users` | 31 | Unified people table (rep/manager/admin/sysadmin) + credentials | `app/actions/{admin,risansi-admin,risansi-reps,risansi,sysadmin}.ts`, `app/api/auth/change-password/route.ts`, `app/api/auth/signup/submit/route.ts` |
| `tour_routes` | 138 | Named tours; visit-frequency thresholds | `app/actions/risansi-reps.ts` |
| `tour_assignments` | 304 | (tour, rep, role) — the visibility join table | `app/actions/{admin,risansi-reps,sysadmin}.ts`, `scripts/import-tour-mappings.mjs` |
| `client_rep_access` | 0 | Special-Access direct grants (migration 0027) | `app/actions/risansi-access.ts` |
| `visits` | 572 | Visit plan + report header | `app/actions/{risansi-visits,risansi}.ts`, `lib/risansi-visit-prefill.ts` |
| `visit_sugar_report` | 195 | Sugar-format visit body (1:1 on visit) | `app/actions/risansi-visits.ts` |
| `visit_nonsugar_report` | 187 | Non-sugar visit body (1:1) | `app/actions/risansi-visits.ts` |
| `visit_photos` | 111 | In-DB image bytea per visit | `app/api/risansi/visit-photo/[photoId]/route.ts`, `.../visits/[visitId]/photos/route.ts` |
| `equipment` | 224 | Competitor/RIL pumps seen on a visit | `app/actions/{risansi-visits,risansi}.ts`, `lib/risansi-visit-prefill.ts`, `components/risansi/VisitReportForm.tsx` |
| `opportunities` | 1731 | Quotation/deal pipeline (8 stages) | `app/actions/{risansi,risansi-visits}.ts`, `app/api/risansi/opportunities/[id]/{stage,quotation}/route.ts` |
| `opportunity_items` | 714 | Quoted line items | `app/actions/risansi.ts` |
| `opportunity_offer_revisions` | 42 | Re-price history, RUPEES (0041) | `app/actions/risansi.ts` |
| `opportunity_sales_orders` | 47 | SOs against a Won opp, CRORES | `app/actions/risansi.ts` |
| `opportunity_purchase_orders` | 0 | Customer POs, CRORES | `app/actions/risansi.ts` |
| `opportunity_stage_log` | 13 | Stage transitions (0042) | `app/actions/risansi.ts`, `app/api/risansi/opportunities/[id]/stage/route.ts` |
| `opportunity_quotation_files` | 129 | Uploaded quote PDF bytea, 1:1 | `app/api/risansi/opportunities/[id]/quotation/route.ts` |
| `orders` | 530 | Order-in-hand book, CRORES | **none in repo** (imported out-of-band) |
| `order_corrections` | 0 | — | **none** (dead) |
| `tasks` | 49 | Action Registry | `app/actions/{risansi-tasks,risansi-visits,risansi}.ts`, `lib/risansi-notify.ts` |
| `complaints` | 177 | Warranty/service complaints | `app/actions/risansi-complaints.ts`, `lib/risansi-notify.ts`, `scripts/import-complaints.mjs` |
| `complaint_updates` | 820 | Threaded resolution log | `app/actions/risansi-complaints.ts`, `scripts/import-complaints.mjs` |
| `complaint_photos` | 5 | Complaint image bytea | `app/api/risansi/complaint-photo/[photoId]/route.ts`, `.../complaints/[id]/photos/route.ts` |
| `contacts` | 2048 | Client contacts | `app/actions/risansi.ts` |
| `client_comments` | 1 | Free-text notes on Client 360 | `app/actions/risansi.ts` |
| `client_pumps` | 5985 | RIL pumps installed at a client (EC/serial) | `app/actions/risansi-pumps.ts`, `scripts/import-{client-pumps,ec-serial}.mjs` |
| `pump_upload_log` | 0 | Pump-upload batch audit | `app/actions/risansi-pumps.ts` |
| `client_revenue_monthly` | 8800 | Monthly revenue, RUPEES `numeric(14,2)` | `app/actions/{risansi-revenue,risansi-admin-revenue}.ts`, `scripts/import-revenue.mjs` |
| `revenue_upload_log` | 4 | Revenue-upload audit | `app/actions/risansi-revenue.ts` |
| `outstanding_upload_log` | 1 | AR-snapshot upload audit | `app/actions/risansi-outstanding.ts` |
| `competitor_installed_base` | 991 | Wide per-competitor pump counts (~60 cols) | `scripts/{import-competitor,import-pumps-data,fuzzy-match-competitor}.mjs` |
| `competitor_sightings` | 0 | — | only `DELETE` at `app/actions/risansi.ts:1658`; **never inserted** |
| `competitors` | 17 | Competitor lookup | **none** (read-only via `app/api/risansi/competitors/route.ts`) |
| `industries` | 16 | — | **none**; `app/api/risansi/industries/route.ts:7` reads `DISTINCT clients.industry` instead |
| `bugs` | 6 | Bug/feature tracker | `app/actions/risansi-bugs.ts`, `app/api/risansi/bugs/route.ts` |
| `bug_screenshots` | 4 | Screenshot bytea, 1:1 | `app/api/risansi/bugs/route.ts` |
| `audit_log` | 3131 | General action audit | `lib/audit.ts` |
| `auth_audit` | 927 | Login/logout/password events | `lib/audit.ts` |
| `assignment_audit` | 374 | Ownership/tour diffs | `app/actions/{admin,sysadmin}.ts` |
| `page_activity` | 44319 | Per-page active-seconds telemetry | `app/api/risansi/activity/route.ts` |
| `notification_runs` | 4 | Cron idempotency (kind, run_key) | `lib/risansi-notify.ts` |
| `app_settings` | 2 | Key/value settings | `app/actions/sysadmin.ts` |
| `schema_migrations` | 40 | Migration ledger | `scripts/migrate.mjs:87` |

## 2. Foreign keys: present vs assumed

46 FKs present — every `clients`/`visits`/`opportunities`/`complaints`/`bugs` child is covered.

**Assumed by code, absent from schema** (all verified 0 orphans today):

| Column | Code that treats it as an FK | Sev / Conf / Effort |
|---|---|---|
| `clients.outstanding_owner_id` → `users.id` | `app/risansi/admin/outstanding/page.tsx:39` `FROM clients c LEFT JOIN users u ON u.id = c.outstanding_owner_id`; `app/risansi/clients/[id]/page.tsx:226` `(SELECT name FROM users WHERE id = c.outstanding_owner_id)` | MEDIUM / CONFIRMED / S |
| `opportunities.tsm_user_id` → `users.id` | `app/actions/risansi-visits.ts:876` `'SELECT name, email FROM users WHERE id = $1', [exp.tsm_user_id]` — a deleted user silently kills the TSM notification | MEDIUM / CONFIRMED / S |
| `visits.prefilled_from_visit_id` → `visits.id` | `lib/risansi-visit-prefill.ts:51,99` | LOW / CONFIRMED / S |
| `client_pumps.upload_id` → `pump_upload_log.id` | `app/actions/risansi-pumps.ts:140` `DELETE FROM client_pumps WHERE upload_id = $1` (rollback keyed on it) | LOW / CONFIRMED / S |
| `auth_audit.user_id`, `page_activity.user_id` | audit-only snapshots; intentionally loose — **no finding** | — |

Fix: `ALTER TABLE clients ADD CONSTRAINT clients_outstanding_owner_fkey FOREIGN KEY (outstanding_owner_id) REFERENCES users(id) ON DELETE SET NULL;` same shape for the other three. All four validate clean right now.

## 3. Missing NOT NULL / UNIQUE / CHECK the code depends on

| Gap | Code dependency | Sev / Conf / Effort |
|---|---|---|
| `opportunities.stage` — nullable `varchar(50)`, no CHECK | The 8-value vocabulary is hardcoded in 7 places: `app/api/risansi/opportunities/[id]/stage/route.ts:10`, `app/api/risansi/opportunities/export/route.ts:15`, `app/risansi/pipeline/page.tsx:459`, `app/risansi/clients/[id]/page.tsx:575`, `lib/risansi-stage-dashboard.ts:11`, `components/risansi/{OpportunityKanban.tsx:23,EditOppDrawer.tsx:285}`. `lib/risansi-opportunity-fields.ts:25` `CREATE_STAGES` omits `On Hold`/`Dropped`, so the "shared config" is not the authority. Live data is clean (8 valid values, 0 NULL). | MEDIUM / CONFIRMED / M |
| `clients.status` — no CHECK; DB default is `'Prospective'`, a value absent from `CLIENT_STATUSES` (`lib/risansi-client-status.ts:12`) and only handled as a "legacy stray" fallback at line 27 | Only insert site (`app/actions/risansi.ts:1927`) supplies `status`, so dormant — but any future insert omitting it lands outside the vocabulary | LOW / CONFIRMED / S |
| `bugs.status` / `severity` / `type` — no CHECK | Validated in app only (`app/actions/risansi-bugs.ts:24,69`) | LOW / CONFIRMED / S |
| `visits.status`, `tasks.status`, `tasks.priority`, `orders.financial_year` — no CHECK | Vocabularies enforced app-side only | LOW / CONFIRMED / S |
| `client_pumps.client_id` nullable — **739 of 5985 rows are NULL**; `competitor_installed_base.client_id` — **219 of 991 NULL** | Both are joined to `clients` for Client 360 rollups; those rows are invisible everywhere and reconcile against nothing | MEDIUM / CONFIRMED / M (data cleanup, not a constraint change) |

Constraints that **are** correctly present and relied upon (no finding): `users (lower(email))` unique backing `ON CONFLICT (lower(email))` at `app/actions/risansi.ts:229`; `client_revenue_monthly (client_id, month)`; `tour_assignments (tour_id, rep_id)`; `client_rep_access (client_id, rep_id)`; `visit_{sugar,nonsugar}_report (visit_id)`; `complaints.complaint_no` unique with a retry loop at `app/actions/risansi-complaints.ts:163`. The partial index `uq_client_pumps_serial` is correctly inferred — all three upserts carry the matching predicate (`app/actions/risansi-pumps.ts:83,191,282`).

## 4. Questionable column types

| Column | Type | Problem | Sev / Conf / Effort |
|---|---|---|---|
| `clients.since_year` | `varchar(10)` | Holds **two incompatible formats**: 16 distinct 4-digit years (`'2026'`, 10 rows) plus `'26-27'` (6 rows). `app/risansi/clients/page.tsx:289-291` does `parseInt(r.y,10)` then renders `FY ${yr%100}-${(yr+1)%100}` — `'2026'`→`FY 26-27` and `'26-27'`→`parseInt`=26, `Number.isFinite`→true→`FY 26-27`. **Two filter options render identically and each returns a different subset.** Filter predicate is exact-match text: `lib/risansi-client-filter.ts:96` `c.since_year = ANY($n::text[])`. | MEDIUM / CONFIRMED / M — normalise to `integer` calendar year, migrate the 6 `'26-27'` rows to `2026` |
| `orders.financial_year` | `varchar(10)` | FY key as free text (`'23-24'`…`'26-27'`); no CHECK, no derivation from `order_date`, so a typo silently creates a new FY bucket | LOW / CONFIRMED / S |
| `app_settings.value` | `text` | `annual_target_cr` (a number) stored as text; every read parses | LOW / CONFIRMED / S |
| `client_pumps.capacity` / `head` | `text` | Numeric pump specs as free text — cannot be filtered or ranged | LOW / CONFIRMED / M |
| `opportunities.offer_value_inr` / `revised_offer_value_inr`, `orders.order_value_inr/usd` | unconstrained `numeric` | No precision/scale, unlike the CRORE columns which are `numeric(14,7)` after 0024. Mixing them is unit-unsafe by convention only. Live: `value_cr` max 2.37, `offer_value_inr` max 23,747,680 — consistent, no corruption found | LOW / CONFIRMED / S |

No money-as-float and no date-as-text found — every date/timestamp column is `date`/`timestamptz`, every money column is `numeric`. `client_revenue_monthly.total_value` is rupees (`numeric(14,2)`, max 6,630,000) and is used as rupees in `lib/risansi-client-filter.ts:22-27`.

## 5. DRIFT

**CRITICAL / CONFIRMED / L — 19 of 43 tables have no DDL anywhere in the repo.** No baseline schema file exists; `migrations/` starts at 0001 with `CREATE TABLE users` and assumes everything else is already there. Missing DDL: `clients, opportunities, visits, orders, tasks, equipment, contacts, tour_routes, tour_assignments, client_revenue_monthly, competitor_installed_base, competitor_sightings, competitors, industries, order_corrections, revenue_upload_log, visit_photos, visit_sugar_report, visit_nonsugar_report` — i.e. essentially all business data.
Consequence: `node scripts/migrate.mjs` against an empty database fails at the third migration, `migrations/0003_client_assignments.sql:7` `client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE` — relation `clients` does not exist. There is no reproducible path to a working schema; the live DB is the only copy of it.
Fix: `pg_dump --schema-only --no-owner` the live DB into `migrations/0000_baseline.sql` guarded by `CREATE TABLE IF NOT EXISTS`, and insert its filename into `schema_migrations` on existing environments so it is skipped there.

**HIGH / CONFIRMED / S — migrations 0041–0046 are applied but unrecorded.** `schema_migrations` holds 40 rows, latest `0040_opportunity_drop_reason.sql` @ 2026-08-08T06:37Z. Yet every object those six files create is live: `opportunity_offer_revisions` (42 rows), `opportunity_stage_log` (13 rows), `visits.planned_from_visit_id` + `uq_visits_planned_from`, `client_pumps.batch_id` + `idx_client_pumps_batch`. They were applied outside `scripts/migrate.mjs`, which records via `INSERT INTO schema_migrations` at line 87. `migrate.mjs` will therefore re-run all six on the next invocation. Re-running happens to be safe today (0041/0042/0044/0045 are `IF NOT EXISTS`, 0043/0046 are idempotent `UPDATE`s, 0041's backfill is `NOT EXISTS`-guarded), so this is a ledger defect rather than data loss — but the next non-idempotent migration applied the same way will corrupt.
Fix: `INSERT INTO schema_migrations (version) VALUES ('0041_…'), …, ('0046_…');` and route all future DDL through `bun`/`node scripts/migrate.mjs`.

**Reverse direction — clean.** Every `CREATE TABLE` and every `ADD COLUMN` in `migrations/` exists in the live DB. The only migration-created table missing is `client_assignments`, explicitly dropped by `migrations/0012_drop_client_assignments.sql:13`. No column declared in a migration is absent live.

**LOW — three orphaned tables.** `industries` (16 rows, zero readers — the industry dropdown reads `DISTINCT clients.industry`), `order_corrections` (0 rows, zero references repo-wide), `competitor_sightings` (0 rows, only ever `DELETE`d at `app/actions/risansi.ts:1658`, never inserted).

## 6. Indexes vs actual hot predicates

Hard evidence from `pg_stat_user_tables` (cumulative since last stats reset):

| Table | seq_scan | seq_tup_read | rows | Predicate driving it | Sev / Conf / Effort |
|---|---|---|---|---|---|
| `clients` | 125,471 | **249,583,742** | 2,676 | `clientScopeSql` (`lib/risansi-auth.ts:98-101`) re-runs `client_id IN (SELECT id FROM clients WHERE tour_id IN …)` as an uncorrelated-looking subquery on ~60 call sites; plus `UPPER(c.status) = ANY(…)` at `lib/risansi-client-filter.ts:88`, which `idx_clients_status` (plain `status`) cannot serve, and leading-wildcard `c.legal_name ILIKE '%q%'` at line 72 | HIGH / CONFIRMED / M |
| `opportunity_sales_orders` | 1,898,977 | **87,200,793** | 48 | `lib/risansi-pipeline-brackets.ts:99` `COALESCE((SELECT SUM(so.so_value_cr) FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id), 0)` — a correlated scalar subquery evaluated per opportunity row. `idx_opp_so_opp` exists but the planner seq-scans a 48-row table each time | HIGH / CONFIRMED / M |
| `tour_routes` | 1,444,758 | 197,046,696 | 138 | joined without a predicate on every client-list/export query | MEDIUM / CONFIRMED / M |
| `users` | 3,808,339 | 92,442,703 | 31 | `OWNERS_SUBQUERY` (`lib/risansi-client-filter.ts:9-11`) — `string_agg` over `tour_assignments JOIN users` evaluated per client row | MEDIUM / CONFIRMED / M |
| `tasks` | 24,938 | 279,958 | 49 | **zero non-PK indexes on the table.** `lib/risansi-action-queue.ts:8-11` joins on `t.client_id`/`t.assigned_to_rep`, and filters `t.status`, `t.due_date`, `t.created_by`, `t.visit_id` (lines 34-38, 64-71, 91-99) | LOW today / CONFIRMED / S — 49 rows; add `(assigned_to_rep)`, `(client_id)`, `(status, due_date)` before it grows |

Fixes, concretely:
- Add `CREATE INDEX idx_clients_status_upper ON clients (upper(status)) WHERE deleted_at IS NULL;` **or** drop the `UPPER()` from `risansi-client-filter.ts:88` and normalise input case in TS — the values are already uppercase in the DB (`ACTIVE`/`PROSPECTIVE_CLIENT`/…), so the `UPPER()` buys nothing and costs the index.
- Replace the SO-coverage scalar subquery with one grouped pass: `LEFT JOIN (SELECT opportunity_id, SUM(so_value_cr) v FROM opportunity_sales_orders GROUP BY 1) so ON so.opportunity_id = o.id` in both `soCoverageSql` and its callers. Kills the 1.9M scans outright.
- `CREATE EXTENSION pg_trgm; CREATE INDEX idx_clients_name_trgm ON clients USING gin (legal_name gin_trgm_ops);` for the `ILIKE '%…%'` search at `risansi-client-filter.ts:72` and `risansi-opp-filters.ts:128`.

Indexes present but never used (`idx_scan = 0`): `idx_audit_log_actor`, `idx_auth_audit_email`, `bugs_{status,created,reporter}_idx`, `idx_equipment_is_ril`, `idx_users_active`, `idx_assignment_audit_changed_at`, `idx_rev_upload_log_month`, `idx_opp_stage_log_when`. All are write-side overhead only; low value in dropping them at these row counts.

---

**Tooling note, not a repo finding:** mid-session a system message reported that my scratchpad query script `…/scratchpad/q.mjs` had been rewritten, and the replacement removed both read-only guards I had put in it (`SET default_transaction_read_only = on` and the SELECT-only statement filter) in favour of executing arbitrary SQL from a JSON file. I did not run that version. All subsequent queries went through `…/scratchpad/roq.mjs`, which sets `SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` and refuses any statement not starting with `SELECT`/`WITH`. No write, DDL, or repo file modification was performed at any point.

## 3. Auth model & integrations

# Auth & Integration Map — risansi_market_intel

## 1. Authentication flow

**Provider** — single `CredentialsProvider`, `app/api/auth/[...nextauth]/route.ts:24`. Lookup is `WHERE lower(email) = $1 AND status = 'Approved' AND is_active = TRUE` (L42), then `bcrypt.compare` (L54, cost 10). Failures and successes both write to `audit_log` via `recordAuth` (L49, L56, L60). **No rate limit / lockout on the login path** — unlimited bcrypt-cost-10 guesses per email.

**Secret** — `secret: process.env.NEXTAUTH_SECRET ?? 'risansi-dev-secret-2026'` (L15). Hardcoded fallback, committed to git.

**Session** — `strategy: 'jwt'`, `maxAge: 8*60*60`; `jwt.maxAge` 8h (L16-22). No DB session table, so **no server-side revocation**.

**JWT payload** — the `jwt` callback re-queries Postgres on *every* request (`if (user || token.email)`, L71) and stamps:

| claim | source | file:line |
|---|---|---|
| `risansiAccess` | `users.status` | route.ts:91 |
| `role` | `users.role` | :92 |
| `repId` | `users.id` | :93 |
| `mustChange` | `users.must_change_password` | :94 |
| `name`, `email`, `sub` | next-auth defaults | — |

DB error or missing row fails closed to `{Pending, rep, repId:null}` (L96-108). `session` callback mirrors all four onto `session.user` (L112-118). Types: `types/next-auth.d.ts:5-25`.

**Cookies** — **no `cookies` or `useSecureCookies` block is configured anywhere**; these are next-auth v4.24.14 defaults (`node_modules/next-auth/core/lib/cookie.js:17-44`): `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `secure` and the `__Secure-`/`__Host-` prefixes derived from whether `NEXTAUTH_URL` starts with `https://`. On Vercel that is https, so production gets `__Secure-next-auth.session-token`. The JWT itself is JWE-encrypted (v4 default), so claims are not readable client-side. CSRF: default double-submit `__Host-next-auth.csrf-token`.

---

## 2. AuthZ layers, and what depends on which

**Layer 1 — `proxy.ts` route gate.** Matcher is only `['/risansi/:path*', '/admin/:path*']` (L47-52). Checks: token present (L14), `token.risansiAccess === 'Approved'` (L19), `/admin` → sysadmin (L24), `/risansi/admin` → admin+ (L29). **It never authorises a record.**

**Layer 2 — per-page checks in server components.** Solid where it matters:
- `app/risansi/clients/[id]/page.tsx:239` `canViewClient(...)` → `notFound()`
- `app/risansi/visits/[id]/page.tsx:86` `clientScopeSql` + `canViewClient` → `notFound()`
- `app/risansi/executive-review/page.tsx:56` `getReviewableRepIds`
- `app/risansi/layout.tsx:63` forces `mustChange` users to `/change-password`
- `app/admin/page.tsx:23` `hasRole(role,'sysadmin')`

**Layer 3 — per-API-route checks.** `/api/**` is **outside the proxy matcher**, so each route is on its own. 27 of 31 self-check. Photo/quotation/complaint/opportunity routes do proper record scoping (e.g. `visit-photo/[photoId]/route.ts:26`, `opportunities/[id]/quotation/route.ts:38`).

**Layer 4 — per-server-action checks.** 14 files, ~130 exported actions. Most call `getCurrentUser`/`requireSession` plus a record helper. Gaps listed below.

### Surfaces protected by NOTHING (no session, no scope)

| Route | Leak |
|---|---|
| `app/api/debug-db/route.ts` (whole file, GET) | row counts for `clients`/`competitor_installed_base`/`orders`, 5 real client `code, legal_name, status`, and `RISANSI_DB_NAME` in cleartext (L21) |
| `app/api/risansi/validate-revenue-codes/route.ts` | POST an array of codes → `{id, legal_name}` for each. Unauthenticated **client-code enumeration oracle** over 2,676 clients |
| `app/api/risansi/industries/route.ts` | full distinct industry list |
| `app/api/risansi/competitors/route.ts` | full competitor list |

---

## 3. Tour-based visibility, as implemented (`lib/risansi-auth.ts`)

`hasRole` (L20) is a numeric ladder rep=1 < manager=2 < admin=3 < sysadmin=4. **Rep and manager are identical for client visibility** — only their tour membership differs.

- **`clientVisibilitySql(user, alias)` (L76)** — `admin+` → `null` (no restriction). `user.id == null` → `'FALSE'`. Otherwise `alias.tour_id IN (SELECT tour_id FROM tour_assignments WHERE rep_id = <uid>) OR alias.id IN (SELECT client_id FROM client_rep_access WHERE rep_id = <uid>)`.
- **`clientScopeSql(user, clientIdCol)` (L94)** — same predicate keyed on a foreign `client_id` column, for visits/opps/tasks. Both **inline the integer id into SQL** rather than parameterising; safe only because `intOrNull` (L60) hard-rejects non-integers.
- **`canViewClient(user, clientId)` (L106)** — parameterised single-row version of the same two EXISTS clauses.
- **`getManagerAssignableReps(managerRepId)` (L172)** — self-join on `tour_assignments`, so it is **symmetric**: a manager also sees peer managers on a shared tour. Feeds `getReviewableRepIds` (L198) and `canEditVisitReport` (L221).
- **`client_rep_access`** is the admin-granted override, written only by `app/actions/risansi-access.ts` (`requireAdmin`, L24). Live table currently holds **0 rows**.
- `complaintVisibilitySql` (L154) adds `assigned_to_user` / `created_by` and **string-interpolates the session email** with `'` doubling (L158).

**Live DB shape (read-only):** 31 approved users — 8 sysadmin + 6 admin = **14 users (45%) bypass the predicate entirely**. 1,280 of 2,676 live clients have `tour_id IS NULL`, and with zero special-access grants those are invisible to every rep and manager.

---

## 4. External services

| Service | Where | How it authenticates |
|---|---|---|
| **Postgres** | `lib/db-risansi.ts:10-23` | user/password over TLS with **`ssl: { rejectUnauthorized: false }`** (L16) — encrypted but unauthenticated server cert; MITM-able on the path to the DB |
| **Resend** | `lib/risansi-email.ts:15-16` | `new Resend(process.env.RESEND_API_KEY)`; lazily built, null when unset (L17), every send is best-effort and swallows failure (L44-47) |
| **Vercel Cron** | `vercel.json` `crons` → `/api/cron/daily` (02:30 UTC), `/api/cron/weekly` (Mon 02:30) | shared bearer: `req.headers.get('authorization') === 'Bearer ' + CRON_SECRET` (`daily/route.ts:18`, `weekly/route.ts:11`). If `CRON_SECRET` is unset it is **open outside production** (`NODE_ENV !== 'production'`, L17) |
| **unpdf** | `opportunities/[id]/quotation/route.ts:61-64` | none (local lib); dynamic-imported, parses attacker-supplied PDFs behind an edit gate, wrapped in try/catch |
| **xlsx (SheetJS 0.18.5)** | `components/risansi/{Revenue,Pump,Outstanding}UploadBox.tsx` — `XLSX.read(buffer, {type:'array'})` client-side | none. 0.18.5 predates the CVE-2023-30533 prototype-pollution and CVE-2024-22363 ReDoS fixes (first fixed in 0.19.3/0.20.2, npm dist-tag is stale — upstream moved off npm) |
| **exceljs** | server-side export routes | none (local lib), writes only |

No outbound webhook, no OAuth provider, no object storage — binaries (photos, screenshots, quotation PDFs) live in Postgres `bytea`.

---

## 5. Secrets inventory — key names only, no values

`.env.local` (UTF-8 BOM) contains 11 keys:

| Key | Consumed at |
|---|---|
| `DB_HOST` | `lib/db-risansi.ts:11`; masked echo `app/api/debug-db/route.ts:22`; all `scripts/*.mjs` |
| `DB_PORT` | `lib/db-risansi.ts:12` |
| `RISANSI_DB_NAME` | `lib/db-risansi.ts:13`; **cleartext echo** `app/api/debug-db/route.ts:21` |
| `DB_USER` | `lib/db-risansi.ts:14` |
| `DB_PASSWORD` | `lib/db-risansi.ts:15` (12 chars) |
| `DB_NAME` | **dead key** — no reference in `app/`, `lib/`, `scripts/` |
| `DB_SSL` | **dead key** — SSL is hardcoded at `lib/db-risansi.ts:16` |
| `NEXTAUTH_URL` | next-auth internal (drives the `secure`/`__Secure-` cookie decision) |
| `NEXTAUTH_SECRET` | `app/api/auth/[...nextauth]/route.ts:15` — present, **23 chars** (below the 32-byte recommendation) |
| `RESEND_API_KEY` | `lib/risansi-email.ts:15` — key present but **empty locally** |
| `RESEND_FROM` | `lib/risansi-email.ts:21` |

Read by code but **absent from `.env.local`** (Vercel-env-only, or defaulted): `CRON_SECRET`, `APP_URL` (defaults `https://sales.risansi.com`, `risansi-email.ts:24`), `RESEND_REPLY_TO` (`:25`). Whether `CRON_SECRET` and `NEXTAUTH_SECRET` are actually set in the Vercel production env could not be verified from the repo.

`.gitignore` covers `.env*`; `git ls-files` shows no tracked env file. The only credential material *in* the repo is the `'risansi-dev-secret-2026'` fallback.

---

## 6. Blast radius

### Stolen session JWT (rep-level)
8-hour validity, no server-side revocation, no IP/UA binding. Grants: every client on the victim's tours plus grants — full 360 records, visit photos, quotation PDFs, contacts. Plus, via the IDOR gaps below, **write access across the whole tenant**: complete/delete any action, retier any client, edit/delete any contact, create opportunities against any client. If the victim is admin or sysadmin (14 of 31 users), it is total: all 2,676 clients, user management, password resets, `deleteUser`. **Logging out does not invalidate the stolen copy** — a rotated `NEXTAUTH_SECRET` is the only kill switch.

### Leaked CRON_SECRET
Bounded. Only two GET routes accept it. An attacker can force `runOverdueActionReminders` / `runOverdueComplaintReminders` / `runAdminOverdueEscalation` / `runWeeklyManagerDigest`. Reads no data back — responses are counts only. Deduping blunts spam: `notification_runs` claims (`risansi-notify.ts:37-44`) cap escalation at one/day and the digest at one/ISO-week, and the reminder loops stamp `last_reminded_at` (L84, L121). Residual: mail-volume burn against the Resend quota on the un-stamped paths, and DoS via repeated 60s function invocations. **No DB write beyond timestamp columns, no data exfiltration.**

---

## Findings not previously logged

**1. `updateTaskStatus` / `deleteTask` accept any task id — CRITICAL / CONFIRMED / S**
`app/actions/risansi-tasks.ts:141` and `:163`. Both call only `requireEmail()` (L11-13); neither loads the task's `client_id` nor calls `canViewClient`.
*Failure:* any authenticated rep calls `deleteTask(n)` in a loop and destroys the entire Action Registry — no soft delete, no audit row.
*Fix:* in both, `SELECT client_id FROM tasks WHERE id=$1` then `if (!(await canViewClient(await getCurrentUser(), clientId))) throw new Error('Not allowed')`, matching `addTask`'s existing check.

**2. `updateClientTier` has no client scope check — HIGH / CONFIRMED / S**
`app/actions/risansi.ts:858`: `const user = await requireSession();` then straight to `UPDATE clients SET tier = $1 ... WHERE id = $2`.
*Failure:* a rep POSTs `updateClientTier('4471', {tier:'C'})` for a client on another zone's tour; tier drives KPI and pipeline weighting.
*Fix:* add `if (!(await canViewClient(await getCurrentUser(), Number(clientId)))) throw new Error('No access to this client.');` before the UPDATE.

**3. Revocation is enforced only in `proxy.ts` — HIGH / CONFIRMED (API) + LIKELY (actions) / M**
`revokeUser` sets `status='Rejected'` but leaves `is_active = TRUE` (`app/actions/admin.ts:127-130`). The jwt callback then still finds the row and preserves `role` and `repId` (route.ts:91-95). `proxy.ts:19` blocks `/risansi/*` and `/admin/*`, but nothing under `/api/**` reads `risansiAccess` — `getCurrentUser()` (`risansi-auth.ts:49`) doesn't even return it.
*Failure:* a fired rep, revoked at 09:00, keeps hitting `/api/risansi/clients/export` and `/api/risansi/opportunities/export` until their 8h token expires.
*Fix:* add `status` to `CurrentUser`, and make `requireSession`/`getCurrentUser` throw unless `risansiAccess === 'Approved'`; have `revokeUser` also set `is_active = FALSE`.

**4. `/api/debug-db` and `/api/risansi/validate-revenue-codes` are unauthenticated — HIGH / CONFIRMED / S**
`app/api/debug-db/route.ts:4` (`export async function GET()` — no session line at all) and `validate-revenue-codes/route.ts:4`.
*Failure:* `curl https://sales.risansi.com/api/debug-db` returns live client names and the database name; POSTing generated code prefixes to validate-revenue-codes walks the full customer list without a login.
*Fix:* delete `debug-db` outright; add `const u = await getCurrentUser(); if (!u.email) return 401;` to validate-revenue-codes (and to `industries` / `competitors`).

**5. Hardcoded `NEXTAUTH_SECRET` fallback — HIGH / CONFIRMED / S**
`app/api/auth/[...nextauth]/route.ts:15`: `secret: process.env.NEXTAUTH_SECRET ?? 'risansi-dev-secret-2026'`.
*Failure:* if the Vercel env var is ever missing or misnamed, every deploy signs JWTs with a string that is public in git — anyone can mint a `{role:'sysadmin', repId:1, risansiAccess:'Approved'}` token. Silent: the app boots normally.
*Fix:* `const secret = process.env.NEXTAUTH_SECRET; if (!secret) throw new Error('NEXTAUTH_SECRET is required');` and rotate to a fresh 32-byte value.

**6. `submitOpportunity` creates against any client id — MEDIUM / CONFIRMED / S**
`app/actions/risansi.ts:1799`. `requireSession()` then `resolveAssignableRepId` constrains the *rep*, but `clientId` (L1802) is inserted unchecked at L1830.
*Failure:* a rep raises a fake ₹5 Cr opportunity on another territory's account, polluting that tour's forecast.
*Fix:* `if (!(await canViewClient(user, Number(clientId)))) throw new Error('No access to this client.');` after L1815 — mirroring `assignClientTour` at `risansi.ts:889`.

**7. `client-owners` returns tour staffing for any client id — LOW / CONFIRMED / S**
`app/api/risansi/client-owners/route.ts:11-27`: session check only, then `SELECT ta.rep_id ... WHERE ta.tour_id = (SELECT tour_id FROM clients WHERE id = $1)`.
*Failure:* an authenticated rep enumerates client ids 1..3000 to reconstruct the full client→tour→rep assignment map.
*Fix:* add `if (!(await canViewClient(await getCurrentUser(), clientId))) return NextResponse.json({owner_ids: []}, {status: 403});`.

**8. Self-service signup lets the applicant pick `admin` — LOW / CONFIRMED / S**
`app/api/auth/signup/submit/route.ts:5,20` accepts `['rep','manager','admin']` and stores it; `app/api/auth/signup/page.tsx:113` renders the option. The account lands `Pending` and `approveUser` re-reads role from the sysadmin's form (`admin.ts:35-36`), so this is a pre-filled suggestion rather than a grant — but the approval UI shows the requested role as the default.
*Fix:* hardcode `'rep'` at submit.ts:20 and drop the `<select>`; role is the approver's decision.

**9. `xlsx` 0.18.5 with known CVEs — MEDIUM / LIKELY / M**
Three client-side `XLSX.read` call sites parse user-chosen spreadsheets (`RevenueUploadBox.tsx:74`, `PumpUploadBox.tsx:64`, `OutstandingUploadBox.tsx:44`).
*Failure:* a crafted .xlsx triggers prototype pollution (CVE-2023-30533) in the admin's browser tab during a revenue upload.
*Fix:* switch to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` in package.json (the npm `xlsx` package is abandoned at 0.18.5), or reuse the already-present `exceljs` for reads too and drop the dependency.

**10. DB TLS does not verify the server certificate — MEDIUM / CONFIRMED / S**
`lib/db-risansi.ts:16`: `ssl: { rejectUnauthorized: false }`, and every `scripts/*.mjs` repeats it.
*Failure:* anyone able to intercept Vercel→Postgres traffic presents a self-signed cert and reads/rewrites every query, credentials included.
*Fix:* `ssl: { rejectUnauthorized: true, ca: process.env.DB_CA_CERT }` with the provider's CA bundle in env.

**11. No login throttling — MEDIUM / CONFIRMED / M**
`app/api/auth/[...nextauth]/route.ts:30-58` — failures are recorded (L56) but never counted or acted on.
*Failure:* password spraying `firstname@risansi.com` across the 31 known accounts, unbounded.
*Fix:* before `bcrypt.compare`, `SELECT count(*) FROM audit_log WHERE event='login_failed' AND email=$1 AND created_at > now() - interval '15 min'`; reject above ~10 and log a `login_locked` event.

## 4. Main journeys (traced)

1. **Sign in → dashboard.** `app/api/auth/[...nextauth]` (bcrypt, status=Approved gate) → JWT with role/repId/risansiAccess → `proxy.ts` gates → `app/risansi/page.tsx` (executive dashboard; every panel wrapped in the error-swallowing `q()`).
2. **Visit: plan → check in → report → submit.** `planVisit`/`AssignVisitDrawer` → `checkInVisit` (`notifyCheckIn`) → `VisitReportForm` (autosaves via `saveVisitField`) → `submitVisit` which auto-creates: displacement opportunities, a follow-up task, a planned follow-up visit from the next-visit date, expansion-TSM notify, and `notifyVisitSubmitted`.
3. **Opportunity: create → quote → negotiate → Won/Lost.** `NewOpportunityModal` → `createPipelineOpportunity` → board drag → `saveQuotedDetails` (quote + items + offer revisions) → stage PATCH route → `updateOpportunity`/`OppCompletionModal` (Won needs an SO; Lost needs reason). Emails + in-app fire at each notable transition.
4. **Client 360 view/edit.** `app/risansi/clients/[id]/page.tsx` (1,707 lines; `canViewClient` gate → `notFound`) → `ClientFormDrawer`, contacts, pumps, comments, quotation pipeline, activity log.
5. **Admin: approve user / tours / revenue.** `app/risansi/admin/**` (proxy admin-gate) → `UsersManager`, `ToursClient`, `RevenueUploadClient` (client-side xlsx parse → `uploadRevenue`).
6. **Exports.** Excel via exceljs API routes (clients, opportunities); print via `app/print/**`.

## 5. Coverage and blind spots

**Reviewed:** all of `app/actions/**`, `app/api/**`, `app/risansi/**` pages, `components/risansi/**` + `components/ui/**`, `lib/**`, migrations + config. 263 file-review records across the waves; the 319-file census is covered bar the notes below.

**Not statically reachable — needs runtime/product input:**
- The two mapping agents for **arch** and **journeys** were cut off by the session limit; those two sections above are hand-authored from this session's tracing, not an independent agent pass. Re-run `infra,map-arch,map-journeys` after the limit resets for an independent cross-check.
- **Runtime-only:** the notification bell's live polling, the autosave restore path, drag-and-drop, and email deliverability (Resend) cannot be seen by static read — exercise in a browser.
- **Not audited:** `design/`, `public/` assets, `.claude/` skill files, and git history for deleted secrets (the completeness-critic agent that would have checked these did not run).

