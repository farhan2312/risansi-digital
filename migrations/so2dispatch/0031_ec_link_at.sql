-- 0031  When a pump EC's SharePoint link was attached: set by the database when
-- the link is given or changed, cleared with it, and untouched by a save that
-- leaves the link as it was. Links already there take the time the audit log has
-- for them, else the EC's own. The same statements are in
-- apps/so2dispatch/db/schema.sql. Idempotent.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS ec_link_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_ec_link_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NULLIF(btrim(NEW.ec_link), '') IS NULL THEN
        NEW.ec_link_at := NULL;
    ELSIF TG_OP = 'INSERT' OR NEW.ec_link IS DISTINCT FROM OLD.ec_link THEN
        NEW.ec_link_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_items_set_ec_link_at ON order_items;
CREATE TRIGGER order_items_set_ec_link_at BEFORE INSERT OR UPDATE OF ec_link ON order_items
    FOR EACH ROW EXECUTE FUNCTION set_ec_link_at();

UPDATE order_items it
   SET ec_link_at = COALESCE(
         (SELECT max(a.created_at) FROM audit_log a
           WHERE a.item_id = it.id AND a.details LIKE '%EC Attachment (SharePoint link):%'),
         it.created_at)
 WHERE NULLIF(btrim(it.ec_link), '') IS NOT NULL
   AND it.ec_link_at IS NULL;
