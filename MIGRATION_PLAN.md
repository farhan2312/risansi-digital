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
| 4 | Sales' sign-in redirects to the hub. | **everybody** | **done and verified** 11 Oct |
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

Step 4 was verified end to end on 11 Oct: a hub sign-in opens sales with no
second login, a deep link followed while signed out comes back to the page
asked for, and the old `/api/auth/signin` redirects rather than showing a
form.

Two more things it turned up, both found by asking why a signed-out deep link
still rendered the portal — it had not: a pre-step-4 NextAuth cookie was still
being honoured.

- **Sign out signed you out of one portal.** The button called next-auth's
  `signOut()`, which clears `next-auth.session-token` and knows nothing about
  the shared `risansi_session`. Anybody who signed in through the hub — by now
  everybody — clicked it and was waved straight back in. Both cookies are
  cleared by one server action in sales now; the shared one is on
  `.risansi.com` and sales is a subdomain, so no cross-origin hop is needed.
- **The sidebar's Change Password dialog wrote a dead column.** It POSTed to
  `/api/auth/change-password`, which hashes into `users.password_hash` — not
  the credential store since step 4 — and reported success. It was on every
  screen, which made it worse than the `/change-password` page, whose only
  callers are old emails. Dialog removed, menu links to the hub, route answers
  410 with the new address.

The pattern in all four findings is the same: step 4 changed where the
credential lives, and every surface that still *wrote* one had to be found
by hand, because writing to a column nobody reads raises nothing.

A lingering NextAuth cookie stays honoured until step 5 or until it expires,
whichever comes first — no new ones can be minted, so the pool drains within
eight hours of the last pre-cutover sign-in. Hub sign-out does not clear it
(different host, host-only cookie); the sales sign-out button does.

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

**Step 5, concretely.** Remove the NextAuth fallback in `getSession()`, the
`[...nextauth]` route and `authOptions`, the `/api/auth/change-password`
handler, and `users.password_hash` / `must_change_password` in sales. The
fallback is already nearly inert — nothing can mint a NextAuth cookie now —
so the release it is waiting out is a formality against the shared session
proving unreliable, not a live escape hatch.
- Done when: one login at the hub opens sales, and revoking the grant locks someone out on their next click.

### Phase 4 — Testing and Pump Selection.
- Merge `users` and `users_pump` into `identity.users` by email, resolving the drift. Produce a reconciliation report **before** the merge runs.
- ~~Seed identity uuids to the existing testing uuids so nothing remaps.~~ **Not possible — see below.**
- Both apps swap their verify for the shared one and read their grant. `users_pump` becomes a profile row.

#### Phase 4a — move the code. No behaviour change.

*Added 12 Oct 2026, and it should have been here from the start.* Decision
§2.1 is one repository, but only sales ever got a written move step. Testing
and Pump Selection need the same one, and it comes **before** the auth swap,
not after.

*Also decided 12 Oct: we run this migration ourselves rather than handing it
to the portals' own developers. The "blocked on a conversation" note below
now only covers retiring `admin@`.*

**Why before.** The reason to be in this repo is to `import` from
`packages/identity`. From outside it, those apps would reimplement the session
format by hand and you would have two implementations of one contract drifting
apart. Move first and the swap becomes an import. (`SESSION_CONTRACT.md`
exists for the case where an app genuinely cannot import it.)

**Why its own deploy.** Phase 1 is the model: move the code, change nothing,
prove the site is the same application on the same domain, and only then
change behaviour. That separation is what made the sales cutover survivable —
when something broke, it was obvious which of the two changes did it.

Per app, into `apps/testing` and `apps/select`:

1. `git subtree` the repo in, history intact. Check for an orphan gitlink
   first — sales carried a mode `160000` entry with no `.gitmodules`, which
   leaves an empty directory on a fresh clone and makes `git submodule update`
   fail.
2. In that app's Vercel project, change the Git repository to
   `risansi-digital` and set **Root Directory** to `apps/testing` /
   `apps/select`.
3. Leave every environment variable exactly as it is.
4. Keep the domain on that project, and confirm any cron paths still resolve —
   `vercel.json` travels with the app and is read relative to the root
   directory.
5. Move the CI workflow to `.github/workflows/<app>-ci.yml` at the repo root,
   scoped with `paths`. GitHub only reads workflows from the root, so leaving
   one inside the app silently stops it running.
6. Deploy, then click through one page from each area before touching
   anything else.

Done when: the deployed site is the same application on the same domain, and
nobody can tell it moved.

