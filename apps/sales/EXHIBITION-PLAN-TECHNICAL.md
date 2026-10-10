# Exhibition Module — Consolidated Engineering Assessment

**Bottom line:** roughly 60% of the client's workbook is already built, live, and carrying production data. The genuinely new surface is five tables, one visibility helper, an approval workflow (the only true greenfield concept in the spec — this codebase has *no* business-record approval anywhere), and an expense/spend model (the codebase has *no* money-going-out model anywhere). Everything else is reuse or a one-column ALTER.

Two things must be settled before any code: the spec's `users`, `clients`, `client_contacts`, `opportunities`, `followups`, `notifications`, `audit_log` and `documents` tables must be struck from the plan, and the spec's Phase 1 must be deleted outright.

---

## 1. Reuse vs Build

| # | Spec asks for | Verdict | What it maps onto | Work |
|---|---|---|---|---|
| 1 | `users` table / "employee master" | **Reuse as-is** | `users` (31 rows) — `id`, `email`, `name`, `role CHECK IN ('rep','manager','admin','sysadmin')`, `password_hash`, `must_change_password`, `is_active`, `status CHECK IN ('Pending','Approved','Rejected')`, `rep_code`, `initials`, `zone`, `route`, `target_cr`. `migrations/0001_create_users.sql` is the complete current shape (verified: no `ALTER TABLE users` in 0002–0052). | Zero |
| 2 | Authentication / Login | **Reuse as-is** | NextAuth CredentialsProvider + bcryptjs, JWT 8h, `app/api/auth/[...nextauth]/route.ts`. Session carries `role`, `repId`, `risansiAccess`, `mustChange`. | Zero |
| 3 | RBAC | **Reuse as-is** | `hasRole(userRole, requiredRole)` over `ROLE_LEVEL {rep:1, manager:2, admin:3, sysadmin:4}` in `lib/risansi-auth.ts`. 42 call sites. | Zero |
| 4 | Route protection | **Reuse as-is** | `proxy.ts` — matcher `['/risansi/:path*','/admin/:path*']`. Living at `/risansi/exhibitions` is auth- and Approved-gated with no edit. | Zero |
| 5 | User CRUD / approve / roles UI | **Reuse as-is** | `/admin` + `components/risansi/UsersManager.tsx`; tours at `/risansi/admin/reps`. | Zero |
| 6 | `clients` | **Reuse as-is** | Live `clients` (2,676 rows), FK anchor for 15+ tables and the whole visibility model. | Zero |
| 7 | `client_contacts` | **Reuse as-is** | Live `contacts` (2,048 rows) + `addContact` / `updateContact` / `deleteContact` in `app/actions/risansi.ts`. | Zero |
| 8 | `audit_log` | **Reuse as-is** | `audit_log` (3,131 rows) via `recordAudit({action, entityType, entityId, entityLabel, summary, metadata})` in `lib/audit.ts`. Never build `exhibition_audit`. | Zero |
| 9 | `notifications` | **Reuse as-is** | `notifications` (migration 0047) + `pushInApp(userIds, card)` + `NotificationBell` + `/api/risansi/notifications`. `kind` / `section` / `entity_type` are unconstrained text — `'exhibition_submitted'` / `'Exhibitions'` need **no migration**. | 1 line: add `Exhibitions` to `SECTION_HUE` in `NotificationBell.tsx` |
| 10 | Email plumbing | **Reuse as-is** | `sendNotification(card)` / `sendEmail` in `lib/risansi-email.ts`. All six exhibition emails use the one generic branded card — no new template file. | Zero |
| 11 | `followups` | **Reuse `tasks` + extend** | `tasks` already carries title / owner / due_date / priority / status / external assignee, and is read by 7 surfaces plus the daily overdue sweep, the 5-day sysadmin escalation and the weekly manager digest. | 2 nullable FK columns (§2) |
| 12 | `opportunities` | **Reuse + extend** | Live `opportunities` (1,731 rows) with `auto_created` / `auto_source` provenance already used for `'expansion_plan'` and `'displacement'`. | 1 nullable FK column + `auto_source='exhibition'` |
| 13 | `documents` (generic) | **Do not build** | No generic document store exists by design. Pattern is one `bytea` sibling table per attachment type (`opportunity_quotation_files`, `bug_screenshots`, `visit_photos`, `complaint_photos`), each with its own permission-scoped route. | Build `exhibition_expense_files` (+ `exhibition_documents` only if in scope) |
| 14 | `exhibitions` | **Build new** | — | New |
| 15 | `exhibition_team` | **Build new** | Shape mirrors `tour_assignments (tour_id, rep_id, role)`. | New |
| 16 | `exhibition_approvals` | **Build new** | Nothing analogous exists. The only "approve" in the repo is account approval (`approveUser` flipping `users.status`). | New — highest-uncertainty item |
| 17 | `exhibition_expenses` | **Build new** | A full grep for expense/budget/reimburs returns zero real hits. All 43 live tables are revenue-side. | New |
| 18 | `exhibition_meetings` | **Build new** | `visits` is structurally wrong (check-in flow, sugar/non-sugar report bodies, and it writes `clients.last_visit_date` on submit — recording booth chats as visits would corrupt every visit-frequency KPI). | New |
| 19 | "Boss / Approver" role | **Build as permission, not role** | `users.role` has a hard CHECK and a linear 1-2-3-4 ladder; a 5th value forces edits across 10+ files and every `role IN ('rep','manager')` literal. | `hasRole(role,'admin')` + optional `exhibitions.approver_id` |
| 20 | "Exhibition Manager" role | **Build as data** | `exhibition_team.role = 'lead'` + a new `canManageExhibition(user, exhibitionId)` helper. | Small |
| 21 | Visibility for an exhibition | **Build new helper** | Every existing predicate (`clientVisibilitySql`, `clientScopeSql`, `canViewClient`) resolves through `clients.tour_id`. An exhibition has no client and no tour. | New `exhibitionVisibilitySql` |
| 22 | Rep creates a prospect at the stand | **Extend** | `addClient` is admin-gated (`hasRole(...,'admin')` at `app/actions/risansi.ts:1935`) and its only trigger lives on the admin-only clients page. **A rep cannot create a client anywhere in the portal today.** | Extract `createLeadClient()` from `addClient`; add a narrow non-admin `createExhibitionProspect()` |
| 23 | Lead code generation | **Reuse as-is** | `normalizeClientName` / `leadCodeBase` / `uniqueLeadCode` in `lib/risansi-lead-code.ts`; status coupling in `lib/risansi-client-status.ts`. | Zero |
| 24 | Client search picker | **Reuse + extend** | `GET /api/risansi/clients-search` (debounced consumers at `NewOpportunityModal.tsx:81`, `AssignVisitDrawer.tsx:228`). It applies `clientVisibilitySql`, so a rep will not find an off-tour company and will duplicate it. | Add a `clients-match` escape hatch (§3.4) |
| 25 | Money input / parsing | **Reuse as-is** | `parseMoneyInput` / `formatIndian` (`lib/risansi-money.ts`) + `<MoneyInput>`. Never `parseFloat` — the file header documents five opportunities saved at ₹1 from `parseFloat('1,50,000')`. | Zero |
| 26 | File upload / download | **Reuse pattern** | Copy `app/api/risansi/opportunities/[id]/quotation/route.ts` verbatim — including the triple type check (claimed mime AND extension AND magic bytes) and the hardcoded Content-Type on GET. Those are security fixes, not boilerplate. | Clone route + clone `QuotationPdfManager.tsx` |
| 27 | Filters / KPI tiles / charts / tables | **Reuse as-is** | `MultiSelectFilter`, `ActiveFilterBar`, `TextSearchFilter`, `DateRangeFilter`, `StageKpi`, `BarList`, `StackedBar`, `AgeingBars`, `TrendBars`, `SortableTH`, `EmptyState`, `NoData`. | Zero |
| 28 | Kanban board | **Build by copying** | Copy `BugsBoard.tsx` (generic status board), **not** `OpportunityKanban.tsx` (imports opportunity modals + gateway rule). | Medium |
| 29 | Detail page with tabs | **Build small primitive** | `OpportunitiesTabs` is a hardcoded 2-tab switcher; `MobileTabs` is mobile-only. | New `components/risansi/Tabs.tsx` lifting `OpportunitiesTabs`' keep-mounted + localStorage behaviour |
| 30 | Excel export | **Reuse pattern** | exceljs already a dependency; copy `app/api/risansi/opportunities/export/route.ts` (hidden Lists sheet, Filters Applied sheet, navy header). | Medium |
| 31 | PDF export | **Reuse pattern** | **No PDF library exists** (no puppeteer/pdfkit/jsPDF). "PDF" = a `/print/*` server page + `AutoPrint` + `window.print()`. | New `/print/exhibition/[id]` (+ ranged roll-up) |
| 32 | Nav entry | **Extend** | Push one `NavItem` into `SALES_NAV`, one row into `PATH_TO_ID` above the `/risansi` row, one icon fn. Mirror in `BottomNav.tsx` if reps need it on phones. | 3 edits |
| 33 | Scheduled reminders | **Extend** | Add to the existing `Promise.all` in `app/api/cron/daily/route.ts` — **no `vercel.json` change**. Dedupe via `claimRun(kind, runKeySql)` (digest) or a per-row `*_reminded_at` column (per-item). | Small |
| 34 | ROI | **Build new** | Nothing computes cost-vs-return. | New pure module `lib/risansi-exhibition-roi.ts` |
| 35 | "Reports" section | **Do not build** | No `/risansi/reports` exists; reporting is decentralised (export link per list page, `/print/*` per artefact). | Put the export link in the Exhibitions header |

