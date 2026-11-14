# Order in Hand, and a second revenue figure, on the Opportunities page

Written 15 Nov 2026. Nothing in here has been built yet; this is the plan to approve.

## What we are adding

Two blocks on the Opportunities flow row, both read live from the **`ec_to_dispatch`**
database (the SO-to-dispatch portal), neither of which the sales portal can answer today:

| Block | Means | Today, company-wide |
|---|---|---|
| **Order in Hand** | SO value raised and not yet dispatched | **₹9.36 Cr** across 253 SOs |
| **Invoiced (SO portal)** | Invoices actually raised in the SO portal, this FY | **₹6.84 Cr** across 359 invoices |

The existing **Revenue** block stays exactly as it is — `client_revenue_monthly`, the
monthly upload — so the row carries two revenue-shaped figures from two different
systems, which is the point.

The row becomes:

```
Quoted → In Negotiation → Won (awaiting SO) → Won (SO created) → Order in Hand   |   Revenue   Invoiced
```

Arrows join the pipeline stages. The last two are separated by a hairline, not an
arrow: they are not the next step of the same flow, they are what actually happened.

## Decisions taken

1. **Order in Hand = every SO not marked `Fully dispatch`, at its full SO value.** An SO
   that is nine-tenths shipped still counts for all of it. Simple to say out loud, and
   it matches how the dispatch team reads their own board. (The alternative — SO value
   less what has been invoiced against it — would read ₹9.79 Cr.)
2. **Cancelled by client and Diverted are excluded.** Hold is **included**: it is an
   order we owe, whatever is blocking it. 87 SOs, ₹1.73 Cr of the ₹9.36 Cr.
3. **The Invoiced block is shown with what it covers written under it**, because it is
   not comparable with Revenue and will be read as a contradiction otherwise. See
   "The honest caveat" below.
4. **Both blocks move with the page's rep / industry / client-type / client-status
   filters**, and are always scoped to the accounts the reader is allowed to see.
   They ignore the opportunity-level filters (stage, quote date, enquiry date), which
   have no meaning for an SO — exactly as the existing Revenue block already behaves.

## Why a second connection pool, and not a join

`risansi` and `ec_to_dispatch` are different databases on the same server. Postgres
cannot join across them without `postgres_fdw` or `dblink`, both of which mean an
extension and a schema change on production for one KPI. So:

1. In `risansi`, work out the set of **client codes** this reader may see, after the
   page's filters.
2. In `ec_to_dispatch`, sum against that list of codes.

The join key is already good: **398 of the 399 client codes in `ec_to_dispatch` match
`clients.code` in the portal** (708 of 709 orders; the odd one out is `BANG01V125`).

`apps/so2dispatch/lib/db-identity.ts` is the precedent for a second pool onto another
database on the same server — same lazy construction, same global cache, same
"a missing variable throws rather than defaulting".

## Files

### 1. `lib/db-ec.ts` — new

A second pool onto `ec_to_dispatch`, modelled on `apps/so2dispatch/lib/db-identity.ts`:

- built on first query, never at import, so `next build` does not need credentials;
- cached on `globalThis` so hot reload does not leak connections;
- `max: 5`. The sales pool is 15 and four portals share this server;
- **`options: '-c default_transaction_read_only=on'`** — every connection this app
  opens to that database is read-only at the server. The sales portal can never write
  to the dispatch portal's data, whatever anybody adds to this file later;
- host, port, user and password reuse the existing `DB_HOST` / `DB_PORT` / `DB_USER` /
  `DB_PASSWORD`; the database name comes from a new `EC_DB_NAME`.

### 2. `lib/risansi-order-in-hand.ts` — new, `server-only`

Three exported functions and the shared SQL fragments. No React, no page concerns.

```ts
/**
 * The value of an SO in rupees, whatever currency it was taken in.
 *
 * order_value_inr is populated on 20 rows out of 709 — only the USD orders. For
 * the 675 INR orders the figure is in order_value. sum(order_value_inr) reads
 * ₹1.46 Cr and looks like a rounding error; sum(order_value) adds rupees to
 * dollars. This is the only correct form, and it belongs in one place.
 */
const SO_INR = `CASE WHEN o.order_currency = 'INR' OR o.order_currency IS NULL
                     THEN o.order_value ELSE o.order_value_inr END`;

/** Two SOs exist for testing. They carry no value but one holds 234,324 pumps. */
const NOT_A_TEST = `COALESCE(o.so_no, '') NOT ILIKE '%TEST%'`;
```

**(a) The codes this reader may count.** Runs on `risansiPool`, built from the page's
own `revConds` / `revVals` — the same client-level filter clause the Revenue block
already uses, so the two cannot drift apart:

```sql
SELECT DISTINCT UPPER(TRIM(c.code)) AS code
  FROM clients c
 WHERE c.deleted_at IS NULL
   AND c.code IS NOT NULL AND c.code <> ''
   /* ${revFilterClause} — rep, industry, client type, client status, and the
      per-user owner visibility, exactly as the Revenue block has them */
```

**(b) Order in Hand.** Runs on the ec pool:

```sql
SELECT COALESCE(SUM(CASE WHEN o.order_currency = 'INR' OR o.order_currency IS NULL
                         THEN o.order_value ELSE o.order_value_inr END), 0)::text AS inr,
       COUNT(*)::int AS orders
  FROM orders o
 WHERE COALESCE(o.dispatch_status, '') NOT IN ('Fully dispatch', 'Cancelled by client', 'Diverted')
   AND COALESCE(o.so_no, '') NOT ILIKE '%TEST%'
   AND UPPER(TRIM(o.client_code)) = ANY($1::text[])
```

