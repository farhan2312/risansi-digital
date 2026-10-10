# Exhibition Module — Implementation Plan

**Status: PROPOSAL, awaiting approval. No code written.** Prepared 2026-08-17 from
`Exhibition_Portal_Workflow.xlsx` (all 14 sheets) checked against the live portal.

---

## 1. The headline

**About 60% of the workbook is already built, live, and carrying production data.**

The workbook was written as if we were building a standalone portal from scratch. Its
Phase 1 is "Login, users, roles, masters", and its database section proposes tables for
`users`, `clients`, `client_contacts`, `opportunities`, `followups`, `notifications` and
`audit_log`. Every one of those already exists here and is in daily use:

| Workbook proposes | Already live | Holding |
|---|---|---|
| `users` + employee master | `users` | 31 people, roles, sign-in, approval flow |
| `clients` | `clients` | 2,676 companies |
| `client_contacts` | `contacts` | 2,048 people |
| `followups` | `tasks` | the Action Registry, overdue sweeps, escalation |
| `opportunities` | `opportunities` | 1,637 deals |
| `notifications` | `notifications` | in-app bell + Resend email |
| `audit_log` | `audit_log` | 3,131 entries |

Building them again would create a second CRM alongside the first: duplicate customer
records, a follow-up list that the Action Registry cannot see, and a parallel
notification system. **Those tables must be struck from the plan.**

What is genuinely new is narrower and clearer:

- **Six new tables** — exhibitions, team, approvals, expenses, expense invoices, meetings.
- **An approval workflow.** The portal has no business-record approval anywhere today;
  the only "approve" is account approval. This is the one real greenfield concept.
- **A spend model.** Every money column in the portal today is revenue coming in. There
  is no model for money going out.
- **A visibility rule for events.** All existing visibility flows through a client's
  tour. An exhibition has no client and no tour.

Everything else is reuse, or a one-column change to an existing table.

---

## 2. Reuse vs build

| What the spec asks for | Verdict | Notes |
|---|---|---|
| Login / authentication | **Reuse** | No work. Living at `/risansi/exhibitions` is auth-gated automatically. |
| Roles & permissions | **Reuse** | Existing `rep / manager / admin / sysadmin` ladder, used in 42 places. |
| Employee master, user admin | **Reuse** | Existing Users & Access screens. |
| Client master + contacts | **Reuse** | 2,676 clients, 2,048 contacts. |
| Client 360 history | **Reuse + 1 change** | Exhibition meetings need adding to the activity feed's allowed types, or they save and stay invisible. |
| Follow-ups / actions | **Reuse `tasks`** | Gains overdue reminders, 5-day escalation and the weekly digest for free. |
| Opportunities | **Reuse + 1 column** | Exhibition deals become ordinary pipeline rows, tagged with their origin. |
| Notifications (portal + email) | **Reuse** | All 7 exhibition notifications fit the existing plumbing. No new email templates. |
| Audit trail | **Reuse** | Existing `recordAudit`. |
| Money entry & formatting | **Reuse** | Existing rupee input that survives Indian comma formatting. |
| Invoice upload / download | **Reuse pattern** | Copy the quotation-PDF route, including its file-type checks. |
| Filters, KPI tiles, charts, tables, Excel export, print | **Reuse** | All exist in the Opportunities area. |
| **Exhibitions, team, approvals, expenses, meetings** | **Build** | Six tables, described below. |
| **Approval workflow** | **Build** | Nothing analogous exists. |
| **Event visibility rule** | **Build** | One new helper. |
| **Rep-created prospect** | **Build small** | Today a rep cannot create a client anywhere in the portal — it is admin-only. |
| "Boss / Approver" role | **Build as permission** | Not a new role — see §4.1. |
| "Exhibition Manager" role | **Build as data** | Team lead on that exhibition, not a global role. |
| Generic `documents` table | **Do not build** | The portal attaches files per record type; a generic store would break that. |

---

## 3. New database tables

Six tables, added as migrations `0053`–`0055`. Nothing existing is renamed or dropped.

**`exhibitions`** — the event. Name, venue, city, country, start/end dates, status
(Planned → Submitted → Approved / Rejected → Live → Completed → Cancelled), budget,
who created it, who approves it, visibility (company-wide or team-only).

**`exhibition_team`** — who is attending, and who leads. One row per person per event,
each linked to an existing user. Mirrors how tour assignments already work.

**`exhibition_approvals`** — the decision history. What was submitted, by whom, the
decision, who made it, when, and the comment. Append-only, so the trail survives.

**`exhibition_expenses`** — one row per cost line: category, vendor, estimated, actual,
paid, payment status. **In rupees**, not crores (see §4.5).

**`exhibition_expense_files`** — the invoice attached to an expense line.

**`exhibition_meetings`** — a conversation at the stand: which client, which contact,
what was discussed, the outcome, who captured it. Links to an existing client, or to one
created on the spot.

Plus three small additions to existing tables: a link from a task to the meeting that
created it, a link from an opportunity to its originating meeting, and an "exhibition"
value in the opportunity origin tag.

---

## 4. Five decisions that need your call

These carry real risk and cannot be decided from the workbook.

### 4.1 Who is the "Boss / Approver"?

The portal's roles are a fixed ladder — rep, manager, admin, sysadmin — with a database
constraint. Adding a fifth role means touching a dozen files and every place that lists
roles. **We recommend treating approval as a permission, not a role.**

The catch: **14 of 31 active users (45%) are already admin or sysadmin.** Mapping
"Boss" to "any admin" would let nearly half the company approve exhibitions.

> **Recommendation:** a *named approver per exhibition*, so approval sits with one
> specific person, with sysadmin as the fallback. The column is in the design either way,
> so this can be switched later without a migration.

