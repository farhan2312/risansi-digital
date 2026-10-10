-- 0078: the legacy complaint log's dates are day-first.
--
-- The 2026 import read a remark's leading date ("12-01-2026: FR has been
-- proceed…") as US month/day whenever both parts were 12 or under, so
-- 12 January became 1 December. closed_at was derived from the latest remark
-- date, so 24 closed complaints "closed" in the future and many more closed
-- weeks later than they did. The remarks are unambiguous once the whole log
-- is read in order (24-02, 07-02, 09-02, 10-02, 11-03, 09-04: day first).
--
-- Rewrites entry_date and created_at on the imported remark rows, recomputes
-- closed_at from them, and moves the seeded closing row of the stage log to
-- match, so the lifecycle and the analytics see the real dates.

BEGIN;

CREATE TEMP TABLE _fix AS
SELECT u.id,
       make_date(CASE WHEN length(m[3]) = 2 THEN 2000 + m[3]::int ELSE m[3]::int END, m[2]::int, m[1]::int) AS d
  FROM complaint_updates u
  JOIN complaints c ON c.id = u.complaint_id AND c.created_by = 'import'
  CROSS JOIN LATERAL regexp_match(u.body, '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})') AS m
 WHERE m IS NOT NULL
   AND m[1]::int BETWEEN 1 AND 31 AND m[2]::int BETWEEN 1 AND 12
   AND (CASE WHEN length(m[3]) = 2 THEN 2000 + m[3]::int ELSE m[3]::int END) BETWEEN 2020 AND 2026
   AND NOT (m[2]::int = 2 AND m[1]::int > 29)
   AND NOT (m[1]::int = 31 AND m[2]::int IN (4, 6, 9, 11));

UPDATE complaint_updates u
   SET entry_date = f.d, created_at = f.d::timestamptz
  FROM _fix f
 WHERE f.id = u.id AND u.entry_date IS DISTINCT FROM f.d;

-- Closed when the last dated remark was written, as the import intended;
-- the complaint date where no remark carries one.
UPDATE complaints c
   SET closed_at = COALESCE(x.d, c.complaint_date, c.created_at::date)::timestamptz, updated_at = now()
  FROM (SELECT u.complaint_id, max(u.entry_date) AS d
          FROM complaint_updates u GROUP BY u.complaint_id) x
 WHERE x.complaint_id = c.id AND c.created_by = 'import' AND c.schema_version < 2
   AND c.status IN ('Closed', 'Resolved')
   AND c.closed_at IS DISTINCT FROM COALESCE(x.d, c.complaint_date, c.created_at::date)::timestamptz;

-- Nothing closes before it was raised.
UPDATE complaints SET closed_at = created_at
 WHERE created_by = 'import' AND schema_version < 2 AND closed_at IS NOT NULL AND closed_at < created_at;

-- The seeded closing row of each legacy lifecycle follows closed_at.
UPDATE complaint_stage_log l
   SET created_at = COALESCE(c.closed_at, c.resolved_at)
  FROM complaints c
 WHERE l.complaint_id = c.id AND c.created_by = 'import' AND c.schema_version < 2
   AND l.from_status IS NULL AND l.to_status = c.status AND l.note IS NULL
   AND l.created_at IS DISTINCT FROM COALESCE(c.closed_at, c.resolved_at);

DROP TABLE _fix;

COMMIT;