---

## 2. New Schema

Next migration number is **0053** (directory currently runs 0001–0052). Every statement `IF NOT EXISTS` — see the ledger blocker in §3.5.

### Do NOT create (already live)

`users` · `clients` · `client_contacts` (it is `contacts`) · `opportunities` · `followups` (it is `tasks`) · `notifications` · `audit_log` · `documents` (generic store is against the established pattern) · any expense-category master table (enums live as TS `as const` arrays; the one DB lookup table, `industries`, is dead code).

### 0053 — exhibition core

```sql
CREATE TABLE IF NOT EXISTS exhibitions (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name          text NOT NULL,
  venue         text,
  city          text,
  state         text,
  country       text,
  start_date    date,
  end_date      date,
  status        text NOT NULL DEFAULT 'Planned'
                  CHECK (status IN ('Planned','Submitted','Approved','Rejected',
                                    'Live','Completed','Cancelled')),
  visibility    text NOT NULL DEFAULT 'company'
                  CHECK (visibility IN ('company','team')),
  budget_inr    numeric(14,2),
  approver_id   integer REFERENCES users(id) ON DELETE SET NULL,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_by_name text,                 -- snapshot, `bugs.reporter_name` pattern
  approaching_reminded_at timestamptz,  -- per-row dedupe for the T-7 sweep
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exhibitions_status ON exhibitions (status);
CREATE INDEX IF NOT EXISTS idx_exhibitions_start  ON exhibitions (start_date DESC);

CREATE TABLE IF NOT EXISTS exhibition_team (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  exhibition_id integer NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member')),
  added_by      integer REFERENCES users(id) ON DELETE SET NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exhibition_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_exhibition_team_user ON exhibition_team (user_id);

CREATE TABLE IF NOT EXISTS exhibition_approvals (
  id             integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  exhibition_id  integer NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('plan','budget','expense')),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
  requested_by   integer REFERENCES users(id) ON DELETE SET NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     integer REFERENCES users(id) ON DELETE SET NULL,
  decided_by_name text,
  decided_at     timestamptz,
  remark         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exhibition_approvals_exh
  ON exhibition_approvals (exhibition_id, status);
```

