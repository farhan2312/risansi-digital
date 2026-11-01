-- 0023  SO to Dispatch's 360° View role, and the pages each such account sees.
--
-- Apply against ec_to_dispatch BEFORE any grant is set to view_360 at the hub
-- (migrations/identity/0013_so2dispatch_view_360.sql). The same statements
-- are in apps/so2dispatch/db/schema.sql. Idempotent and additive.
--
-- 360° View sees every SO, read-only, on the pages Admin ticks for the
-- account (Users & Access): user_view_pages, one row per page (its href).

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD  CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'central_visibility', 'operations', 'accounts',
                    'drawing', 'planning', 'purchase', 'qc',
                    'assembly', 'dispatch', 'order_making', 'order_making_so', 'rep',
                    'rep_manager', 'crm', 'view_360'));

CREATE TABLE IF NOT EXISTS user_view_pages (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page       TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, page)
);
