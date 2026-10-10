# Opportunity de-duplication — proposal for approval

**Status: PROPOSAL. Nothing has been changed.** Prepared 2026-08-10.

## 1. What the problem is

Two separate data loads both created rows in the same Opportunities table:

| Source | Rows | What it describes | What it carries |
|---|---|---|---|
| Order-in-hand register (June 2026) | 530 | Orders we have booked | SO number, order value, dispatch status |
| Quote list FY 26-27 | 1,051 | Quotations we issued | Quote ref, quote date, market, location, RIL rep, pump model, quarter |

A deal that was quoted **and then won** exists in both, so it appears twice in the
Opportunities report: once as a full opportunity record, and once as a bare row with
only a value, an SO number and a dispatch status. Neither row is wrong on its own —
they are two views of the same deal, loaded from two spreadsheets.

Business impact today: the Won count and Won value are overstated, and reps see the
same order twice when they filter the pipeline.

## 2. How many duplicates

| Tier | Pairs | How they were identified | Confidence |
|---|---|---|---|
| **A — confirmed** | **35** | Same client, and the order value matches the quote **to the rupee** | **Very high** |
| **B — high confidence** | **70** | Same client, same product category, quote dated before the order, and the order booked at a clean discount off the quote (85%, 75%, 90%…) | High — recommend a spot-check before running |
| C — statistically implied | ~55 | The totals imply this many more exist, but they cannot be pinned to a specific pair | Not actionable — excluded from this plan |
| — not duplicates | 495 | Order-in-hand rows with no matching quote | Leave untouched |

**This plan covers Tiers A and B: 105 pairs.**

### Why Tier A is trusted

Every one of the 35 was tested against two signals that were not used to find them:

- **Timing** — all 35 have the quote dated *before* the order (1 to 101 days, typically
  a week). In a control group of same-value pairs belonging to *different* customers,
  only 59% ran in that direction.
- **Product type** — all 35 match spares-to-spares and pumps-to-pumps, with no
  crossovers. The same control group mismatched 35% of the time.
- **Three are already proven** — a colleague had manually recorded the sales order
  against the quote row for SO26/1/520, SO26/1/637 and SO26/1/761. Those three are the
  same deal by sales-order number, not by value at all.

The chance of the set arising by coincidence is negligible (72x above the base rate).

### Why Tier B needs a spot-check

Tier B relies on the observation that orders are usually booked at a round discount off
the quoted price. That pattern appears in 50% of plausible pairs against a 6% background
rate, so it is a real signal — but it is inference, not an exact match. **We recommend
the sales team eyeball a sample before approval.**

## 3. Which record survives

**The quote row survives. The order-in-hand row is removed.**

The two are almost perfectly complementary. Across the 35 confirmed pairs:

| Held only by the quote row | Held only by the order-in-hand row |
|---|---|
| Quote reference (35/35), quote date (35/35) | Sales-order number |
| Market (35), quarter (33), RIL rep (32), location (31) | Dispatch status (pending / dispatched) |
| Project/unit (16), quotation PDF (13) | Confirmed order value |
| Pump model, quantity, enquiry number | |

Keeping the quote row and carrying over the three order-only fields loses nothing.
This is also the pattern a colleague already used by hand on three of these deals.

## 4. What happens to each pair

For every pair, in one transaction:

1. **Move the order record** — the order register row is re-pointed from the
   order-in-hand row to the surviving quote row. *(Required: the database blocks
   deletion while an order still points at the row.)*
2. **Move the sales order** — the SO row is re-pointed to the surviving row, so the
   SO number, value and date stay attached to the deal.
3. **Carry over the order value** — the surviving row's *final value* is set to the
   confirmed order value. Its *quoted value* stays as quoted, so we keep both the
   quote and what it actually sold for.
4. **Carry over the dispatch status** — appended to the surviving row's notes.
5. **Archive, then remove** — the order-in-hand row is copied into a backup table and
   then deleted.

Nothing is written to the customer PO field: an SO is ours, a PO is theirs. (A separate
fix already moved 532 mis-filed SO numbers out of that field.)

## 5. Effect on the numbers

| Measure | Before | After (Tier A only) | After (A + B) |
|---|---|---|---|
| Opportunity rows | 1,731 | 1,696 | 1,626 |
| Won count | 907 | 872 | 802 |
| Won value | ₹26.43 Cr | ₹25.35 Cr | ~₹24.4 Cr |
| Order in Hand | ₹9.79 Cr | unchanged in substance | unchanged in substance |

The reduction is the double-count being removed, not business being lost. Every SO
number and every rupee of genuine order value is retained on the surviving record.

## 6. Safety

- **One transaction per batch** — it either completes fully or changes nothing.
- **Full archive** — every deleted row is copied to `opportunities_merge_archive`
  first, with the id of the row it was merged into, so any pair can be restored.
- **Reversible** — a documented rollback restores the archived rows and re-points the
  order and sales-order records back.
- **Tiers run separately** — Tier A first, verified, then Tier B after sign-off.
- **Dry run first** — the whole migration is executed against production inside a
  rolled-back transaction and the before/after counts reported, before anything is
  committed.

## 7. Approval steps

1. Sales team spot-checks a sample of Tier B pairs (a review sheet listing both sides
   of all 105 pairs will be provided as an Excel file).
2. Approve Tier A.
3. Run Tier A, verify the counts, and review for a day.
4. Approve and run Tier B.

## 8. Not included

- The ~55 Tier C duplicates that cannot be individually identified.
- 18 same-value pairs belonging to *different* customers — checked and confirmed as
  coincidence, **not** duplicates. Two are worth a look as possible duplicate client
  codes (`NIZA01G003` / `NIZA01G004`, `BALR01B019` / `BALR01B044`).
- The 10 "within 2%" pairs from the earlier draft: testing showed at least 4 fail the
  timing or product-type check, so value-tolerance matching has been dropped.
