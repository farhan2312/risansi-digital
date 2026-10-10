-- Stage history for an opportunity.
--
-- Five places in the app have been writing to this table since the pipeline was
-- built — createOpportunity, createPipelineOpportunity, saveQuotedDetails, the
-- client-page create, and the drag-and-drop PATCH route. Every one of them
-- wraps the INSERT in `try { } catch { /* table may not exist */ }`, and the
-- table never existed, so every stage change the team has ever made was thrown
-- away silently. This creates it; the catch blocks are being narrowed at the
-- same time so a future failure is visible instead of swallowed.
--
-- Columns match exactly what those five call sites already insert, so they
-- start working the moment this lands.
--
-- Deliberately NOT backfilled. A synthetic row per opportunity would have to
-- guess when each one reached its current stage, and a guess in a history table
-- is worse than a gap: it reads as fact forever. The stage dashboards compute
-- age as COALESCE(latest entry into the current stage, opportunities.created_at)
-- instead, which degrades honestly while real history accumulates.

CREATE TABLE IF NOT EXISTS opportunity_stage_log (
  id             serial PRIMARY KEY,
  opportunity_id integer NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage     text,               -- NULL on create (the opportunity had no prior stage)
  to_stage       text NOT NULL,
  notes          text,
  changed_by     text,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

-- The dashboards ask "when did this opportunity last enter the stage it is in
-- now", which is a per-opportunity lookup filtered by to_stage, newest first.
CREATE INDEX IF NOT EXISTS idx_opp_stage_log_opp
  ON opportunity_stage_log (opportunity_id, to_stage, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_opp_stage_log_when
  ON opportunity_stage_log (changed_at);
