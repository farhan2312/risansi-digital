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
4. **Password merge: force a reset.** Nobody's existing password carries over. `must_change_password` already exists in all four portals and is already enforced.
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

### Phase 2 — The hub becomes an application.
- `apps/hub`: Next app, hub's own domain. Port the static page in as the signed-in landing view.
- `packages/identity`: token format, cookie, `verifySession()`.
- Build `identity.users`, `identity.apps`, `identity.app_grants`, the request and approve screens, and password set/reset. The hub becomes the only place a password is ever set.
- No portal is touched. Every existing login still works.
- Done when: someone can sign up at the hub, see the tiles, request sales access, and the approver can approve it — with the grant having no effect yet.

### Phase 3 — Sales cutover. The only hard one.
Rehearse against a restored copy of the sales database first (§2.2).

- Seed `identity.users` from sales `users`; add `users.identity_user_id`.
- Rewrite `lib/risansi-auth.ts` to resolve `CurrentUser` from shared session + grant + profile. Keep the shape. The 48 FKs are not touched.
- `proxy.ts` checks the sales grant instead of `users.status`. The check is already centralised there and `proxy-coverage-check.mjs` already asserts all 91 routes sit behind it — one place to change, with a gate proving nothing escaped.
- An unauthenticated hit on `sales.risansi.com` redirects to the hub. The portal's own sign-in page is retired.
- Credential columns stay on `users`, unread, for one release. Dropping them is a later migration.
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

- **Email overlap is unmeasured.** The merge is by email and nobody has counted how many people exist in more than one portal, or whether the same person used different addresses. One query per database answers it; do it before Phase 3 is scheduled, because it sets the size of the forced-reset announcement.
- **`users_pump` has already drifted** from `users`. Expect more differences in the data than in the schema.
- **The cookie is domain-wide.** `.risansi.com` is readable by every subdomain, now and in future. Consequence of decision 2.3, not a defect, but it constrains what may ever be hosted on a `risansi.com` subdomain.
- **Sales-first means no rehearsal of the pattern.** Mitigated by rehearsing Phase 3 against a restored database.
- **Nothing shipped recently has been opened in a browser.** Unrelated to this plan, but the same gap: sales is sign-in gated and recent verification has been by build gate rather than by eye.

## 7. What I have not done

No repo has been changed. Phase 1 is a destructive, outward-facing operation — it repoints a live Vercel deployment — so it waits for an explicit go.

Independent of all of this, the orphan `.claude/impeccable-main` gitlink breaks `git submodule update` on a fresh clone today. I can remove that on its own whenever you want.