### 0054 — expenses

```sql
CREATE TABLE IF NOT EXISTS exhibition_expenses (
  id             integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  exhibition_id  integer NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  category       text NOT NULL,
  description    text,
  vendor         text,
  estimated_inr  numeric(14,2),
  actual_inr     numeric(14,2),
  paid_inr       numeric(14,2) NOT NULL DEFAULT 0,
  paid_on        date,
  status         text NOT NULL DEFAULT 'estimated'
                   CHECK (status IN ('estimated','submitted','approved','rejected','paid')),
  submitted_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exhibition_expenses_exh ON exhibition_expenses (exhibition_id);

CREATE TABLE IF NOT EXISTS exhibition_expense_files (
  expense_id   integer PRIMARY KEY REFERENCES exhibition_expenses(id) ON DELETE CASCADE,
  file_name    text    NOT NULL,
  mime         text    NOT NULL,
  size         integer,
  bytes        bytea   NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(bytes) <= 15000000)
);
```

**Unit discipline (non-negotiable):** expenses are **rupees** in `numeric(14,2)`, every column suffixed `_inr` — following `client_revenue_monthly.total_value`, the only precision-constrained rupee column in the schema. Never crores. `numeric(14,7)` is reserved for `*_cr` deal-value columns; migration 0024 exists because `value_cr` at `numeric(10,2)` silently rounded 150 sub-lakh orders to ₹0.00. A ₹40,000 stall bill written into a crore column reads as plausible and is catastrophic.

### 0055 — meetings and the links into existing tables

```sql
CREATE TABLE IF NOT EXISTS exhibition_meetings (
  id             integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  exhibition_id  integer NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  client_id      integer REFERENCES clients(id)  ON DELETE CASCADE,   -- nullable until matched
  contact_id     integer REFERENCES contacts(id) ON DELETE SET NULL,
  lead_company   text,        -- raw booth capture, before conversion
  lead_contact   text,
  lead_email     text,
  lead_phone     text,
  met_by         integer REFERENCES users(id) ON DELETE SET NULL,
  met_by_name    text,
  met_on         date NOT NULL,
  notes          text,
  outcome        text,
  created_by     text,        -- actor email, matching the audit/logActivity convention
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exhibition_meetings_client ON exhibition_meetings (client_id, met_on DESC);
CREATE INDEX IF NOT EXISTS idx_exhibition_meetings_exh    ON exhibition_meetings (exhibition_id);

-- ALTER ONLY. `tasks` and `opportunities` have NO CREATE TABLE anywhere in the repo.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
  exhibition_meeting_id integer REFERENCES exhibition_meetings(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
  exhibition_id integer REFERENCES exhibitions(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_reminded_at timestamptz;  -- only if due-today reminders ship
CREATE INDEX IF NOT EXISTS idx_tasks_exh_meeting ON tasks (exhibition_meeting_id);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS
  exhibition_meeting_id integer REFERENCES exhibition_meetings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_exh_meeting ON opportunities (exhibition_meeting_id);
```

