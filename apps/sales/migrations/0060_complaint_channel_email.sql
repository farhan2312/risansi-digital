-- Complaints: "Mail" folds into "Email".
--
-- The channel dropdown offered Verbal / Email / Mail, and nobody could tell the
-- last two apart at a glance. Six complaints were recorded as Mail; all of them
-- arrived by e-mail in practice, so they become Email rather than being left as
-- a third category nobody can interpret later.
--
-- A CHECK constraint follows, because the same drift that put twelve values in
-- clients.client_type would eventually put Mail back here through an import.
-- Postal complaints are rare enough to be recorded as Verbal with a note.

UPDATE complaints SET channel = 'Email'
 WHERE btrim(lower(channel)) = 'mail';

UPDATE complaints SET channel = btrim(channel)
 WHERE channel IS NOT NULL AND channel <> btrim(channel);

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_channel_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_channel_check CHECK (
  channel IS NULL OR channel IN ('Verbal', 'Email')
);
