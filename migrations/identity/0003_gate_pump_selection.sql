-- 0003  Pump Selection needs a grant after all.
--
-- 0001 seeded it with `needs_grant = false`, reasoning that a calculator has
-- no customer data behind it and a request step would protect nothing. That
-- was my call, not the business's, and it was wrong on both counts.
--
-- It is not only a calculator. The same portal builds commercial offers and
-- holds quotations — `quotation.tsm_rep_id`, `quotation_version`, the pricing
-- masters — which is pricing, not arithmetic. And "nothing to protect" is a
-- judgement about the company's commercial information that belongs to the
-- people whose information it is.
--
-- Decided 10 Oct 2026: every application is gated. The point of one front door
-- is that the answer to "who can open this" is the same shape everywhere, and
-- an exception on the grid invites the next one.
--
-- Applied to the live database by hand first; this migration exists so a fresh
-- environment comes up the same way rather than reverting to 0001's seed. The
-- five roles this portal offers are already in identity.app_roles from 0002,
-- so the approval dropdown works with no further change.

UPDATE identity.apps
   SET needs_grant = true
 WHERE slug = 'select' AND needs_grant = false;

-- Nobody held an implicit entitlement to convert: before this, Pump Selection
-- needed no grant, so there is nothing to backfill. Anybody who wants it now
-- asks, like every other portal. Stated rather than assumed, because the
-- opposite case — a flag flipped on an application people were already using —
-- would silently lock out everyone who had it.
