# Moving the Sales Portal into Risansi Digital

Plan of record, 10 Oct 2026. Based on reading all five repositories. Nothing has been changed in any repo yet.

Decisions are settled (§2). The phases in §6 are the work.

---

## 1. What is actually there

**`risansi-digital`** is a single static page: `index.html` (755 lines, inline CSS and JS), five image assets, a one-line README, three commits. No build, no server, no database, no auth.

So this is not "move the sales portal into an existing app". It is "turn the hub into an application, with the sales portal as its first tenant".

### The four portals

| Tile | Repo | Next | Data access | Session | Secret | `users.id` | FKs → users |
|---|---|---|---|---|---|---|---|
| Sales | `risansi_market_intel` | 16.x | raw `pg` | NextAuth, JWT, 8 h | `NEXTAUTH_SECRET` | **`integer`** | **48** |
| Testing | `risansi-testing` | 15.5 | Drizzle | own JWT, cookie `auth_token` | `JWT_SECRET` | `uuid` | 0 declared |
| Pump Selection | `risansi_pump_selection` | 15.5 | Drizzle | own JWT, cookie `auth_token` | `JWT_SECRET` | `uuid` | 0 declared |
| SO to Dispatch | `ec_to_dispatch` | 16.2 | raw `pg` | own, `SESSION_SECRET` | `SESSION_SECRET` | `uuid` | 13 |

Sizes: sales is 610 commits, ~82,000 lines of TS/TSX, 44 pages, 47 API routes, 22 action files, 155 components, 115 migrations. SO-to-Dispatch 337 commits, Pump Selection 228, Testing 181.

The local `risansi_calculator` (Vite SPA, no auth) is an early prototype of Pump Selection; the live portal is the Next app.

### Databases

Four, confirmed as the intended end state (§2.6):

- **Sales** — its own (`DB_HOST` + `RISANSI_DB_NAME`).
- **Testing and Pump Selection share one.** Pump Selection's schema says so: *"This project uses `users_pump`, a fork of the shared `users` table (seeded once from it). `users` stays owned by the testing portal — we never touch it."*
- **SO-to-Dispatch** — its own (`DATABASE_URL`), **plus a second pool into the sales database** (`DATABASE_URL_EXT`) to read `public.clients`.

### The portals are already entangled

A stronger argument for this project than "users have several passwords":

1. **`users_pump` is a seeded fork** of the testing portal's `users`. Two tables, one origin, no sync. Already drifted: `must_change_password` defaults to `true` in testing, `false` in pump.
2. **Pump Selection denormalises sales rep data.** `quotations` carries `tsm_rep_id integer` — *"Market Intell users.id of the TSM (a reference only — no FK across DBs)"* — plus copies of `tsm_name`, `tsm_initials`, `tsm_zone`. Rename a rep or move their zone in sales and the copies go stale silently.
3. **SO-to-Dispatch reads the sales database directly**, second pool, straight at `public.clients`. No contract, no FK. A column rename in sales breaks it with nothing failing at build time.

Unification is not adding coupling. It replaces three ad-hoc couplings with one deliberate one.

### Three of four already have access requests

Testing, Pump Selection and SO-to-Dispatch all have an `access-requests` concept with `pending` / `approved` / `rejected` on the user row and an admin screen to decide. Sales has the same under capitalised spelling. The hub's grant model generalises something that exists four times over.

### Role vocabularies do not overlap

- Sales: `rep`, `manager`, `admin`, `sysadmin`, `staff`, plus a separate departments list
- SO-to-Dispatch: `admin`, `central_visibility`, `operations`, `accounts`, `drawing`, `planning`, `purchase`, `qc`, `assembly`, `dispatch`, `order_making`
- Testing / Pump Selection: `user`, admin above it

There is no global role and there should not be one. A grant carries an app-specific role string; each app keeps interpreting it.

---

## 2. Decisions taken

