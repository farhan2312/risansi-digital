# The Risansi Digital session contract

What a portal has to do to accept a Risansi Digital sign-in. Written so it can
be implemented from this page alone, in any language, without reading
`packages/identity` — because one of the four portals may not be able to
import it.

If you *are* on Node, do not implement any of this. Import
`@risansi/identity` and use `readToken()`. Two implementations of a session
format drift, and the one that drifts is the one nobody is looking at.

Companion to `MIGRATION_PLAN.md`. The sales portal already works this way and
is the reference implementation: `apps/sales/lib/risansi-shared-session.ts`
and `apps/sales/proxy.ts`.

---

## 1. The cookie

| | |
|---|---|
| Name | `risansi_session` |
| Domain | `.risansi.com` |
| Path | `/` |
| `HttpOnly` | yes |
| `Secure` | yes in production; off on a plain-http localhost or the browser drops it |
| `SameSite` | `Lax` |
| Max-Age | `28800` (8 hours) |

**`Lax`, not `Strict`.** Arriving at a portal by following a link out of the
hub is a cross-site navigation, and `Strict` withholds the cookie on exactly
the journey this whole system is built around. `Lax` still withholds it from
cross-site POSTs, which is the case that matters.

**The domain scope has a cost worth knowing.** Every subdomain of
`risansi.com` can read this cookie, now and in future. Nothing untrusted may
ever be hosted on one.

Your portal **never sets or refreshes this cookie**. The hub issues it and the
hub clears it. You only read it.

## 2. The token

A JWT, `HS256`, signed with the shared secret in `RISANSI_SESSION_SECRET`.
Every portal verifies with the same string — the same string, not an
equivalent one.

```
header   { "alg": "HS256", "typ": "JWT" }
payload  {
           "sub":   "<identity.users.id, a uuid>",
           "email": "someone@risansi.com",
           "name":  "Someone Real",
           "mcp":   false,
           "iat":   <seconds>,
           "exp":   <seconds>,
           "iss":   "risansi-digital"
         }
```

`mcp` is `must change password`: the person is holding a password that was
issued to them rather than chosen.

### Verifying

1. Read the `risansi_session` cookie. No cookie → not signed in.
2. Verify the signature with `RISANSI_SESSION_SECRET`.
3. **Require `iss` to equal `risansi-digital`.** Not optional. Without it any
   HS256 token signed with a leaked or shared secret is accepted.
4. Reject if `sub` is missing or `email` is not a string.
5. Expiry is enforced by `exp`; any standard JWT library checks it for you.

Anything that fails is "not signed in", not an error. No cookie, an expired
one, a wrong secret and a tampered one are the same answer to the only
question being asked.

**One thing that must not fail quietly.** A *missing* secret is a deployment
fault, not a signed-out user. Throw on it. If it reads as "nobody is signed
in", a bad deploy looks like everyone being logged out and somebody will spend
an afternoon on the wrong problem.

### The secret has no default

`packages/identity` deliberately throws when `RISANSI_SESSION_SECRET` is
missing or under 32 characters. The sales portal's old NextAuth config carried
`?? 'risansi-dev-secret-2026'`, which meant a deploy that forgot the variable
still booted and signed tokens with a secret that is in the public repository.
Every portal shares this secret now, so the same slip would hand out valid
sessions for all four. Fail at the first request instead.

## 3. What the token does not carry

**No roles. No grants.** Deliberately.

The token says who you are. What you may open, and as what, is read from the
database on the request that needs it. That is what makes revoking somebody
land on their next click rather than whenever an eight-hour token happens to
expire. Baking grants into the token would save a query and leave a revoked
person working for the rest of the day.

Keep the property. It is the main thing this design buys.

## 4. The grant check

Per request, against `risansi_identity`:

```sql
SELECT g.status, g.app_role
  FROM identity.app_grants g
 WHERE g.user_id  = $1          -- the token's `sub`
   AND g.app_slug = $2          -- 'testing', 'select', 'sales', 'so2dispatch'
```

Also confirm the person is still live:

```sql
SELECT is_active FROM identity.users WHERE id = $1
```

Open the portal only when `is_active` **and** `status = 'Approved'`. Anything
else — `Pending`, `Rejected`, `Revoked`, no row at all — is refused, and the
right place to send them is the hub, where their access is visible and where
a request to restore it is made.

`app_role` is your portal's own role string, from `identity.app_roles`. The
vocabularies do not overlap between portals and are not meant to:

