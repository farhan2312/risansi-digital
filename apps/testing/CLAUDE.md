# Pump Testing Portal (testing-portal)

Internal web app for Risansi Industries Ltd's R&D / production testing team: intake pump testing requisitions, dedup-check against prior test reports, and fill/print test reports (Observation Sheet + Viscosity Correction Chart).

- **Repo:** `farhan2312/risansi-testing` on GitHub, `main` branch, deploy on push (Vercel).
- **Live URL:** `https://rndtesting.risansi.com`
- **Sister app:** `sales-portal-next` — separate Next.js app/repo, deployed separately on Vercel, but **shares this same Postgres database's `users` table and `JWT_SECRET`**. A login in either app works in both. Testing-portal does not own migrations for `users` (see Database section) — treat schema changes to that table with extra care since sales-portal-next depends on it too.

## Tech stack

- **Next.js 15** (App Router), React, TypeScript.
- **Drizzle ORM** (`drizzle-orm/node-postgres`) against a shared **Azure Postgres** database, DB name `Pump_Selector_and_testing`.
- **react-hook-form + zod** for all forms.
- **JWT auth**, HS256, hand-rolled (no NextAuth) — see `src/lib/auth.ts`.
- **bcryptjs** for password hashing.
- No test framework wired up; verification is `npx tsc --noEmit` (type-check) plus manual/browser checks.

## Environment

`.env.local` (gitignored) must define:

```
DB_HOST=...
DB_PORT=5432
DB_NAME=Pump_Selector_and_testing
DB_USER=...
DB_PASSWORD=...
DB_SSLMODE=require        # or "disable" for local
JWT_SECRET=...            # MUST match sales-portal-next's JWT_SECRET exactly
```

`src/lib/db/index.ts` builds the Postgres pool + Drizzle instance lazily (via a Proxy) so `next build` doesn't fail when creds aren't present at build time.

## Directory layout

```
src/app/(dashboard)/...        thin page.tsx wrappers, each just re-exports a screen:
                                  export { default } from "@/screens/xxx/XxxPage";
  dashboard/                    requisitions list
  requisitions/new, [id], [id]/edit, [id]/report
  reports/new, [id], [id]/edit
  admin/access-requests, admin/users
src/app/api/...                 route handlers (the actual backend)
  auth/login, auth/change-password
  access-requests                 (public signup -> pending user)
  requisitions, requisitions/[id], requisitions/dedup-check
  reports, reports/[id]
  users, users/[userId], users/[userId]/password
src/screens/                    the real page components (business logic + JSX)
src/components/test-report/     TestReportForm.tsx (Observation Sheet),
                                 ViscosityChartForm.tsx (Viscosity Correction Chart)
src/components/ui/               ConfirmModal, EditPasswordModal, AdminSetPasswordModal
src/layouts/DashboardLayout.tsx  sidebar + nav + profile menu, wraps every (dashboard) page
src/lib/db/schema.ts             Drizzle table defs
src/lib/auth.ts                  JWT create/verify, decodeToken(), requireAdmin()
src/lib/api.ts                   snake_case row serializers (userToDict, requisitionToDict, reportToDict, pointToDict)
src/lib/reportFieldMaps.ts       snake_case<->camelCase field maps for report PATCH/POST bodies
src/lib/testReportCalc.ts        the live formula engine (see below)
src/lib/reportDraft.ts           cross-form/cross-session draft carryover (SharedReportDraft)
src/services/                    client-side fetch wrappers (testingService, adminService, authService, session)
scripts/                         one-off .mjs migration/data scripts (see convention below)
```

## Auth & roles

JWT payload: `{ sub: userId, email, role, iat, exp }`, 12-hour expiry. `decodeToken(req)` verifies any valid token; `requireAdmin(req)` additionally requires `role === "admin"`.

Four roles (legacy `"user"` role fully retired):

| Role | Can do |
|---|---|
| **source** | Raise requisitions (sees only their own). Edit their own requisitions, but only intake fields (model, category, EC/quotation no., offer date, responsible person, source team, date of receipt, QTH/power/head/RPM/capacity) — not status/retest/testing-result fields. Cannot fill, edit, or delete reports. |
| **testing** | Can also raise requisitions now (same as source/central-admin — this was "cannot raise" earlier, explicitly reversed). Plus Start Testing / mark Retest Needed, reassign "Responsible Person" inline from the requisitions list, fill/edit/delete reports. |
| **central-admin** | Same requisition-raising rights as source, plus Assign Retest (see below). **No** access to Manage Users / Access Requests (this was explicitly granted then revoked — do not re-add without asking). |
| **admin** | Everything, plus Manage Users (role changes, password reset, **delete user** — see FK gotcha below) and Access Requests (approve/reject signups). |