`ON DELETE SET NULL` on both task links is deliberate: deleting a meeting must not silently destroy an outstanding commitment. Note migration 0034 added `tsm_user_id` **without** a real FK — do not repeat that; every actor column here is a typed FK plus, where the record must outlive a deletion, a `*_name text` snapshot. Never store an email in a column named `*_by` that elsewhere holds an id (`tour_assignments.assigned_by` has three writers that disagree — do not propagate that).

### New TypeScript modules (no DB tables)

- `lib/risansi-exhibition-fields.ts` — `EXPENSE_CATEGORIES` / `isExpenseCategory` as `as const` + type guard, mirroring `DROP_REASONS` / `isDropReason`; the exhibition field catalogue mirroring `OPP_FIELDS`.
- `lib/risansi-exhibition-status.ts` — `EXH_STATUSES`, `STATUS_SLUG` / `statusFromSlug` / `statusHref`, `STATUS_COLOR`, `STATUS_BLURB`, `STATUS_COLUMNS`, pure `summariseStatus(rows)` — mirroring `lib/risansi-stage-dashboard.ts`.
- `lib/risansi-exhibition-filters.ts` — `parseExhFilters` / `buildExhFilter(f, …, startIdx)` / `exhFilterQuery`, mirroring `lib/risansi-opp-filters.ts`. Build this **first** and have the list page, board, drill-downs and export route all call it. The pipeline page still carries an inline duplicate of its own filters; do not reproduce that.
- `lib/risansi-exhibition-roi.ts` — pure, no DB, in the style of `lib/risansi-sales-orders.ts`.
- `lib/risansi-auth.ts` additions — `exhibitionVisibilitySql(user, alias)`, `canManageExhibition(user, exhibitionId)`.
- `lib/risansi-notify.ts` additions — `usersByRole(roles)`, `notifyExhibitionSubmitted`, `notifyExhibitionDecision`, `notifyExhibitionTeamAssigned`, `runExhibitionApproaching`. Export the currently module-private `inAppIds` and `dedupeRecips` rather than re-implementing them.

---

## 3. The Hard Parts

### 3.1 A company-wide exhibition inside a tour-scoped visibility model

This is the module's central design problem, and it bites twice.

**The exhibition record.** Every visibility helper in `lib/risansi-auth.ts` resolves through `clients.tour_id`. An exhibition has no client and no tour, so routing it through `clientScopeSql` evaluates to `'FALSE'` for every rep and manager — 17 of 31 users would see an empty module.

**Decision:** add a sibling predicate rather than bending the client helpers.

```ts
export function exhibitionVisibilitySql(user: CurrentUser, alias = 'e'): string | null {
  if (hasRole(user.role, 'admin')) return null;        // null = no restriction (existing convention)
  const uid = intOrNull(user.id);
  if (uid == null) return 'FALSE';
  return `(${alias}.id IN (SELECT exhibition_id FROM exhibition_team WHERE user_id = ${uid})
        OR ${alias}.created_by = ${uid}
        OR ${alias}.visibility = 'company')`;
}
```

Same inlined-trusted-int style the file already uses. Default `visibility = 'company'` — exhibitions are marketing events the whole sales org should see. The closest existing precedent is `repVisibilitySql()` in `lib/risansi-action-queue.ts`, the only place that ORs participation-based access on top of tour-based access; keeping the same shape keeps the module consistent with the Action Registry.

**The team member's view of a colleague's follow-up.** A booth lead sits on nobody's tour, so `repVisibilitySql` shows an exhibition teammate nothing. Add one OR branch:

```sql
OR EXISTS (SELECT 1 FROM exhibition_team et WHERE et.exhibition_id = t.exhibition_id AND et.user_id = $1)
```

**Trap:** `app/risansi/field/page.tsx:481-495` hand-rolls the equivalent predicate via `clientScopeSql` instead of calling `repVisibilitySql`. Patch both, or refactor that call site onto the shared helper as part of this work.