1. **One repository, several deployments.** The repo is the unit of organisation; the deployment stays the unit of blast radius.
2. **Order: Sales, then Testing + Pump Selection, then SO-to-Dispatch.** I had recommended the reverse, because Testing and Pump Selection already share a database and a session mechanism and have no FK constraints, while sales is the largest codebase with the only framework swap and the only real FK surface. Sales-first stands. It is workable because the design in §5 never touches those 48 foreign keys — but it does mean the riskiest cutover happens before anyone has rehearsed the pattern, so §6 Phase 3 gets a full rehearsal against a restored database rather than a staging deploy.
3. **`sales.risansi.com` stays. The hub is the only door.** The hub is the only URL anyone is given; clicking Sales navigates to `sales.risansi.com`, already signed in. What gets "disabled" is **direct entry, not the URL**: an unauthenticated hit on sales redirects to the hub to sign in, and the portal's own sign-in page is retired.

   This avoids Next `basePath`, which was the alternative reading. Measured cost of that path, for the record: ~115 call sites (72 `fetch('/api/…')`, 36 plain `<a href="/…">`, 6 `<img src="/…">`, 2 `window.location`), a new build gate to hold it, and a build-time-inlined prefix that cannot be toggled per environment. `<Link>` (30) and `revalidatePath` (155) would have been unaffected. Not needed now.

   A happy consequence: `APP_URL` and every link already sent out in a notification email or embedded in an Excel export keeps working untouched.
4. **Password merge: carry the hashes, force a reset only on a real conflict.**
   *Revised 11 Oct 2026.* The original decision was a blanket reset for
   everyone, taken when the question looked like "this person has a sales
   password and a testing password, which wins?". Sequencing dissolves most of
   that: at Phase 3 only sales moves, so there is no conflict to resolve.
   Sales hashes with bcrypt cost 10 and so does `@risansi/identity`,
   deliberately, so those hashes copy across and keep working — **nobody
   resets anything on cutover day**, which takes a great deal of risk out of
   the one day everybody notices.

   The conflict is real at Phase 4, when somebody already holding an identity
   row from sales also has a testing password that will stop working. That is
   41 people at most, not 91, and only those whose two passwords actually
   differ. `must_change_password` exists in all four portals and is enforced;
   it gets used there, on the people it applies to.
5. **One approver for all applications.** No per-app approver table, no routing rules. A single `identity` role may decide any grant.
6. **Four separate databases, mixed and matched as needed.** So `identity` gets its own home and **no app can foreign-key to it.** The design in §5 assumes exactly that: link by column, not by constraint.

---

## 3. Shape

```
risansi-digital/
  apps/
    hub/              sign-in, portal tiles, access requests, user admin
    sales/            risansi_market_intel, moved with its history
    testing/          risansi-testing
    pump-selection/   risansi_pump_selection
    so2dispatch/      ec_to_dispatch
  packages/
    identity/         token format, verify, session helpers — imported by every app
  migrations/
    identity/
```

Each app keeps its own Vercel project and domain.

### Sessions: four mechanisms become one token

Four session implementations, three secrets, two cookie names. All four are the same *shape* — a signed JWT in an httpOnly cookie — so the fix is a shared token, not a shared framework:

- `packages/identity` owns one token format, one secret, one cookie (`risansi_session`, **domain `.risansi.com`** so every portal sees it) and one `verifySession()`.
- The hub is the only thing that issues it.
- Each app replaces its own verify with the shared one: sales retires the NextAuth credentials provider, the other three swap their `jose` / `jsonwebtoken` verify.

Because the cookie is scoped to `.risansi.com` rather than one host, it is visible to every current and future subdomain. That is the price of decision 2.3 and worth stating plainly: any subdomain anyone stands up on `risansi.com` can read it. Keep the cookie `httpOnly`, `Secure`, `SameSite=Lax`, and do not host untrusted content on a `risansi.com` subdomain.

**The hub links to portals, never iframes them.** Sales sets `frame-ancestors 'none'` and that header is correct.