| app_slug | roles |
|---|---|
| `sales` | `rep`, `manager`, `staff`, `admin`, `sysadmin` |
| `testing` | `source`, `testing`, `central-admin`, `admin`, `user` |
| `select` | `user`, `selection_head`, `pulley_owner`, `admin`, `system_admin` |
| `so2dispatch` | eleven, one per department |

A composite foreign key on `(app_slug, app_role)` makes a role that does not
exist impossible to store, so you can trust the value — but note the FK is
`MATCH SIMPLE`, so a **null** role satisfies it. An Approved grant with a null
role should be treated as a fault, not as a default.

### Where to put the check

Not only in middleware. The sales portal learned this the hard way: its proxy
checked a role baked into a cookie that was never refreshed, so a deactivated
account rendered a portal full of zeros instead of being refused. Middleware
is a cheap outer door that turns away the obvious case without a round trip.
The authoritative check belongs where the request is actually served, on a
value read in that same request.

## 5. Signing in and out

**In.** Your portal has no sign-in page. An unauthenticated request redirects
to `https://digital.risansi.com/sign-in?next=<absolute URL they asked for>`,
URL-encoded. The hub validates `next` and sends them back to it afterwards, so
a link to one record out of a notification email lands on that record and not
on your home page.

Do not validate `next` yourself and do not strip it. The hub checks every
destination it is handed against `*.risansi.com`; two checks in two codebases
drift apart, and on a login page an unchecked destination is a phishing hop.

**Out.** Clear `risansi_session` with **matching attributes** — same domain,
same path — or the browser writes a second cookie instead of replacing the
first and the person stays signed in. Then redirect to the hub. Your portal
is a subdomain of `.risansi.com`, so it can clear the cookie itself; no
cross-origin round trip is needed.

**Make sign-out a POST**, with an Origin check. A URL that signs you out can be
fired by anything that can make a browser issue a request, an `<img>` in an
email included.

### The one that will catch you

If your portal sends a `Content-Security-Policy` with `form-action`, it must
name the hub:

```
form-action 'self' https://digital.risansi.com
```

A browser enforces `form-action` across the **whole redirect chain** of a form
submission, not just its first hop. Sign-out posts to your portal and ends at
the hub, so with `'self'` alone the browser blocks the redirect before it
leaves — and it surfaces as a generic server error on the page the button was
clicked from, with nothing in your logs. This cost most of a day on sales.

## 6. Two traps specific to Testing and Pump Selection

**One uuid means two different people.**
`26651a64-b123-41b2-93d3-6d5cde7011a6` is `shambhavi.tiwari@risansi.com` in
Testing's `users` and `admin@risansi.com` in Pump Selection's `users_pump`.
Over 2,300 rows carry it. Resolved by value alone it conflates a Testing admin
with the Pump Selection system account; resolved by *which table the column
belongs to* it is unambiguous, and all 22 referencing columns do resolve
cleanly against exactly one table. Never look a user id up in both tables and
take whichever hits.

**`audit_log` is Pump Selection's. `audit_logs` is Testing's.** Both live in
the same database, one letter apart. `audit_log` also holds 39 rows pointing
at a user that no longer exists, which predates all of this work.

## 7. Do not remap your uuids

The plan originally had identity adopt the Testing uuids. That is not
available: every person in both `users` and `users_pump` carries a different
uuid in each, so there was never one id to adopt.

Keep your own primary key and add a pointer — `identity_user_id`, from
`migrations/testing-select/0001_identity_user_id.sql`, filled by
`scripts/link-testing-select-identity.mjs`. This matters more here than it did
for sales: only **four** declared foreign keys point at those two tables, while
eighteen further uuid columns reference a user with no constraint at all, so
nothing in the database would stop a remap from silently orphaning rows.

Sales did the same thing, keeping its integer `users.id` and all 48 foreign
keys untouched. That is the whole reason identity was given its own uuid key
rather than everyone adopting one.

## 8. Checklist

- [ ] Reads `risansi_session`, verifies HS256 and `iss`, throws on a missing secret
- [ ] Resolves the grant per request, not from the token
- [ ] Refuses `Pending` / `Rejected` / `Revoked` / missing, and a null `app_role`
- [ ] Authoritative check where the request is served, not only in middleware
- [ ] Unauthenticated → hub `/sign-in?next=<absolute>`, `next` passed on unvalidated
- [ ] Sign-out is a POST, clears with matching attributes, redirects to the hub
- [ ] `form-action` names the hub if a CSP is sent
- [ ] Own sign-in page and password form removed
- [ ] `identity_user_id` populated; no uuid remapped
