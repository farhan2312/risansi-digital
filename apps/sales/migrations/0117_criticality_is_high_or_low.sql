-- Criticality becomes two levels, decided by four questions.
--
-- The S1–S4 grade came from a truth table of eleven risk questions. The
-- Complaint Team has asked for four — Safety Risk, Customer Shutdown,
-- Contractual Penalty, Repeat — and two outcomes: any Yes is High Criticality,
-- anything else is Low. Everything else about criticality goes.
--
-- Converting the grades already recorded, from the four questions that survive
-- rather than from the old letter, because the new rule is a rule about those
-- four answers and the old letter was a rule about eleven:
--
--     S1  ->  High   3 complaints
--     S2  ->  Low   10
--     S4  ->  Low    7
--     unanswered     202, still unanswered
--
-- The ten S2s dropping to Low is the new rule applied honestly, not a loss: an
-- S2 was earned by questions like "major performance issue" and "cost above
-- ₹5,000" that are no longer asked. If any of those ten should be High, the
-- answer is to tick one of the four on it.
--
-- The seven dropped questions keep their columns and their answers — 19
-- complaints hold one — so this reverses, and so the history of why something
-- was graded S2 is still readable. They are simply no longer asked.

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_severity_check;

UPDATE complaints SET severity = CASE
  WHEN risk_safety IS TRUE OR risk_shutdown IS TRUE OR risk_penalty IS TRUE OR risk_repeat_failure IS TRUE THEN 'High'
  WHEN risk_safety IS NOT NULL OR risk_shutdown IS NOT NULL OR risk_penalty IS NOT NULL OR risk_repeat_failure IS NOT NULL THEN 'Low'
  ELSE NULL
END;

ALTER TABLE complaints ADD CONSTRAINT complaints_severity_check
  CHECK (severity IS NULL OR severity IN ('High', 'Low'));

COMMENT ON COLUMN complaints.severity IS
  'High or Low criticality, computed from the four Immediate Response answers — never typed. High when any of Safety Risk, Customer Shutdown, Contractual Penalty or Repeat is Yes.';

-- The CAPA decision itself, which page 3 asks before naming the departments.
-- Distinct from complaints.capa_required on page 6, which asks whether a CAPA
-- is wanted from the VENDOR; this one is whether the complaint needs a
-- corrective action raised internally at all.
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS capa_needed boolean;

COMMENT ON COLUMN complaints.capa_needed IS
  'Whether this complaint needs a CAPA. Yes routes it to the departments in capa_departments — QC, Purchase, or both.';

-- The overdue thresholds were keyed by the old grade, so a two-level
-- criticality needs a two-row table. 2 days and 7 days are the figures the
-- requirement named; they remain editable in Admin, which is the point of the
-- table existing at all.
--
-- Worth knowing what this moves: the old S4 allowed 30 days and most graded
-- complaints land on Low, so Low at 7 days is a tighter deadline than most of
-- them had. That is the requirement's own arithmetic, not a side effect.
-- The table carries its own CHECK naming the four letters, so the rows cannot
-- change until it does.
ALTER TABLE complaint_sla_thresholds DROP CONSTRAINT IF EXISTS complaint_sla_thresholds_severity_check;
DELETE FROM complaint_sla_thresholds WHERE severity IN ('S1', 'S2', 'S3', 'S4');
INSERT INTO complaint_sla_thresholds (severity, days) VALUES ('High', 2), ('Low', 7)
ON CONFLICT (severity) DO UPDATE SET days = EXCLUDED.days;
ALTER TABLE complaint_sla_thresholds ADD CONSTRAINT complaint_sla_thresholds_severity_check
  CHECK (severity IN ('High', 'Low'));
