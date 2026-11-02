-- 0026  The order's pictures: SharePoint links Dispatch adds, as many as there
-- are, seen on the Orders page too. The same statement is in
-- apps/so2dispatch/db/schema.sql. Idempotent and additive.

CREATE TABLE IF NOT EXISTS order_picture_links (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    link       TEXT NOT NULL,
    added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, link)
);
