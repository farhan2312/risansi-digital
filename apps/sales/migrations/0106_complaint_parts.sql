-- One complaint, as many parts as it is actually about.
--
-- Page 2 held a single part: one part_type, one part_name, one quantity, one
-- MOC. Most complaints are not about one part. A damaged joint comes in with
-- the bush, the pin, the protector and the shaft head, each wanting its own
-- material of construction; a wrong supply spans several ECs. With one slot
-- the rest went into the remarks box and left the dashboard unable to answer
-- "which part fails most", which is the whole point of asking.
--
-- The old single-part columns on `complaints` (part_type, part_name, quantity,
-- rubber_moc, stator_code, mfg_date, liquid, head_pressure) are left in place
-- and left alone: eleven records carry answers in them and those answers are
-- still true. New complaints write here instead.
--
-- The columns that only some categories ask for live on the same row rather
-- than in a side table, because which ones are asked is a property of the
-- complaint's category and changes with it: vendor for a BOI issue, MFG date
-- and part code for a rubber part, and liquid / head / capacity for a
-- Performance complaint, where the question is about duty and not a part.

CREATE TABLE IF NOT EXISTS complaint_parts (
  id           serial      PRIMARY KEY,
  complaint_id integer     NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  sort_order   integer     NOT NULL DEFAULT 0,
  part_type    text,
  part_name    text,
  quantity     numeric,
  moc          text,
  vendor_name  text,
  mfg_date     date,
  part_code    text,
  ec_no        text,
  ec_date      date,
  liquid       text,
  head         text,
  capacity     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE complaint_parts IS
  'The parts one complaint is about, one row each. Replaces the single part slot on complaints, which could not hold a joint''s child parts or a complaint spanning several ECs. The old columns stay for the records already using them.';
COMMENT ON COLUMN complaint_parts.sort_order IS
  'The order the user added the rows in, so the list reads back as it was entered.';
COMMENT ON COLUMN complaint_parts.part_type IS
  'Rubber Part, BOI, External, Joint or Child Parts of Joints — the part_type lookup.';
COMMENT ON COLUMN complaint_parts.part_name IS
  'The part itself — the part_name lookup, filtered by parent_value = part_type.';
COMMENT ON COLUMN complaint_parts.moc IS
  'Material of construction, asked per part: a joint''s bush and its shaft head are rarely the same material.';
COMMENT ON COLUMN complaint_parts.vendor_name IS
  'The vendor who supplied the part. Asked for BOI parts, where the CAPA is owed by them and not by us.';
COMMENT ON COLUMN complaint_parts.mfg_date IS
  'Manufacturing date, asked for rubber parts only — a stator''s age is part of the diagnosis.';
COMMENT ON COLUMN complaint_parts.part_code IS
  'The rubber part''s code, asked for rubber parts only.';
COMMENT ON COLUMN complaint_parts.ec_no IS
  'The EC this part was supplied against. Per row, because one complaint can span several ECs.';
COMMENT ON COLUMN complaint_parts.liquid IS
  'The liquid being pumped. Asked for Performance complaints, where the duty and not the part is in question.';
COMMENT ON COLUMN complaint_parts.head IS
  'The head the pump is working against, as reported. Performance complaints only.';
COMMENT ON COLUMN complaint_parts.capacity IS
  'The capacity the pump is delivering, as reported. Performance complaints only.';

CREATE INDEX IF NOT EXISTS complaint_parts_complaint_idx ON complaint_parts (complaint_id, sort_order);
CREATE INDEX IF NOT EXISTS complaint_parts_part_name_idx ON complaint_parts (part_name) WHERE part_name IS NOT NULL;