**Assign Retest / Action Registry** (Admin / Central Admin only): on a report that missed its rated Head/Capacity/Power, an "Assign Retest" button — on both the Report Detail page and Report Compilation's expanded per-model report rows — opens the `AssignRetestModal`, prefilled with exactly which parameters failed (rated vs. measured) and a free-form list of action points. Submitting (`POST /api/reports/[id]/assign-retest`) does two things in one transaction-like sequence: raises a fresh Pending requisition for that model with Retest Needed pre-set (so it drops straight back into the testing queue), and inserts a row into the `action_registry` table (unmet fields, rated/measured snapshot, the action points, who assigned it, who originally raised the test — `originallyRaisedBy`, sourced from the linked requisition's submitter or the report's own tested/prepared-by). Rated targets/units are carried from the report itself (already normalized to KG/CM2 / M3/HR — see the Head/Capacity normalization note above), not the original requisition. Category / EC-Quotation No. / Responsible Person / Source Team only carry over when the report has a linked requisition to pull them from; left blank for standalone/historical reports. Every entry is browsable at **Action Registry** (`/admin/action-registry`, `GET /api/action-registry`) — Admin sees it in the main Admin nav group, Central Admin gets its own minimal Admin section containing just this link (they can create entries via Assign Retest but don't get the rest of Admin per the row above).

New-signup role is chosen on the Request Access form (Source Team / Testing Team only — central-admin/admin are never self-service). Every account defaults `must_change_password = true`; on login, `DashboardLayout` shows a **non-dismissible** `ConfirmModal`-style forced password-change if that flag is set — no close button, overlay click does nothing, cleared automatically on a successful change.

## Database gotchas (read before writing raw SQL or migration scripts)

1. **`users` table is a mirror.** Drizzle's `schema.ts` comment says testing-portal doesn't own its migrations (sales-portal-next does) — but testing-portal *has* added a column to it directly this session (`must_change_password`) via an additive migration script when needed. Coordinate/communicate before altering columns sales-portal-next relies on.
2. **Drizzle's `.default(...)` / `.$defaultFn(...)` are application-level only, not real DB defaults**, for most columns in this schema (`id`, `created_at`, `updated_at`, etc.). Any **raw SQL** insert (migration script, ad-hoc fix) must explicitly supply `id` (`gen_random_uuid()`), `created_at`/`updated_at` (`now()`), etc. — omitting them throws `null value in column ... violates not-null constraint`. Only matters for scripts bypassing Drizzle; the app's own Drizzle inserts are fine.
3. **Real foreign keys exist that `schema.ts` does not model:**
   - `test_requisitions.created_by → users.id`
   - `users.reviewed_by → users.id` (self-referential — who approved/rejected an access request)
   Deleting a user who has ever raised a requisition or reviewed an access request will FK-violate unless those references are cleared first. `DELETE /api/users/[userId]` handles this in a transaction (nulls both, then deletes) — replicate that pattern if you add another user-deletion path. `test_requisitions.submitted_by` is a separate **name snapshot** column (not a FK), so requisition history stays human-readable even after the creator's account is gone.
4. **Migration script convention:** one-off `.mjs` scripts in `scripts/`, run via `npx dotenv -e .env.local -- node scripts/xxx.mjs`. Schema-altering scripts (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) are additive-only and kept committed as a permanent record (`add-*-column.mjs`). Pure data-fix/debug scripts are deleted immediately after running — never leave throwaway scripts in the repo.

## Report formats & the formula engine

Two report formats share one `pump_test_reports` table (`report_format: "observation" | "viscosity-chart"`):

- **Observation Sheet** (`TestReportForm.tsx`) — capacity measured via V-notch / Barrel / Flow Meter.
- **Viscosity Correction Chart** (`ViscosityChartForm.tsx`) — same measurement methods, plus liquid-viscosity-corrected efficiency figures.