**Performance note:** `clients` is already the hottest sequential scan in the database (125,471 seq scans / 249.6M tuples read against a 2,676-row table, driven by `clientScopeSql`'s uncorrelated subquery across ~60 call sites). Scope exhibition lists on `exhibition_meetings.client_id` (indexed) rather than joining through `clients`, and do not add another leading-wildcard `ILIKE` over `clients.legal_name` without a trigram index in the same migration.

### 3.2 "Boss/Approver" is a permission, not a role

`users.role` is a hard `CHECK` over a strictly ordered 1-2-3-4 ladder with no lattice, no role array, no bitmask, and a single scalar `session.user.role`. Adding a fifth value requires editing the CHECK constraint, `RisansiRole` + `ROLE_LEVEL`, two separate `VALID_ROLES` lists, `ROLES` in `UsersManager.tsx`, `ROLE_LABELS` in `UserMenu.tsx`, `SidebarRole` + `toSidebarRole`, `BottomNavRole`, and every `role IN ('rep','manager')` literal (at least 9 files). A person given a new global role would silently vanish from rep pickers, tour assignment and Executive Review. There is also nowhere to slot it: between manager and admin grants nothing (levels are compared, never enumerated); above admin grants the whole portal.

**Decision:**
- **Boss/Approver → the existing `admin` role**, gated `if (!hasRole(user.role,'admin')) throw new Error('Only an admin can approve an exhibition.')` — identical in shape to the admin-only `'Closed'` transition already in `app/actions/risansi-complaints.ts:226`.
- **Exhibition Manager → `exhibition_team.role = 'lead'`**, checked by `canManageExhibition(user, exhibitionId)`. This mirrors `tour_assignments (tour_id, rep_id, role)` — the repo's existing answer to "this person leads that thing" — and lets one person lead exhibition A while merely attending exhibition B, which a global role cannot express.

**Caveat the client must accept or override:** 14 of 31 users (45%) are already admin or sysadmin, and admins bypass every visibility predicate. "Only an admin may approve" therefore authorises nearly half the org. Either accept it (approval is a workflow record and an audit trail, not a security boundary — consistent with how complaints already treat admin-only closure), or narrow it with `exhibitions.approver_id` and gate on `hasRole(user.role,'sysadmin') || user.id === exhibition.approver_id`. The spec's org chart implies one specific boss, so **the named-approver variant is the safer default** — the column is in the DDL above either way.

**No delegation mechanism exists.** `is_active = false` removes a user entirely. Route approval requests to *all* active approvers and let whoever acts first decide, and hang stale-approval chasing off the existing 5-day sysadmin escalation rather than writing a new reminder path.

### 3.3 Exhibition follow-ups are `tasks` rows

Not a `followups` table. `tasks` is read by `/risansi/registry`, `/risansi/field`, Client 360, the visit detail page, the mobile page, the print route, plus `runOverdueActionReminders`, `runAdminOverdueEscalation` and `runWeeklyManagerDigest`. A parallel table means a second inbox reps must remember to check and a second set of reminder plumbing to maintain.

Cost of reuse: two nullable FK columns + one line in `addTask`'s INSERT. Return: overdue reminders, the 5-day sysadmin escalation, the weekly manager digest, the Registry filters, the assignee email and the bell row all work **on day one with zero new notification code**.

Three sub-decisions:

1. **`addTask` hard-requires a `clientId`** (typed `number`, authorised via `canViewClient` with a visit-based fallback). The `tasks` table itself permits NULL. Do **not** relax the check globally — it is the gate that stops a rep raising actions outside their scope, and its denial is explicitly logged because Next redacts server-action errors in production. Instead add a parallel authorisation branch: allow the insert when `exhibitionMeetingId` is supplied and the caller is on that exhibition's team, exactly as the existing `visitId` fallback works.
2. **"Overdue" stays derived**, never stored. It is computed as `due_date < CURRENT_DATE AND status <> 'completed'` in five independent places. A stored flag needs a nightly job, drifts from all five, and breaks the moment a due date is edited. Reuse the `TASK_DUE_BUCKETS` labels (`Overdue` / `Due today` / `This week` / `Later` / `No due date`) verbatim for any exhibition filter UI.
3. **Deep-link the reminder.** `runOverdueActionReminders` hardcodes `section: 'Action Registry'` and `ctaPath: '/risansi/registry'`. Branch on `exhibition_meeting_id` so an exhibition follow-up chases the owner back to its meeting. Two lines; the difference between the loop closing and the rep hunting for context.

An `'in_progress'` status, if wanted, is cheap: every downstream predicate is written `status <> 'completed'`, never `= 'open'`. Only the Done/Reopen toggle in `ActionQueueRow.tsx` needs real work.

### 3.4 A stranger met at a stand becoming a client with no tour

`clientVisibilitySql` emits `c.tour_id IN (…) OR c.id IN (client_rep_access …)`. With `tour_id IS NULL`, `NULL IN (...)` is NULL, not true — **so a freshly created exhibition prospect is invisible to every rep and manager, including the person who created them.** Concretely: `/risansi/clients/<code>` 404s for the creator; `clients-search` will not return it, so they cannot raise an opportunity or plan a visit against it; `resolveClientPrimaryRep` returns `basis: 'none'`; and `notifyNewLead` resolves recipients through `tourManagers(clientId)`, which finds nobody, so the lead alert goes silently nowhere. 1,280 of 2,676 live clients are already in this state.

**Decision — do not invent an "Exhibition" pseudo-tour** in `tour_routes`. Tours drive visit-frequency thresholds, coverage reporting and the manager digest; a fake row pollutes all three.

Instead, in the same transaction as the client INSERT, write `client_rep_access (client_id, rep_id = <the rep who logged the meeting>, granted_by = 'exhibition:<exhibition_id>')`. That table exists for exactly this case — its own migration header says a granted rep gets full visibility "exactly as if it were on one of their tours." It makes the client visible, searchable and ownable immediately, keeps `tour_id` honestly NULL as the to-do state migration 0004 documents, and leaves `/risansi/admin/reps?tab=clients` as the place a lead graduates onto a real tour.

Two implementation caveats: `grantClientAccess()` is admin-only (`requireAdmin()`), so the exhibition action must write the row directly; and the grant only accepts users with role `rep` or `manager`, so an admin logging a meeting gets no row (harmless — admins see everything). Also add the exhibition's lead/owner as an explicit `notifyNewLead` recipient.

**Two more required pieces:**
- **A rep-callable create path.** Add `createExhibitionProspect()` in a new `app/actions/risansi-exhibitions.ts` that any approved user may call but which can only produce a `LEAD_`-coded `PROSPECTIVE_LEAD` from a restricted field set. Real ERP codes, status changes and `convertLeadToClient` stay admin-only. Share the code-minting path with `addClient` by extracting `createLeadClient()` — there must be exactly one place that mints `LEAD_` codes.
- **Duplicate detection.** `clients-search` is plain visibility-filtered `ILIKE`, so a rep at a booth typically *cannot see* a company another tour already owns and will re-create it. Port the token/Levenshtein scorer from `scripts/fuzzy-match-competitor.mjs` into `lib/risansi-client-match.ts` and expose `GET /api/risansi/clients-match?name=` that ignores the visibility predicate but returns only `{id, legal_name, city, owner_name}` — enough to say "this exists, ask <owner>" without leaking the record.

**Hard invariant to honour:** `allowedStatusesForCode()` couples code type to status. An exhibition-created prospect is always (`LEAD_` code, `PROSPECTIVE_LEAD`). Never let exhibition UI set status directly or write `clients.code`; route promotion through `convertLeadToClient(clientId, erpCode)`, which cascades the denormalised `client_code` copies in `client_pumps`, `competitor_installed_base` and `complaints`.

### 3.5 ROI, unit safety, and not corrupting pipeline KPIs

Three distinct risks bundled together.

**Unit confusion.** `*_cr` columns are crores at `numeric(14,7)`; `*_inr` columns are rupees and carry *no* precision constraint at all — the audit flags them as "unit-unsafe by convention only." Exhibition spend is lakhs-scale, exactly the range destroyed by a crore column and exactly the range where a rupee figure in a crore column looks plausible. **Rule: expenses are rupees, `numeric(14,2)`, `*_inr` names, entered through `parseMoneyInput` (never `moneyToCr`, never `parseFloat`). Convert once, at the ROI boundary, dividing by the existing `CR = 10_000_000` constant, and name every variable with its unit — `roi(returnCr, spendInr)`.**

**No spend must ever reach a pipeline query.** Every opportunity-value read COALESCEs `final_value_cr` / `value_cr` and sums `so_value_cr`; none is aware of money going out. Spend lives only in `exhibition_expenses`, with no FK into `opportunities` and no crore column. ROI is computed at read time in `lib/risansi-exhibition-roi.ts` and never persisted onto an opportunity. Compute the return leg from the same expressions the pipeline already uses (`COALESCE(o.final_value_cr, o.value_cr)` for Won; `SUM(so.so_value_cr)` for realised) so the exhibition page and the Opportunities page can never disagree.

**Double-counting is a reporting question, not a bug.** Exhibition-sourced opportunities will land in the normal pipeline, the forecast brackets and the annual-target gauge because they are ordinary `opportunities` rows — that is correct, but the client must confirm it is intended (§5).

**Adding `auto_source = 'exhibition'` silently mislabels it in four live UI surfaces:** the dashboard widget renders `auto_source === 'expansion_plan' ? 'Expansion' : 'Displacement'`, so an exhibition opp reads as "Displacement"; `EditOppDrawer` shows "⚡ Auto-created from visit", which is simply false; `ActiveOppsTable` and `OpportunityKanban` show a generic "⚡ Auto" badge; and the dashboard's "Recently auto-created" card filters on `auto_created = TRUE`, so exhibition opps appear there whether intended or not. **Extract `autoSourceLabel(src)` into `lib/risansi-opportunity-fields.ts` and swap all four sites onto it before adding the new value.**

**The Quoted gateway constrains the workflow.** An opportunity cannot reach Negotiating/Won/Lost without having been Quoted (enforced in three places, and the two server copies already disagree on whether `'On Hold'` counts), and a Won transition requires at least one Sales Order. If the client imagines a booth conversation converting straight to a booked order, it cannot. Create exhibition opportunities at Suspect/Prospect and define the at-show metric as "exhibition-sourced opportunities that reached Quoted," not "Won at the show." Also note `createPipelineOpportunity` hard-throws when the client has no tour with an assigned rep — exhibition walk-ups are exactly that case, so the exhibition path must set `rep_id` to the capturing team member directly (the special-access branch already does this for granted clients).

### Blockers before the first migration runs

1. **Migration ledger drift.** `schema_migrations` holds 40 rows with latest `0040`, yet objects from `0041` onward are live and the directory now runs to `0052`. `scripts/migrate.mjs` will re-run them. It is safe today only because those files happen to be idempotent. **Reconcile the ledger before running 0053**, and make every exhibition migration `IF NOT EXISTS` so a re-run is harmless either way.
2. **No baseline DDL.** 19 of 43 tables — including `clients`, `contacts`, `tasks`, `opportunities`, `visits` — have no `CREATE TABLE` anywhere in the repo; `migrations/` starts at 0001 assuming they exist. The exhibition tables will FK into parents that have no reproducible DDL. Ideally land a `pg_dump --schema-only` baseline as `0000_baseline.sql` (guarded `IF NOT EXISTS`) alongside this work. At minimum: **verify the live column set of `tasks` and `opportunities` against the database before writing the ALTERs**, and never `CREATE TABLE` or rename a column on them.
3. **`client_status_log` is written by production code but has no DDL and is absent from the 43-table inventory** — the two INSERTs (in `updateClient` and `convertLeadToClient`) are almost certainly failing silently inside catch blocks that log the wrong message. Do not assume a client status history exists when designing exhibition lead-stage reporting.

---

## 4. Phasing

The spec's 8 phases assume a from-scratch build. Re-cut:

| Phase | Scope | Delivers | Size |
|---|---|---|---|
| **~~Spec Phase 1~~** | ~~Login, users, roles, employee master~~ | **DELETE.** Already live: NextAuth + bcrypt against `users`, `hasRole` at 42 sites, `/admin` Users & Access, `/risansi/admin/reps`, `proxy.ts`, `audit_log`, `auth_audit`. Residue: optionally `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text` **only if** team rosters must show a phone. Do **not** add `reporting_manager_id` — nothing reads a manager chain and it would contradict `tour_assignments`. | — |
| **0 — Pre-flight** | Reconcile `schema_migrations` for 0041–0052; verify live `tasks` / `opportunities` columns; decide on the baseline dump; add `Exhibitions` to `SECTION_HUE`. | A migration path that will not corrupt on the next non-idempotent file. | S |
| **A — Core + skeleton** | Migration 0053; `exhibitionVisibilitySql`; `canManageExhibition`; `lib/risansi-exhibition-{fields,status,filters}.ts`; `/risansi/exhibitions` list page (Topbar shell + `Promise.all` of `q()`-wrapped queries + `force-dynamic`); `NewExhibitionButton` + modal; nav entry + `PATH_TO_ID` row; `loading.tsx`. | Create, list and open an exhibition; team-scoped vs company visibility correct from day one. | M |
| **B — Team + approvals** | `ExhibitionTeamPicker`; submit / approve / reject server actions; `usersByRole(['admin','sysadmin'])`; `notifyExhibitionTeamAssigned`, `notifyExhibitionSubmitted`, `notifyExhibitionDecision`; approvals queue at `/risansi/exhibitions/approvals` with `<AccessDenied>`; review modal composed from `BugDetailModal`'s status stepper + notes + `TimeRow`; `recordAudit` on every decision. | The only genuinely new workflow concept in the spec, working end to end. | M–L |
| **C — Expenses** | Migration 0054; expense line editor modelled on `PurchaseOrderManager` / `SalesOrderList` (`parseExpensesJson` in the shape of `parseOfferRevisionsJson`); `<MoneyInput>`; invoice route cloned from the quotation route; `ExpenseInvoiceManager` cloned from `QuotationPdfManager`; budget-vs-actual via `StackedBar`. | Budget vs actual vs paid, with receipts attached. | M |
| **D — Meetings + lead capture** | Migration 0055 (meetings only); `<ClientPicker allowCreate>` wrapping the existing debounced `clients-search`; `createExhibitionProspect()` + extracted `createLeadClient()`; `client_rep_access` auto-grant; `notifyNewLead` recipient fix; `lib/risansi-client-match.ts` + `/api/risansi/clients-match`; **Client 360 activity-feed OR branch + `activityKind` case** (the feed's `entity_type` whitelist is closed — without this, exhibition audit rows write successfully and are invisible, a silent failure). | Booth conversations captured, leads created without duplicating the customer master, and visible to the person who captured them. | L |
| **E — Follow-ups** | `tasks` ALTERs; `addTask` accepts `exhibitionMeetingId` + the parallel authorisation branch; `repVisibilitySql` OR branch **and** the hand-rolled duplicate at `app/risansi/field/page.tsx:481`; deep-link branch in `runOverdueActionReminders`; follow-up panel on Exhibition Detail using `AddActionForm` + `ActionQueueRow`. | Exhibition commitments in the one Action Registry, with overdue reminders, escalation and the manager digest all working for free. | S–M |
| **F — Opportunities link** | `opportunities.exhibition_meeting_id`; `autoSourceLabel()` extraction + 4 render-site swap; "raise opportunity from this meeting" action with the tour-less ownership fallback; stage-log note "Created from exhibition meeting". | Exhibition → pipeline attribution, correctly labelled everywhere. | M |
| **G — Reporting + ROI** | `lib/risansi-exhibition-roi.ts`; status drill-down at `/risansi/exhibitions/status/[status]` mirroring the stage dashboards (one row query → `summariseStatus` → all tiles and charts, so a chart can never disagree with its table); `StageKpi` tiles; Excel route cloned from the opportunities exporter; `/print/exhibition/[id]` + `/print/exhibitions` with `print-shared` + `AutoPrint`; optional exhibition panel on the home dashboard. | Post-event review, exports, ROI. | M–L |
| **H — Reminders + polish** | `runExhibitionApproaching` (T-7/T-1) added to the existing daily cron `Promise.all` — no `vercel.json` change; optional `runDueTodayActionReminders` with its own `due_reminded_at` marker (do **not** share `last_reminded_at`, the two sweeps would fight for the stamp); `BottomNav` entry; `<Tag>` dark-mode fix if exhibition status badges matter. | Proactive nudges; mobile parity. | S |

Notes on ordering: **B before C** because expense sign-off reuses the approval machinery. **D before E and F** because both need a real `client_id`. **G last** because ROI needs both spend (C) and attributed opportunities (F) to say anything.

**If the board can exceed a few hundred rows**, adopt the pipeline's two-query split from the outset — capped cards via `ROW_NUMBER() OVER (PARTITION BY status)` plus a separate uncapped `GROUP BY` for true per-column totals, with a `"{n} of {N}"` header. A single shared `LIMIT` let the largest column starve the others in a prior bug, and a capped column once reported ₹5.2 Cr against a real ₹15 Cr.

---

## 5. Open Questions for the Client

Genuinely undecidable from the workbook:

1. **Who approves?** One named boss per exhibition (`approver_id`), or any admin? Mapping to `admin` authorises 45% of current users. This changes the schema and the gate.
2. **What is approved?** The plan, the budget, both, and is there a *second* approval on actual expenses before payment? The `exhibition_approvals.kind` CHECK depends on the answer.
3. **Default visibility** — is every exhibition visible to the whole sales org, or only its team? (Recommendation: company-wide, column defaults that way.)
4. **Booth capture flow** — does a rep type a full prospect record at the stand (immediate `LEAD_` client, everything downstream works), or capture a business card as free text and convert later (faster at the booth, but no follow-up or opportunity can be raised until conversion)? The DDL above allows both; the UI cannot.
5. **Cross-tour leads** — a rep meets a company that is already on another rep's tour. Does the capturer keep the follow-up (a `client_rep_access` grant), or is it handed to the tour owner? This is a sales-ops policy question, not a technical one.
6. **Should exhibition-sourced opportunities count in the normal pipeline KPIs, forecast brackets and the annual-target gauge**, or be reported separately? They will by default.
7. **What is "return" in ROI?** Quoted value, Won value, or realised Order in Hand (Sales Order value)? Over what attribution window after the event (90 days? the fiscal year?)? Deals often close 6–18 months out.
8. **Expense category list** — the client must supply it; it becomes an `as const` array, not a maintainable master table.
9. **Currency** — INR only? `getUsdRate()` exists (a single sysadmin-editable INR/USD rate in `app_settings`) but there is no multi-currency model. An overseas exhibition billed in EUR is not currently expressible.
10. **Is personal reimbursement in scope?** Per-diem, travel claims and "who gets paid back" would turn this into an employee-claims system and pull in payment details we should explicitly keep out.
11. **Documents beyond receipts** — stall design, contracts, brochures? If yes, size/type limits, and whether they need per-file permissions (the current bytea pattern is one file per parent row).
12. **Non-employee team members** — agency or contractor staff on the stand. `exhibition_team.user_id` requires a `users` row, and self-service signup is restricted to @risansi.com addresses. If external staff must appear on a roster, that is a schema change.
13. **Recurring series** — is "IFAT 2026" the same entity as "IFAT 2028" for year-on-year comparison? If yes, a nullable `series_id` self-reference is far cheaper to add now than later.
14. **Bulk lead import** — will badge-scanner exports be uploaded? If so, plan for an `import_source` tag on the meeting rows (the pattern `visits.import_source` established for identify-and-rollback), and expect the duplicate-matcher to become load-bearing rather than optional.
15. **"PDF export"** — is a printed/saved page acceptable (the portal's entire existing mechanism), or is an *emailed, attached* PDF required? The latter means introducing a headless renderer, which is a platform decision (Vercel runtime, cold starts) and not part of this module's estimate.