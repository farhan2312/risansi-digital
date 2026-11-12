-- 0036  SO versions (Pump SOs). Order Making PO saves the SO as it stands as a
-- read-only version — the SO, its ECs and payment terms, and every
-- department's data on it — and the SO goes on as the next version, where the
-- departments keep working. orders.version_no is the SO's current version;
-- order_versions holds the frozen ones (1 .. version_no - 1). Same statements
-- in apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS version_no INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS order_versions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    -- The version frozen here.
    version_no      INT         NOT NULL,
    -- Why the next version was made (a client's revised PO, say).
    reason          TEXT        NOT NULL,
    -- The SO as it stood: { order, items, tables: { <table>: [rows] } }.
    snapshot        JSONB       NOT NULL,
    created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
    -- Kept as written, so the history names them after they leave.
    created_by_name TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, version_no)
);
