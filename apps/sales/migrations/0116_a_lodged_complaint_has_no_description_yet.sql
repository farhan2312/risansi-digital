-- A complaint can be lodged before anybody has described it.
--
-- `details` was NOT NULL because, until the lodge window existed, the only way
-- to create a complaint was to fill in the whole of Registration, and a
-- description was always among the answers. Lodging asks for the client, how it
-- reached us and whatever was sent in, and nothing else — the description is
-- written at Registration, after somebody has looked at it. So the insert ran
-- into the constraint and every attempt to lodge failed with nothing useful
-- said about why.
--
-- The description is still required; the requirement just moved. missingOnPage
-- lists it, and gateFor holds the complaint at Open until Registration is
-- complete, so it cannot progress without one. The difference is that the
-- demand is now made of the Complaint Team, who can answer it, instead of
-- whoever happened to answer the phone.
--
-- Nothing existing is affected: all 219 complaints have a description.

ALTER TABLE complaints ALTER COLUMN details DROP NOT NULL;

COMMENT ON COLUMN complaints.details IS
  'What the complaint is about, in the complainant''s terms. Null only between lodging and registration — gateFor will not let a complaint leave Open without it.';