### What happens when someone opens a `sales.risansi.com` link

This is the common path, not an edge case: deep links are already sitting in sent
notification emails and inside Excel exports clients open weeks later.

| State | Result |
|---|---|
| Signed in, sales grant approved | The page loads, exactly where the link pointed. The cookie is scoped to `.risansi.com`, so the browser sends it to sales too. |
| Signed in, no grant | Bounced to the hub, which shows that tile as Requested or Not granted. |
| Signed out | Bounced to the hub to sign in, then **returned to the page they clicked**. |

That last row needs work, because it is broken today. `proxy.ts` line 34 reads:

```ts
return deny(401, 'Not signed in.', '/api/auth/signin');
```

No `callbackUrl`. Signed out, clicking a link to one complaint from an email,
you sign in and land on the portal home with the complaint gone. A papercut
today; worse after the cutover, when the bounce crosses a domain.

Two requirements fall out of it:

1. The redirect carries the destination — `…/sign-in?next=<original URL>` — preserving the full path **and query string**, since some export links carry parameters.
2. **`next` is validated against an allowlist of `*.risansi.com` origins.** An unvalidated redirect parameter on a login page is a phishing vector: the attacker sends `digital.risansi.com/sign-in?next=https://evil.example/`, the victim sees the real domain, signs in, and is handed to the attacker. Reject anything not on the list and fall back to the hub landing page.

---

## 4. Identity and per-app access

```
identity.users        id uuid PK, email (unique on lower(email)), name,
                      password_hash, must_change_password, is_active,
                      created_at, updated_at
identity.apps         slug, name, url, is_live
identity.app_grants   user_id uuid, app_slug, status, app_role,
                      requested_at, requested_reason,
                      decided_by, decided_at, decided_note
identity.auth_events  the four separate audit logs, promoted
```

`status`: `Pending` / `Approved` / `Rejected` / `Revoked`.

Every app gains one column: `identity_user_id uuid`, unique. Not a foreign key — it cannot be, across databases (§2.6).

**Identity owns who you are. `app_grants` owns what you may open. The app owns what you are inside it.**

### The id-type split, and why the 48 FKs are never touched

Sales uses `integer` ids with 48 FK constraints. The other three use `uuid` with no declared FK constraints at all.

An earlier draft proposed repointing all 48 sales FKs at a central table. That is the wrong answer: it would mean a type change across 48 constraints so that one portal could match a table the other three can already join natively, and the sales FKs are the only ones that exist as constraints in the first place.

Instead:

- **Sales** keeps its `integer` `users.id` and all 48 FKs **unchanged**. It stops holding `password_hash`, `must_change_password` and `status`; it keeps `role`, `rep_code`, `initials`, `zone`, `route`, `target_cr` — a sales profile, not an identity.
- **The other three** can seed their `uuid` ids equal to the identity uuid, so their columns need no remapping either.
- `users_pump` stops being a credential fork and becomes a profile row.

### The seam that keeps the sales change small

76 files call `getCurrentUser()` and 49 call `getServerSession()`, but only about ten read a session claim (`session.user.role`, `.repId`, `.departments`, `.risansiAccess`) directly.

`lib/risansi-auth.ts` is the seam. Keep the shape:

```ts
interface CurrentUser { id: number | null; email: string | null; role: RisansiRole; departments: Department[] }
```

and resolve it from the shared session plus the sales grant and profile, rather than from `users`. **The sales migration then touches roughly ten files, not 76.** `id` stays the integer all 48 FKs already use.

The NextAuth JWT callback re-reads the database on every request, which is how revoking someone takes effect on their next click rather than in eight hours. `verifySession()` must keep that property.

### The access-request flow

1. One sign-up at the hub creates an `identity.users` row. No grants.
2. The hub shows every tile in `identity.apps`, each in one of four states: **Open**, **Request access**, **Requested**, **Not granted**.
3. Requesting creates a `Pending` grant and notifies the approver. Sales already has Resend plumbing and a cron escalation sweep to reuse.
4. The approver approves and **sets the app role at that moment**.