**Two traps that will recur.** If the app is Next, `turbopack.root` and
`outputFileTracingRoot` must both be set to the repo root *and agree* — Vercel
sets `outputFileTracingRoot` itself, and when it disagrees Next discards yours
and fails to resolve `@risansi/identity`. And on Windows the extra path depth
plus Turbopack's long chunk filenames hits `MAX_PATH`; clone shallow or enable
long paths.

**Status: code moved 12 Oct 2026.** `risansi-testing` → `apps/testing` (181
commits), `risansi_pump_selection` → `apps/select` (228 commits). History
joined rather than squashed: both move commits are pure renames, 257 and 357
files, zero insertions and zero deletions, and `git log --follow` and
`git blame` both trace through to the original authors and paths. `npm ci`,
`tsc --noEmit` and `npm run build` are green for both. Vercel still has to be
repointed by hand — steps 2 to 6 above.

`apps/select` is named for its `app_slug`. Its `package.json` still says
`sales-portal-next`, which is a fork artefact and nothing to do with the sales
portal.

**The stack question is settled.** Both are Next 15.5.7 and TypeScript, so
both can import `@risansi/identity` at 4b and `SESSION_CONTRACT.md` is a
reference rather than a specification to implement. The Python that
`alembic_version` implied is real but confined to `apps/select/azure-functions`,
which has its own `shared/auth.py` — so Pump Selection authenticates in two
runtimes and 4b has to change both.

#### 4b, first half — the role comes from the grant. Done 12 Oct 2026.

Both portals now read whether somebody may open them, and in which role,
from `identity.app_grants`. Their own `users` / `users_pump` tables keep
everything else and stay the primary key for all of it.

Smaller than estimated, because neither app had the staleness bug sales did.
Testing's `decodeToken` already re-read the account every request and
overrode the token's role from it; Pump Selection ends the session whenever
the account's role stops matching the token's. So it is two functions, not a
sweep of 150 call sites.

- **Testing** — `loadLiveUser()` in `src/lib/auth.ts`.
- **Pump Selection** — `resolveAccess()` in `src/lib/effective-role.ts`,
  shared by `session-guard.ts` *and* the login route. It has to be shared:
  that app mints the role into the token and then signs people out when the
  account's role stops matching it, so reading the role from two different
  places would sign everybody out on their next request, permanently, with no
  way for the mismatch to resolve.

**Unlinked accounts keep the old behaviour**, and that is what makes this
deployable on its own. The eight rows left out of the Phase 4 seed fall
through to their local role and stop working at cutover, as agreed, rather
than today.

**Verified against live data before committing:** every linked account in
both portals resolves to exactly the role it already holds. Deploying this
changes nobody's access.

Prerequisites done the same day: `0001_identity_user_id.sql` applied, and
`identity_user_id` filled for 21 of 28 Testing rows and 12 of 13 Pump
Selection rows — the gaps being exactly the deliberate exclusions.

**Before either can run**, both need `IDENTITY_DB_HOST`, `IDENTITY_DB_NAME`,
`IDENTITY_DB_USER`, `IDENTITY_DB_PASSWORD` (and optionally `_PORT`) in their
environment. Neither is deployed from this repo yet, so nothing is live and
nothing is broken; the variables go in when Vercel is repointed.

#### 4b, second half — the sign-in pages are gone. Done 12 Oct 2026.

Both portals redirect `/` to the hub, carrying `next`. `/api/auth/login` and
`/api/auth/change-password` answer 410 with the new address rather than 404,
because an old bookmark, a stale tab or a cached client bundle will hit them.
The local cookie is still *accepted*; nothing can *mint* one any more, so the
remaining ones drain within twelve hours. Removing the credential path
entirely is step 5.

**The forced-password-change trap, closed.** Five Testing accounts were
flagged `must_change_password` in that app's own table. Retiring the form
without this would have pinned them to a screen that no longer exists, with
no way to clear a column only that screen could clear. Both portals read the
flag from the shared session now; the hub forces the change and reissues the
session with it off.

**Found the hard way, and the reason one portal worked for hours while the
other did not:** the two apps have different shapes. Pump Selection has
middleware, so a shared session is noticed before any page renders. Testing
had none — its root path *is* the login page and `AuthGuard` only wraps the
dashboard group, so arriving with a valid session rendered the login form and
never called `/api/auth/me`. The session was never examined, the account was
never provisioned, and the only way in was a page you could not reach without
already being in. Four rounds went into secrets, environment variables and
database constraints, all of which were fine. Compare the shape of two apps
before comparing their configuration.

