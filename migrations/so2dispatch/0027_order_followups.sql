-- 0027  An SO's follow-ups: each one kept, with when it happened, its remarks
-- and when the next is due. Added to, never changed. The same statement is in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.

CREATE TABLE IF NOT EXISTS order_followups (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    followup_date      DATE NOT NULL,
    remarks            TEXT NOT NULL,
    next_followup_date DATE NOT NULL,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_followups_order_idx ON order_followups (order_id, created_at DESC);
