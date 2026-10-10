-- More than one person is met at a stand.
--
-- exhibition_meetings carries contact_person, designation, phone and email —
-- one of each. A stand meeting is normally two or three people: the engineer
-- who asked the question, the manager who decides, whoever handed over the
-- card. The second and third were being written into the discussion notes, or
-- lost.
--
-- So the contacts move to their own rows. The four columns stay where they
-- are, holding what they already hold, because the convert-to-lead action and
-- the exhibition export both read them and a complaint about losing data is a
-- worse outcome than a duplicated column for a while. New writes go to this
-- table; the old columns are kept in step with the FIRST contact so that
-- anything still reading them keeps seeing the person who would have been
-- there before.

CREATE TABLE IF NOT EXISTS exhibition_meeting_contacts (
  id          serial PRIMARY KEY,
  meeting_id  integer NOT NULL REFERENCES exhibition_meetings(id) ON DELETE CASCADE,
  -- The order they were entered in. The first is the one the old columns
  -- mirror and the one a lead's primary contact is made from.
  sort_order  integer NOT NULL DEFAULT 0,
  name        text NOT NULL,
  designation text,
  phone       text,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exhibition_meeting_contacts_meeting_idx
  ON exhibition_meeting_contacts (meeting_id, sort_order, id);

COMMENT ON TABLE exhibition_meeting_contacts IS
  'Everybody met at one exhibition meeting. Row 0 mirrors the contact_person / designation / phone / email columns still on exhibition_meetings.';

-- Carry the single contact already recorded across, so the new control opens
-- showing what the meeting already says rather than an empty first row.
INSERT INTO exhibition_meeting_contacts (meeting_id, sort_order, name, designation, phone, email, created_at)
SELECT m.id, 0, btrim(m.contact_person), m.designation, m.phone, m.email, COALESCE(m.created_at, now())
  FROM exhibition_meetings m
 WHERE COALESCE(btrim(m.contact_person), '') <> ''
   AND NOT EXISTS (SELECT 1 FROM exhibition_meeting_contacts c WHERE c.meeting_id = m.id);