**A grant now creates the account it needs.** `users.id` is still the foreign
key on everything, so an approval with no local row resolved to nothing.
Both portals provision on first arrival, gated on the grant.

**What stops working today**, as agreed on 11 Oct: the eight accounts left out
of the seed — `centraladmin@`, `it@`, `testing@`, `source001@`, `test02@`,
`testing001@`, `narendrakushwaha@` and `admin@` — can no longer sign in once
their current cookie expires. Three of those are test logins in real use.

**What 4b already has to deal with, found during the move:**

- Both apps set `outputFileTracingRoot: import.meta.dirname`, pinning tracing
  to the app directory. Harmless today because neither imports anything from
  `packages/`; the moment one does, that has to become the repo root, and it
  has to agree with `turbopack.root` or Vercel discards it — the Phase 1
  failure, exactly.
- `apps/testing/next.config.ts` sends `form-action 'self'`. That is what
  blocked sign-out on sales for most of a day: the hub has to be named there
  before the cutover, not after.
- Testing's token carries `role` in the claims, which is the one thing the
  shared session deliberately does not do. Every read of `claims.role` becomes
  a grant lookup. That, not the verify swap, is the bulk of 4b.
- Both use cookie `auth_token`, `JWT_SECRET`, HS256, 12 hours, and
  `jsonwebtoken` rather than `jose`. The two apps share a secret and payload
  shape on purpose, so a token minted by either is valid in both — which means
  they have to cut over together, not one at a time.
- Neither repository had a CI workflow, so nothing needed moving to
  `.github/workflows`. Neither has one now either.

#### Reconciliation, measured 11 Oct 2026

Read-only, against the live databases. Four things the plan had wrong or had
not seen.

**1. The uuids cannot be reused, so a remap is unavoidable.** The plan assumed
identity could adopt the testing uuids and nothing would have to be rewritten.
It cannot: all ten people who exist in *both* `users` and `users_pump` carry a
**different uuid in each**, and none of the eighteen already seeded into
identity got an id matching either. There is no single uuid to adopt. Whatever
references those ids — `reviewed_by`, `user_sessions`, the test-requisition
chain — has to be remapped through an email bridge, and that work belongs in
the phase, not discovered during it.

**2. The schema has barely drifted; the data has.** Only two differences
between the tables: `users_pump` has `bug_feed_seen_at`, and
`must_change_password` defaults `true` in testing and `false` in pump. But
`users_pump` is no longer a subset — 28 testing rows, 13 pump rows, only 10
shared, and **three people exist in pump and not in testing at all**
(`amit.verma@`, `amit.bisht@`, `admin@`). "A fork, seeded once" no longer
describes it.

**3. The role vocabularies do not even agree between the two tables.** Testing
uses `admin` / `central-admin` / `source` / `testing`; Pump Selection uses
`admin` / `system_admin` / `user` / `pulley_owner`. Of the ten shared people,
**every one holds a different role in each**, and `admin` means something
different on each side. `identity.app_roles` already carries five rows for
each app — they need checking against these actual values before the merge,
not after.

**4. Thirteen addresses are new to identity, and four of them are junk.**
`test02@`, `testing@`, `testing001@`, `source001@` are test logins, and
`narendra.kushwaha@` / `narendrakushwaha@` are one person with two accounts.
That is a triage to run *before* the merge, or identity inherits the mess.
Note this contradicts §7's "nothing to triage" — that was measured on status,
and all of these are active.

Smaller: the cross-database reference is `public.quotation` (singular), not
`quotations` as §1 said. It is 33 rows across 9 sales reps with no nulls, so
replacing it with a real lookup in Phase 5 is a small job.

#### Seeded 11 Oct 2026 — `scripts/seed-identity-from-testing-select.mjs`

Identity now holds both portals. **52 people, 33 new grants** (21 testing, 12
select), every role carried from the portal's own table. Idempotent: a second
run reports nothing to do.

It writes to `risansi_identity` and nowhere else. Neither portal reads identity
yet, so this changed nothing anybody can see — which is the property that let
it be run now rather than on cutover day.

Two recon worries closed. `identity.app_roles` already covers every role
actually in use on both sides, so the vocabularies needed no migration. And
all hashes in both tables are `$2b$`, matching sales, so nobody gets a
temporary password for an account they already had.

Decided at the seed:

- **Shared mailboxes `centraladmin@`, `it@`, `testing@` are retired.** Two had
  never been signed into; the third had no activity.
