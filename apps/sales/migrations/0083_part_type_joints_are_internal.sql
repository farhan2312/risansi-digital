-- 0083: Universal Joint and Eccentric Joint leave the Part type list.
--
-- They are the same thing and both count as an Internal part (19 Sep). No
-- complaint carries either value, so nothing has to be re-pointed; the rows
-- are deactivated rather than deleted, so an old record that ever did carry
-- one still resolves its label.

UPDATE complaint_lookups
   SET is_active = FALSE
 WHERE kind = 'part_type' AND value IN ('Universal Joint', 'Eccentric Joint');

-- Anything that did carry one is an Internal part.
UPDATE complaints SET part_type = 'Internal'
 WHERE part_type IN ('Universal Joint', 'Eccentric Joint');
