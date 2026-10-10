-- 0084: a meeting can be marked high potential, and become a lead.
--
-- The rep who takes the meeting marks it; nobody is notified. The mark shows
-- up in the post-event review, where the person running the review either
-- converts it into a Prospective-Lead client (with a Suspect opportunity for
-- the potential value) or sets it aside with a reason. The exhibition cannot
-- close while a marked meeting is neither.

ALTER TABLE exhibition_meetings
  ADD COLUMN IF NOT EXISTS high_potential  boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lead_client_id  integer REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS lead_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS lead_created_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS lead_opportunity_id integer REFERENCES opportunities(id),
  -- Set aside rather than converted: why, so the review records the judgment.
  ADD COLUMN IF NOT EXISTS lead_skipped_reason text,
  ADD COLUMN IF NOT EXISTS lead_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS lead_decided_by integer REFERENCES users(id);

COMMENT ON COLUMN exhibition_meetings.high_potential IS
  'The rep marked this company as worth pursuing. Surfaced in the post-event review, where it is converted or set aside.';

CREATE INDEX IF NOT EXISTS exhibition_meetings_potential_idx
  ON exhibition_meetings (exhibition_id) WHERE high_potential;
