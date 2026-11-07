-- 0035  A pump EC can have several attachments (SharePoint links), one per line
-- in order_items.ec_link. Each link's own time is kept in ec_links, a list of
-- {link, at}: set by the database when a link is added, kept while it stays,
-- and dropped with it. ec_link_at becomes the latest of them. Same statements
-- in apps/so2dispatch/db/schema.sql. Idempotent and additive.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS ec_links JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION set_ec_link_at()
RETURNS TRIGGER AS $$
DECLARE
    prev JSONB := '[]'::jsonb;
BEGIN
    IF NULLIF(btrim(NEW.ec_link), '') IS NULL THEN
        NEW.ec_link_at := NULL;
        NEW.ec_links := '[]'::jsonb;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.ec_link IS NOT DISTINCT FROM OLD.ec_link THEN
            RETURN NEW;
        END IF;
        prev := COALESCE(OLD.ec_links, '[]'::jsonb);
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'link', l.link,
               'at', COALESCE((SELECT p->>'at' FROM jsonb_array_elements(prev) p WHERE p->>'link' = l.link LIMIT 1),
                              to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
             ORDER BY l.n), '[]'::jsonb)
      INTO NEW.ec_links
      FROM (SELECT btrim(x) AS link, min(n) AS n
              FROM unnest(string_to_array(replace(NEW.ec_link, E'\r', ''), E'\n')) WITH ORDINALITY AS t(x, n)
             WHERE btrim(x) <> ''
             GROUP BY btrim(x)) l;
    NEW.ec_link_at := (SELECT max((p->>'at')::timestamptz) FROM jsonb_array_elements(NEW.ec_links) p);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_items_set_ec_link_at ON order_items;
CREATE TRIGGER order_items_set_ec_link_at BEFORE INSERT OR UPDATE OF ec_link ON order_items
    FOR EACH ROW EXECUTE FUNCTION set_ec_link_at();

-- The links already there: one each, at the time it was attached.
UPDATE order_items
   SET ec_links = jsonb_build_array(jsonb_build_object(
         'link', btrim(ec_link),
         'at', to_char(COALESCE(ec_link_at, created_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 WHERE NULLIF(btrim(ec_link), '') IS NOT NULL
   AND ec_links = '[]'::jsonb;
