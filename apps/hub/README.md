# apps/hub — Risansi Digital

The gateway. One sign-in, the portal grid, and the access-request flow.
Phase 2 of [`MIGRATION_PLAN.md`](../../MIGRATION_PLAN.md).

```bash
npm install
cp .env.example .env.local     # fill it in; .env.example says what each one does
npm run dev                    # http://localhost:3100
```

## Deploying

Its own Vercel project, separate from `apps/sales`, so a bad deploy here cannot
take the sales portal down.

- **Root Directory:** `apps/hub`
- **Framework Preset:** **Next.js**, explicitly.

That second line is not decoration. A project created against the repository
root sees no `package.json` there, settles on "Other", and keeps that preset
after the Root Directory is corrected. The build then fails before it starts
with:

```
Error: The pattern "app/**" defined in `functions` doesn't match any
Serverless Functions inside the `api` directory.
```

which reads like a problem with `vercel.json` and is not one — it is Vercel
looking for a plain `api/` folder because it does not believe this is a
Next.js app.

### No `functions` block, on purpose

`vercel.json` here carries only `crons`. Execution limits live in the routes
themselves:

```ts
export const maxDuration = 60   // app/api/cron/pending-requests/route.ts
```

That is the framework's own mechanism — platforms read it out of the Next
build output — so it keeps working whatever Vercel decides about presets, and
it sits next to the code it governs. `apps/sales` still configures this
through `vercel.json`; it works there and is not worth churning, but this is
the better spelling for anything new.

### The cron

`0 2 * * *` — 02:00 UTC, 07:30 IST. Deliberately half an hour before the sales
crons at 02:30 UTC so the two do not land together. **Vercel cron expressions
are always UTC**, never the project's timezone.

It needs `CRON_SECRET` set in **every** environment including Preview, or the
scheduled invocation gets a 401. Unset, the route is open outside production
only, so it can be triggered by hand locally; in production a missing secret
fails closed.

## Two things that will waste an afternoon

**`RISANSI_COOKIE_DOMAIN` needs its leading dot** — `.risansi.com`. Without
it the cookie is scoped to this host alone and no portal will see the session
when Phase 3 lands.

**Leave it empty on previews.** A cookie scoped to `.risansi.com` is never
sent to a `vercel.app` address, so a preview deployment looks completely
broken — signed in, then immediately signed out — for a reason that has
nothing to do with the code.

## Layout

```
app/            routes. Every one is dynamic: each reads the session cookie
                before it queries, so `next build` opens no connection.
  actions/      server actions — auth.ts, grants.ts
  api/cron/     the daily backlog sweep
components/     the grid, the tiles, the forms, the header
lib/
  viewer.ts     the gate. getViewer / requireViewer / requireApprover.
                Re-reads the user row per request, wrapped in React cache(),
                which is what makes a revoke land on somebody's next click.
  db.ts         the identity pool
  roles.ts      which roles to mark as heaviest in the approval dropdown
```

Shared code lives outside: [`@risansi/identity`](../../packages/identity) for
the session, the password rules and the grant queries;
[`@risansi/notify`](../../packages/notify) for email. Both arrive as `file:`
dependencies and are compiled in place through `transpilePackages`.