One improvement to take while we are here: the sales sign-up form lets the requester pick their own role. The approver should set it. A request carries a reason, not a claim.

---

## 5. Phases

### Phase 1 — Move the sales code. No behaviour change.
- `git subtree` the portal into `risansi-digital/apps/sales`, history intact. 610 commits, 28 MB, no LFS, no real submodules, largest blob 13 MB.
- Remove the orphan gitlink first: `.claude/impeccable-main` is committed as mode `160000` with **no `.gitmodules`**, so a fresh clone leaves an empty directory and `git submodule update` fails. It arrived in commit `6e3ebfd`.
- Point the existing Vercel project at the new repo and `apps/sales`. Keep every environment variable, both cron paths, and the domain.
- **Nothing about the running application changes.** Same domain, same `APP_URL`, same login.
- Done when: the deployed site is the same application on the same domain and all nine build gates pass.

**Status: DONE and live, 10 Oct 2026.** Merged as PR #1 (`a331a70`). The Vercel
project now reads `risansi-digital` with Root Directory `apps/sales`, on the
same `sales.risansi.com` domain. Verified in production: sign-in works, the
dashboard returns real figures, saving works, and both cron jobs are listed.

- 680 files, all recorded as `R100` — pure renames, every blob hash identical to
  `ae51dcc` in the old repo. The code did not change.
- 610 commits of history joined, not squashed. `git log --follow` and
  `git blame` both trace through the move.
- `index.html` and `assets/` untouched at the repo root, so the current static
  hub still deploys exactly as it does today.
- Verified from a fresh clone of the branch: `npm ci`, all nine gates, `tsc
  --noEmit` clean, `npm run build` green.
- The CI workflow had to move to the repo root as
  `.github/workflows/sales-ci.yml`, scoped with `paths` to `apps/sales/**`.
  GitHub only reads `.github/workflows` from the root, so leaving it inside the
  app would have silently stopped the only automated gate the repo has.

**One thing for Windows developers.** `apps/sales/` adds 11 characters to every
path, and Turbopack writes some long chunk filenames under `.next/server/chunks/ssr/`.
A build inside a deep directory now hits the Windows 260-character `MAX_PATH`
limit and fails with a Turbopack panic rather than a useful message. Clone
shallow — `C:
isansi-digital` rather than somewhere under `Documents\...` — or
enable long paths (`git config --system core.longpaths true` plus the
`LongPathsEnabled` registry key). Vercel builds on Linux and is unaffected.

**What has to happen in Vercel, by hand:**
1. Merge `phase-1-sales` into `main`.
2. In the existing sales Vercel project, change the Git repository to
   `risansi-digital` and set **Root Directory** to `apps/sales`.
3. Leave every environment variable exactly as it is, including `APP_URL`,
   `NEXTAUTH_SECRET`, the `DB_*` set and `CRON_SECRET`.
4. Confirm both cron paths still read `/api/cron/daily` and `/api/cron/weekly` —
   `vercel.json` travelled with the app and is read relative to the root
   directory, so they should be unchanged.
5. Keep the `sales.risansi.com` domain on that project.
6. Deploy, then sign in and click through one page from each area before
   archiving the old repo.

### Phase 2 — The hub becomes an application.
- `apps/hub`: Next app, hub's own domain. Port the static page in as the signed-in landing view.
- `packages/identity`: token format, cookie, `verifySession()`.
- Build `identity.users`, `identity.apps`, `identity.app_grants`, the request and approve screens, and password set/reset. The hub becomes the only place a password is ever set.
- No portal is touched. Every existing login still works.
- Done when: someone can sign up at the hub, see the tiles, request sales access, and the approver can approve it — with the grant having no effect yet.

### Phase 3 — Sales cutover. Five deploys, one of them visible.
Rehearse against a restored copy of the sales database first (§2.2).

