import { asc, ilike, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { mediaList } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Media / application options — pure reference list (industry + media only,
// no MOC recommendation data).
//   ?q=text   search: names containing the text, those starting with it
//             first, then alphabetical; at most ?limit= (default 20, max 50)
//   no q      alphabetical - the first ?limit= names, or the whole list
//             when no limit is given
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const limitRaw = parseInt(params.get("limit") ?? "20", 10);
  const limit = Math.min(50, Math.max(1, Number.isNaN(limitRaw) ? 20 : limitRaw));
  if (!q) {
    const all = db.select({ media: mediaList.media }).from(mediaList).orderBy(asc(mediaList.media));
    const rows = params.has("limit") ? await all.limit(limit) : await all;
    return json(rows.map((r) => r.media));
  }
  // Escape LIKE wildcards so "%" or "_" in the text match literally.
  const esc = q.replace(/[\\%_]/g, (c) => "\\" + c);
  const rows = await db
    .select({ media: mediaList.media })
    .from(mediaList)
    .where(ilike(mediaList.media, `%${esc}%`))
    .orderBy(sql`case when ${mediaList.media} ilike ${esc + "%"} then 0 else 1 end`, asc(mediaList.media))
    .limit(limit);
  return json(rows.map((r) => r.media));
}

// Adds a media a user typed manually via "Other" on the Media dropdown, so it
// shows up in the dropdown for everyone afterwards. Upserts on the unique
// `media` column — a repeat entry of the same media is a no-op, not an error.
// `industry` isn't asked of the user at entry time, so it takes the column's
// own default ("Non-Sugar").
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const media = String(body.media ?? "").trim();
  if (!media) return error("'media' is required", 400);

  const industry = body.industry ? String(body.industry).trim() : undefined;

  const [row] = await db
    .insert(mediaList)
    .values(industry ? { media, industry } : { media })
    .onConflictDoUpdate({
      target: mediaList.media,
      set: { media: sql`${mediaList.media}` },
    })
    .returning();

  return json(row);
}