- **Test logins `source001@`, `test02@`, `testing001@` are not carried**, and
  will stop working at cutover. They are genuinely used — 73 audit entries
  between them — so this is a known cost, not an oversight. The testers use
  their own accounts instead.
- **`narendrakushwaha@` ("DRG") is not carried**; `narendra.kushwaha@` is the
  surviving account. Its one session and one audit row are left pointing at
  the DRG id rather than moved. On that date somebody did sign in as that
  address, and re-pointing an audit row changes what the log says happened —
  the same call as the `marketing@` merge on 10 Oct.
- **Nothing was deactivated in `Pump_Selector_and_testing`.** An account with
  no identity row cannot sign in once the swap happens, so leaving the rows
  alone retires them on the day instead of changing a live portal another team
  owns.

#### What is left

1. **The uuid bridge**, written and ready for them to apply:
   `migrations/testing-select/0001_identity_user_id.sql`. Additive, nullable,
   inert — it is still a schema change to their database, so it goes through
   them. `scripts/link-testing-select-identity.mjs` fills it from identity by
   email.
2. ~~**Remap whatever points at the old uuids.**~~ **Not needed, and should not
   be done.** The audit below is why.
3. **Both apps swap their verify** and read their grant — Phase 4b, after the
   code move. The contract is written up in `SESSION_CONTRACT.md`. (An earlier
   note here said both are Python on the strength of `alembic_version`; the
   `app_roles` migration cites `.ts` files in both projects, so the stack is
   still unconfirmed and settles whether they import `packages/identity` or
   implement the contract.)
4. `users_pump` becomes a profile row rather than an account table.

#### Why the remap is off, measured 12 Oct 2026

Only **four declared foreign keys** point at `users` / `users_pump`. Eighteen
further uuid columns reference a user with **no constraint at all** —
`audit_log.user_id`, `quotation.created_by`, `step_approval.decided_by`,
`page_views.user_id` and the rest. Nothing in the database would stop a remap
from silently orphaning those rows.

And there is a trap in the data. **One uuid exists in both tables and means a
different person in each**: `26651a64-b123-41b2-93d3-6d5cde7011a6` is
`shambhavi.tiwari@` in Testing's `users` and `admin@` in Pump Selection's
`users_pump`. Over 2,300 rows carry it. Resolved by value alone it conflates a
Testing admin with the Pump Selection system account; resolved by which table
the column belongs to it is unambiguous, and the audit confirms **every one of
the 22 referencing columns resolves cleanly against exactly one table**.

So the answer is the one sales already took: keep the local key, add a pointer.
`identity_user_id` is what disambiguates the two from here on. Nothing moves.

Two incidental findings worth passing on: `audit_log` (singular) is Pump
Selection's log and `audit_logs` (plural) is Testing's — a genuinely dangerous
pair of names — and `audit_log` holds **39 rows pointing at a user that no
longer exists**, which predates all of this.

**Blocked on**: the conversation with the Testing / Pump Selection developers,
which also covers retiring `admin@` there.

### Phase 5 — SO-to-Dispatch, and paying off the couplings.

**Handed to that portal's own developer, 12 Oct 2026.**
`Phase5-SO-to-Dispatch-Handover.docx` at the repo root is the brief: the
architecture, his seven steps, the session contract, the variable names, the
gotchas and the test plan. He has the GitHub invite and no Vercel access,
which is deliberate — every deployment and every secret stays with Farhan.

**Two roles were missing from the hub, fixed before the seed rather than
during it** (`0005_so2dispatch_missing_roles.sql`). 0002 took that portal's
roles from its `REQUESTABLE_ROLES` list, but its `users` table holds thirteen:
`rep` (15 people) and `order_making_so` (1) are assigned, not requested, so
they never appeared on the request form. The composite foreign key on
(app_slug, app_role) would have made all sixteen unapprovable.

`rep` is a sales role, not a department — all fifteen holders carry their own
name in `users.rep_name` and all fifteen are a rep, manager or admin in the
Sales Portal. `order_making_so` is held by one functional mailbox,
`makerso@`; how it differs from `order_making` is unknown here and its
description says so rather than guessing, because an invented description on
an approval form is how the wrong access gets granted.

**One more difference to carry into the work:** `ec_to_dispatch.users` has its
unique index on `lower(email)`, not on `email`, unlike the other two portals.
Auto-provisioning has to target `lower(email)` in its `ON CONFLICT` or it
fails for the first person who ever arrives that way.

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
