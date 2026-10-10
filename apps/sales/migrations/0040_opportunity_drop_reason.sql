-- Why an opportunity was Dropped. Kept separate from lost_reason: Lost means we
-- competed and didn't win (it feeds win-rate/competitor analysis), Dropped means
-- the requirement went away. Chosen from a fixed list — see DROP_REASONS in
-- lib/risansi-opportunity-fields.ts.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS drop_reason text;