Split up *after* the proxy staleness below came to light, because a single
cutover would have put that discovery on the day everybody was watching.

| Step | What ships | Who notices |
|---|---|---|
| 1 | Sales *can* read the shared session. NextAuth stays primary. | nobody | **done** 11 Oct |
| 2 | Seed `identity.users` and the grants from sales. | nobody | **done** 11 Oct |
| 3 | Sales prefers the shared session, NextAuth as fallback. | nobody | **done** 11 Oct |
| 4 | Sales' sign-in redirects to the hub. | **everybody** | **done** 11 Oct |
| 5 | Remove NextAuth and the credential columns. | nobody | to do |

Three things the steps turned up that the plan had not foreseen:

- `proxy.ts` gates before anything else and knew only NextAuth, so a valid
  shared session was bounced before reaching the code that would have
  recognised it. Fixing that moved the `/risansi/admin` gate and the staff
  allowlist into the layout — they had been proxy-only, judged on a role
  baked into a cookie that `getToken()` never refreshes.
- 49 files called `getServerSession` directly rather than through the lib, so
  the first pass left pages working and every API route answering 401.
- `getSession()` is now on every request and `readToken` throws when the
  secret is missing, which would have locked out every NextAuth user over a
  variable nobody needed yet. It falls through instead.

Only step 4 is a cutover. Steps 1-3 are additive, and if step 3 misbehaves
people fall back to the sales login with nothing to undo.

**Where the grant check goes, and why not the proxy.** An earlier draft had
`proxy.ts` testing the sales grant, on the strength of a comment there saying
the jwt callback re-reads `users` on every request so the value is live. That
comment was wrong — `withAuth` reads the cookie through `getToken()`, which
decodes without running the callback — and it surfaced on 11 Oct as a
deactivated account rendering a portal full of zeros instead of being refused.

So the grant is checked in `getCurrentUser()` and the layout, which genuinely
re-read per request, and the proxy stays a cheap outer door that turns away
the common case without a round trip. Written down here rather than
rediscovered on cutover day.

- Seed `identity.users` from sales `users`, carrying the bcrypt hashes (§2.4); add `users.identity_user_id`.
- Give every existing sales account an Approved grant whose `app_role` is its current sales role, so nobody loses access on the day.
- Rewrite `lib/risansi-auth.ts` to resolve `CurrentUser` from shared session + grant + profile. Keep the shape: 76 files call it and only about ten read a claim directly. Sales keeps its integer `users.id` and all 48 foreign keys.
- Credential columns stay on `users`, unread, for one release. Dropping them is step 5.
- Done when: one login at the hub opens sales, and revoking the grant locks someone out on their next click.

### Phase 4 — Testing and Pump Selection.
- Merge `users` and `users_pump` into `identity.users` by email, resolving the drift. Produce a reconciliation report **before** the merge runs.
- Seed identity uuids to the existing testing uuids so nothing remaps.
- Both apps swap their verify for the shared one and read their grant. `users_pump` becomes a profile row.

### Phase 5 — SO-to-Dispatch, and paying off the couplings.
- Same cutover.
- Replace `DATABASE_URL_EXT` — the direct read into the sales database — with a real interface. With four databases that means an API in sales, not a view.
- Replace `quotations.tsm_name` / `tsm_initials` / `tsm_zone` with a lookup once rep identity is shared, so the copies stop going stale.

---

## 6. Risks and open items

- ~~Email overlap is unmeasured.~~ **Measured, 10 Oct 2026** — see §7.
- **`users_pump` has already drifted** from `users`. Expect more differences in the data than in the schema.
- **The cookie is domain-wide.** `.risansi.com` is readable by every subdomain, now and in future. Consequence of decision 2.3, not a defect, but it constrains what may ever be hosted on a `risansi.com` subdomain.
- **Sales-first means no rehearsal of the pattern.** Mitigated by rehearsing Phase 3 against a restored database.
- **Nothing shipped recently has been opened in a browser.** Unrelated to this plan, but the same gap: sales is sign-in gated and recent verification has been by build gate rather than by eye.