Both forms are **field-for-field identical** (as of this session) — gearbox/motor info, PO/EC no., NPSHa, rated capacity/head/RPM, specific gravity/viscosity/K, reference voltage/current, V-notch baseline, vibration test & run summary, Witness/Inspector/Recorder, Remarks. (Rev No./Rev Date were added then explicitly removed again — don't re-add without asking.)

`src/lib/testReportCalc.ts` is a **live formula engine ported exactly from the original Excel workbook** ("NEW PUMP TESTING FORMATE FOR DIGITAL", sheets "v notch" and "UPDATE SHEET V-NOTCH (2)") — every formula was verified against sample values baked into that workbook before porting. Only **K for Given CPS** actually feeds the slip/efficiency calculations; Specific Gravity and Viscosity (CPS) are informational fields on the original sheet too, not formula inputs — don't wire them into the calc without a concrete source formula.

Computed-not-editable fields (recalculated live from other inputs, not stored as free entry):
- **Total Run** = stop time − start time (`HH:MM hrs`).
- **Total Rise** = Max. Bearing Temp − Ambient Temp.

Creating a Viscosity Chart report linked to a requisition (or typing a matching model number) **auto-copies every shared field, including test points**, from that pump's existing Observation Sheet report — only into fields that are still empty, never clobbering something the tester already typed. See `applyAutofill` in `ViscosityChartForm.tsx` and `draftFromReport`/`SharedReportDraft` in `src/lib/reportDraft.ts`.

Test points in the report detail view are sorted by **head (kg/cm²) ascending** (RPM as tiebreaker) — historical/imported reports have head and RPM inversely related, so sorting by RPM first displayed head descending, which was confusing.

## Export PDF

`window.print()` with a `@media print` stylesheet — no PDF library. Print-only header block shows the Risansi logo; sidebar/action buttons hidden in print; `theme.css` forces light-theme CSS variables under `@media print` regardless of the viewer's dark/light mode. Witness/Inspector/Recorder render as a Role/Name/Signature table (Signature column is always a blank line, even if Name is filled in). **Known trap:** `.testing-layout`'s `height:100vh; overflow:hidden` (added for sidebar-scroll containment) must stay reset to `height:auto; overflow:visible` inside the print media query, or exported PDFs silently truncate after one screen's worth of content.

## Known UI/reliability landmines already fixed here (don't reintroduce)

- **Never use `window.confirm()`/`alert()` for anything that matters.** Browsers can silently suppress it (Chrome's "prevent this page from creating additional dialogs," some embedded/webview contexts) — it just returns `false` with no dialog and no error, so the destructive action silently never happens. Use `src/components/ui/ConfirmModal.tsx` instead for any new delete/destructive confirmation.
- **Don't trust a `useState(readFromLocalStorage())` lazy initializer alone** for anything that must reflect the *current* session state on every mount (e.g. `must_change_password`). It only runs once per component instance; pair it with a mount-time `useEffect` re-check (see `DashboardLayout.tsx`).
- Vercel occasionally serves a **"Vercel Security Checkpoint"** interstitial (bot/rate-limit protection) to rapid automated requests — a `403`/challenge page here is almost always that, not an app bug, if it clears up after backing off.

## Legacy data import

~250 historical pump-test reports were bulk-imported from old Excel/PDF exports this session. Reports are matched/searched by the **shop nickname on the source tab** (e.g. `H-85`), not the internal RTOH/RMOH-coded model number many of those sheets' headers actually show — those are two different things for most legacy sheets, confirmed the hard way. If asked to import more legacy data, expect the same landmine, and validate any parser against a report already confirmed correct in the DB before trusting it at scale.

## Commands

```bash
npm run dev              # localhost:5174
npm run build             # production build (also runs lint + type-check)
npx tsc --noEmit           # type-check only, run this after every change before committing
npx dotenv -e .env.local -- node scripts/xxx.mjs   # run a one-off DB script
```

## Working conventions in this repo

- Commit + push to `main` after every change without waiting for extra confirmation (standing instruction).
- Type-check (`npx tsc --noEmit`) before every commit.
- Delete throwaway/debug scripts and test DB rows immediately after use — never leave them committed or lying around in the shared database.
- No browser-based QA loop after routine changes unless the user asks for it or you're actively debugging a live-reported bug (in which case: verify for real, including against the live deployment if needed, rather than declaring success on faith).
