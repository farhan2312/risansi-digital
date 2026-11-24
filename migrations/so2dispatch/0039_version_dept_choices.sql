-- 0039  What each department chose on a new SO version: Not needed (no work;
-- its data stays as in the version before), or Acknowledged with Copy (its
-- work carried over) or Flush (its work on the ECs changed in this version
-- cleared, to start again; the version before keeps it). Once per version and
-- department. Same statements in apps/so2dispatch/db/schema.sql. Idempotent and additive.

CREATE TABLE IF NOT EXISTS order_version_dept_choices (
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    version_no      INTEGER NOT NULL,
    dept            TEXT NOT NULL,
    choice          TEXT NOT NULL CHECK (choice IN ('not_needed', 'copy', 'flush')),
    -- Flush: the ECs whose work was cleared (ids, and their numbers as they were).
    flushed_items   UUID[] NOT NULL DEFAULT '{}',
    flushed_ecs     TEXT[] NOT NULL DEFAULT '{}',
    chosen_by       UUID,
    chosen_by_name  TEXT,
    chosen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (order_id, version_no, dept)
);