### 4.2 Exhibitions are company-wide; the portal is tour-scoped

Everything a rep can see today is decided by which tour a client sits on. An exhibition
has no client and no tour, so if we reuse the existing rule, **17 of 31 users would see an
empty module.** We add a separate rule for exhibitions rather than bending the client one.

> **Recommendation:** exhibitions are visible company-wide by default, with an option to
> restrict one to its team.

### 4.3 A stranger met at the stand

A new prospect met at an exhibition belongs to no tour. Two constraints matter:

- **A rep cannot create a client anywhere in the portal today** — it is admin-only. We
  need a narrow path that lets a team member create a lead-coded prospect and nothing more.
- **The client search a rep uses only shows clients on their own tour.** At a booth they
  typically *cannot see* a company another rep already owns, so they will create a
  duplicate. We add a name-matcher that checks across the whole database and says
  "this exists, it belongs to X" without exposing the record.

> **Recommendation:** do not invent an "Exhibition" pseudo-tour. It would corrupt visit
> frequency, coverage reporting and the manager digest.

### 4.4 Do exhibition deals count in the normal pipeline?

Opportunities raised from an exhibition will be ordinary pipeline rows, so **by default
they flow into the pipeline totals, the forecast and the annual-target gauge.** That is
probably what you want, but it must be a conscious decision — otherwise exhibition
business is counted both in the event's ROI and in the sales forecast.

Also note the existing rule: a deal cannot jump straight to Won — it must pass through
Quoted, and Won requires a sales order. A booth conversation cannot become a booked order
in one step. The honest at-show metric is *"exhibition leads that reached Quoted"*.

### 4.5 Money units — the one that silently destroys data

The portal stores deal values in **crores** and offer values in **rupees**. Exhibition
spend is lakhs-scale — exactly the range where a rupee figure in a crore column still
looks plausible and quietly corrupts totals.

> **Rule:** all exhibition expenses are **rupees**, in rupee-typed columns, entered
> through the existing money input. Conversion happens once, at the ROI calculation, and
> never touches an opportunity. No spend figure may ever reach a pipeline query.

---

## 5. Delivery phases

The workbook's Phase 1 is deleted — it is already built. Re-cut against reality:

| Phase | Delivers | Size |
|---|---|---|
| **0. Pre-flight** | Confirm live column sets before altering anything; register the new section. | S |
| **A. Core** | Exhibition records, list and detail pages, create form, visibility rule, navigation. | M |
| **B. Team + approvals** | Team assignment, submit / approve / reject, approvals queue, notifications, full audit. The genuinely new workflow. | M–L |
| **C. Expenses** | Cost lines, budget vs actual vs paid, invoice upload. | M |
| **D. Meetings + lead capture** | Booth conversations, existing-client search, on-the-spot prospect creation, duplicate matcher, Client 360 wiring. | L |
| **E. Follow-ups** | Actions from meetings land in the existing Action Registry with reminders and escalation. | S–M |
| **F. Opportunity link** | Raise an opportunity from a meeting; correct origin labelling everywhere. | M |
| **G. Reporting + ROI** | Post-event review, status dashboards, Excel export, print, ROI. | M–L |
| **H. Reminders + mobile** | "Event starts in 7 days" nudges on the existing daily job; mobile nav. | S |

**Ordering matters:** B before C (expense sign-off reuses the approval machinery);
D before E and F (both need a real client); G last (ROI needs both spend and attributed
deals to say anything).

A usable module exists at the end of **B**. It becomes a CRM feature at **D**.

---

## 6. Questions for the client

1. **Who approves** — one named person per exhibition, or any admin?
2. **What is approved** — the plan, the budget, both? Is there a second approval on
   actual expenses before payment?
3. **Booth capture** — full prospect details typed at the stand, or a business card
   captured as text and converted later? (The first makes follow-ups work immediately;
   the second is faster at the booth but nothing downstream can be raised until conversion.)
4. **Cross-tour leads** — a rep meets a company already on someone else's tour. Does the
   capturer keep the follow-up, or does it hand over to the tour owner? Sales-ops policy.
5. **ROI definition** — is "return" quoted value, won value, or realised order value?
   Over what window after the event? Deals often close 6–18 months later.
6. **Expense categories** — please supply the list.
7. **Currency** — INR only? There is no multi-currency model; an event billed in EUR is
   not currently expressible.
8. **Personal reimbursement** — in scope? Per-diem and travel claims would turn this into
   an employee-claims system; we recommend keeping it out.
9. **Non-employee team members** — agency staff on the stand cannot appear on a roster
   without a user account, and sign-up is restricted to company addresses.
10. **Recurring events** — is "IFAT 2026" the same entity as "IFAT 2028" for year-on-year
    comparison? Cheap to support now, expensive later.
11. **Badge-scanner imports** — if lead lists will be uploaded, the duplicate matcher
    becomes essential rather than optional.
12. **"PDF export"** — is a printed/saved page enough (what the portal does today), or is
    an emailed PDF attachment required? The latter is a platform change, not part of this estimate.

---

## 7. Two existing issues found while surveying

Unrelated to exhibitions, but they surfaced during this review and both affect it.

1. **`client_status_log` does not exist**, yet production code inserts into it in two
   places. Those inserts fail silently inside error handlers. **Verified against the live
   database.** So there is no client status history today — worth knowing before we design
   lead-stage reporting on top of it.
2. **No baseline schema file.** 19 of 43 live tables — including `clients`, `contacts`,
   `tasks` and `opportunities` — have no `CREATE TABLE` anywhere in the repo; the
   migration series assumes they already exist. The exhibition tables will reference those
   parents. We recommend capturing a baseline schema dump alongside this work, and at
   minimum verifying live columns before altering `tasks` or `opportunities`.