Eleven SOs carry no `dispatch_status` at all (₹0.03 Cr). They are counted as in hand:
an SO nobody has marked dispatched has not been dispatched.

**(c) Invoiced, this financial year.** Runs on the ec pool:

```sql
SELECT COALESCE(SUM(i.invoice_value), 0)::text AS inr,
       COUNT(*)::int AS invoices
  FROM order_invoices i
  JOIN orders o ON o.id = i.order_id
 WHERE i.invoice_date >= $2 AND i.invoice_date < $3
   AND COALESCE(o.so_no, '') NOT ILIKE '%TEST%'
   AND UPPER(TRIM(o.client_code)) = ANY($1::text[])
```

`$2` / `$3` are the page's existing `cyStart` / `cyEnd`. Invoices against cancelled or
diverted SOs are **included** — the money was billed, whatever happened to the order
afterwards. 74 invoice rows have no `invoice_date` and no value; the date range drops
them, which is the right answer and worth knowing.

`invoice_value` is ex-GST: across the 410 fully dispatched SOs it comes to 1.019× the
SO value, the 1.9% being freight and other charges on some invoices. So it is
comparable with the monthly upload, and with `order_value`.

### 3. `app/risansi/pipeline/page.tsx` — two entries in the existing `Promise.all`

Both wrapped so a failure is **not** a zero:

```ts
q<OrderInHand | null>(() => orderInHand(revFilterClause, revVals), null),
q<Invoiced  | null>(() => invoicedThisFy(revFilterClause, revVals, cyStart, cyEnd), null),
```

The page's `q()` helper already swallows an error into a fallback. The fallback here is
`null`, not `0`, because "the dispatch portal did not answer" and "there are no open
orders" are different facts and a card that cannot tell them apart is worse than no
card.

### 4. `ForecastBlock` — accept `value: number | null`

One change: `null` renders an em dash and the sub-line becomes "not available just now"
instead of `₹0.0 Cr`. Every existing call site passes a number and is unaffected.

### 5. Labels

The existing block is labelled **"Revenue (Invoiced)"**, which will be unreadable next
to a block called Invoiced. Proposed:

| Now | After | Sub-line |
|---|---|---|
| Revenue (Invoiced) | **Revenue** | `monthly upload · FY 26-27` |
| — | **Invoiced (SO portal)** | `raised in the SO portal · from Sept 2026` |
| — | **Order in Hand** | `253 SOs raised, not yet dispatched` |

Each of the three gets a `title` naming its source table in plain words, because the row
will now carry three SO-shaped numbers from three different systems: "Won (SO created)"
from the opportunity's own PO field, "Order in Hand" from the dispatch portal, and the
portal's own `orders` import behind Reports.

## The honest caveat, and where it goes

The SO portal has only been carrying invoices in earnest since September:

| Month | Invoiced (SO portal) | Revenue (monthly upload) |
|---|---|---|
| Apr 2026 | ₹0.04 Cr | ₹0.79 Cr |
| May | — | ₹2.08 Cr |
| Jun | — | ₹2.27 Cr |
| Jul | — | ₹3.14 Cr |
| Aug | ₹0.17 Cr | ₹4.56 Cr |
| Sep | ₹2.13 Cr | ₹3.89 Cr |
| Oct | ₹3.66 Cr | ₹3.34 Cr |
| Nov (to date) | ₹0.85 Cr | not uploaded yet |

FY-to-date that is **₹6.84 Cr against ₹20.07 Cr**. October is the first month the two
are close, and the SO portal is actually *higher* that month — either the October upload
is partial or some invoices carry charges the upload does not. Either way:

- the Invoiced block's sub-line names the start date, so nobody reads the gap as a loss;
- `title` on the block says in one sentence that it counts only invoices raised in the
  SO portal and is not a replacement for the monthly upload.

This is the one part of the change that can mislead a reader, so it is the part that
gets the most words on screen.

## Deployment

**`EC_DB_NAME=ec_to_dispatch` has to be added to the sales project's environment in
Vercel** before this ships, or the blocks render as "not available". Same host, same
user, same password as the existing variables.

## Verification

1. `scripts/ec-order-check.mjs` — a script, **not** a build guard, since the build must
   not need database credentials. It asserts the columns this feature reads still exist
   and still mean what they meant (`orders.dispatch_status` has only the seven values we
   know, `order_value_inr` is still populated only for non-INR rows), and prints the two
   figures. Run it after any change to the dispatch portal's schema.
2. The two figures checked against a hand-run SQL on the same day.
3. A rep's view checked against an admin's: the rep's Order in Hand must be a subset.
4. The row at 1100px, 1400px and on a phone — seven blocks will not fit the current
   `1fr auto 1fr auto 1fr auto 1fr auto 1fr` grid and it needs to wrap rather than
   squeeze.

## Deliberately not in this change

- **Reports.** Its `orders` dataset is still the Excel import, which stops dead on
  30 June 2026 — four and a half months stale. Pointing it at `ec_to_dispatch` is a
  bigger piece of work, because the report engine builds one SQL statement against one
  database, and it would need either a sync table in `risansi` or `postgres_fdw`. Worth
  doing next; not worth holding this KPI for.
- **Reconciling the two order books.** The portal's import and the dispatch portal share
  only 83 SO numbers, of which 66 agree to the rupee and 17 do not. 447 SOs exist only in
  the portal (₹9.64 Cr, all on or before 30 June) and 615 only in the dispatch portal
  (₹11.88 Cr). Neither is the order book on its own. That is a data exercise, not a
  code one, and it needs somebody to say which system is right where they disagree.
