-- Per-person exhibition attendance.
--
-- An exhibition runs for N days; Risansi does not necessarily attend all of
-- them, and a given person does not necessarily attend all of the days Risansi
-- does. Until now the calendar blocked every team member for the exhibition's
-- whole run, which is right for the person who is there start to finish and
-- wrong for everyone who flies in for one day -- their calendar read as busy on
-- days they were available, which is the same failure as reading free when they
-- are away, only quieter.
--
-- Two levels, because they are genuinely two decisions:
--   exhibitions.attend_from / attend_to   the days RISANSI is there
--   exhibition_team_days                  the days each PERSON is there
--
-- Individual days rather than a per-person range: people fly in and out, and a
-- range cannot say "day 1 and day 3 but not day 2". The Risansi window stays a
-- range because it is a decision about the stand, which is continuous.

-- ── the days Risansi attends ──────────────────────────────────────
ALTER TABLE exhibitions
  ADD COLUMN IF NOT EXISTS attend_from date,
  ADD COLUMN IF NOT EXISTS attend_to   date;

COMMENT ON COLUMN exhibitions.attend_from IS
  'First day Risansi is at this exhibition. Within [start_date, end_date]. NULL '
  'means the whole run, which is what every exhibition meant before this column.';
COMMENT ON COLUMN exhibitions.attend_to IS
  'Last day Risansi is at this exhibition. NULL means the whole run.';

-- Existing exhibitions attended their whole run, so say so explicitly rather
-- than leaving it to a NULL that later code has to keep remembering to read.
UPDATE exhibitions
   SET attend_from = start_date,
       attend_to   = COALESCE(end_date, start_date)
 WHERE start_date IS NOT NULL
   AND (attend_from IS NULL OR attend_to IS NULL);

-- ── the days each person attends ──────────────────────────────────
CREATE TABLE IF NOT EXISTS exhibition_team_days (
  team_id integer NOT NULL REFERENCES exhibition_team(id) ON DELETE CASCADE,
  day     date    NOT NULL,
  PRIMARY KEY (team_id, day)
);

COMMENT ON TABLE exhibition_team_days IS
  'The specific days one team member attends. Rows here are the only thing that '
  'blocks a calendar: a member with no rows is on the team but attending nothing, '
  'which is a real state (booked to go, days not yet decided) and reads as free.';

-- Blocking the calendar asks "who is away on this day", so index the day.
CREATE INDEX IF NOT EXISTS idx_exhibition_team_days_day ON exhibition_team_days(day);

-- ── backfill: everyone already on a team attends every attending day ──
-- Their calendars are blocked for the full run today, so this is the state that
-- changes nothing. Narrowing is then a deliberate edit rather than something
-- that happens to 13 people the moment this ships.
INSERT INTO exhibition_team_days (team_id, day)
SELECT t.id, d::date
  FROM exhibition_team t
  JOIN exhibitions e ON e.id = t.exhibition_id
  CROSS JOIN LATERAL generate_series(
    COALESCE(e.attend_from, e.start_date),
    COALESCE(e.attend_to, e.end_date, e.start_date),
    interval '1 day') d
 WHERE e.start_date IS NOT NULL
ON CONFLICT DO NOTHING;
