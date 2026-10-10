-- Placeholder serials, cleared.
--
-- The unique index uq_client_pumps_serial covers every non-empty pump_sl_no,
-- so a rep who filled the serial box with "-" made a value that the next "-"
-- collided with: the second pump silently replaced the first, and the next
-- batch replaced that one. West Valley Sugar Mill's order of two came out as a
-- single row on 25 Sep.
--
-- The application now reads a placeholder as an empty box (textOrNull in
-- app/actions/risansi-pumps.ts). These three rows predate that and would still
-- collide with anything entered against them, so they are cleared too. NULL is
-- outside the partial index, which is what lets unnumbered pumps sit together.
--
-- Only the serial is touched. Nothing is deleted, and a pump lost to the old
-- collision is not invented back — the rep re-enters it.

UPDATE client_pumps
   SET pump_sl_no = NULL
 WHERE pump_sl_no IS NOT NULL
   AND btrim(pump_sl_no) ~* '^(?:[-._/?*]+|n\.?\s*a\.?|n/a|nil|none|null|nan|tbd|unknown)$';