## 7. Who the users actually are

Counted across all four portal tables on 10 Oct 2026. All four databases sit on
one Azure server and one login reads them all, so this is repeatable: the script
lives in the session scratchpad and can be re-run before the cutover.

**151 account rows. 92 distinct people.**

| Portals held | People |
|---|---|
| 1 | 51 |
| 2 | 27 |
| 3 | 10 |
| 4 | 4 |

So **41 people hold more than one account**, which is the population that gains
most from this work, and **92 is the size of the forced-reset announcement**.

Per portal: Sales 49, Testing 28, Pump Selection 13, SO to Dispatch 61 — and
every single row in all four is approved or active. No pending, rejected or
disabled accounts anywhere, so there is nothing to triage before the merge.

Re-counted after the clean-up below: **150 rows, 91 distinct people**, 41 of
them still holding more than one account.

### Three things the count turned up, and what was done

1. **`marketing@` was Ankur — merged and deleted.** Both accounts signed in from
   the same two IP addresses (`103.164.188.14`, `152.58.129.212`) and the same
   browser, so this was one person with two logins, not a shared mailbox.
   Merged into `ankur.srivastava@risansi.com`: 571 client rows, 386 page-activity
   rows, 83 opportunities, 50 notifications, 7 assorted, and one
   `quotation.tsm_rep_id` in the **Pump Selection** database. He now holds 76
   live clients and 98 opportunities.

   That Pump Selection row is the cross-database reference described in §1 —
   a bare integer with no foreign key. Nothing would have stopped the delete
   from orphaning it, which is why it was moved first.

   **The 19 audit rows naming `marketing@` were deliberately left alone** (5 in
   `audit_log`, 14 in `auth_audit`, plus 12 holding the deleted id in
   `auth_audit.user_id`). On those dates somebody did sign in as that address.
   An appended audit entry records the merge and names the old address, so the
   thread is followable without altering what was logged.

2. **The four territory mailboxes stay as they are** — `westindia1@` (Vishal
   Gaikwad), `westindia2@` (Prashant Dhere), `northindia2@` (Amit Srivastava),
   `rekayasa.bakti@` (Susanta Pande). Decided 10 Oct 2026. The consequence to
   keep in mind: each login belongs to a territory rather than a person, so when
   a territory changes hands the account goes with it and the audit trail names
   the region. Acceptable, but it means "one person, one identity" is not quite
   true for these four.

3. **`admin@risansi.com` is retired in sales, and still live in two others.**
   In sales it keeps its row but cannot be signed into: status off `Approved`,
   `is_active` false, password hash removed. Its 3 manager-rep links, 2 bug
   reports and 42 audit rows stay attributed to it, so history reads true. The
   173 live notifications moved to `mfarhan@risansi.com`.

   `mfarhan@risansi.com` and `araza@risansi.com` both already existed and were
   already `sysadmin`, so only temporary passwords were issued, with
   `must_change_password` set so each must choose their own at next sign-in.

   **Still open: `admin@` remains fully active with a working password in
   Pump Selection (`system_admin`) and SO to Dispatch (`admin`).** Retiring it
   there is part of those portals' cutovers, or can be done sooner — it is the
   same shared-account problem, just in two databases nobody has touched yet.

4. **Ten sysadmins out of 91 people**, all able to reset anyone's password.
   Worth a look when grants are designed in Phase 2: the hub's approver role is
   a chance to separate "can approve access" from "can do anything".

The per-person breakdown was written to `portal-user-overlap.csv` at the time of
the count. It carries staff email addresses and was deliberately not committed.

## 8. What I have not done

No repo has been changed. Phase 1 is a destructive, outward-facing operation — it repoints a live Vercel deployment — so it waits for an explicit go.

Independent of all of this, the orphan `.claude/impeccable-main` gitlink breaks `git submodule update` on a fresh clone today. I can remove that on its own whenever you want.
