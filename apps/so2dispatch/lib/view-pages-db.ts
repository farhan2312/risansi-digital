import "server-only";
// 360° View's pages, kept per account (user_view_pages). See lib/view-pages.ts.

import { query } from "@/lib/db";
import { VIEW_PAGE_HREFS } from "@/lib/view-pages";

/** The pages picked for an account, in the sidebar's order. */
export async function viewPagesFor(userId: string): Promise<string[]> {
  const r = await query<{ page: string }>(`SELECT page FROM user_view_pages WHERE user_id = $1`, [userId]);
  const mine = new Set(r.rows.map((x) => x.page));
  return VIEW_PAGE_HREFS.filter((h) => mine.has(h));
}

export type ViewPagesPerson = { id: string; full_name: string; email: string; role: string; pages: string[] };

/** Every approved account holding 360° View — as main role or an extra one — with its pages. */
export async function listViewPagesPeople(): Promise<ViewPagesPerson[]> {
  const r = await query<ViewPagesPerson>(
    `SELECT u.id, u.full_name, u.email, u.role,
            COALESCE((SELECT array_agg(p.page) FROM user_view_pages p WHERE p.user_id = u.id), '{}') AS pages
       FROM users u
      WHERE u.status = 'approved'
        AND (u.role = 'view_360' OR EXISTS (SELECT 1 FROM user_extra_roles x WHERE x.user_id = u.id AND x.role = 'view_360'))
      ORDER BY lower(u.full_name)`
  );
  return r.rows.map((p) => ({ ...p, pages: VIEW_PAGE_HREFS.filter((h) => p.pages.includes(h)) }));
}

/** Set an account's pages to exactly these (anything not a page is dropped). */
export async function setViewPages(userId: string, pages: string[], actorId: string): Promise<void> {
  const keep = [...new Set(pages)].filter((p) => VIEW_PAGE_HREFS.includes(p));
  await query(`DELETE FROM user_view_pages WHERE user_id = $1 AND NOT (page = ANY($2::text[]))`, [userId, keep]);
  for (const page of keep) {
    await query(
      `INSERT INTO user_view_pages (user_id, page, created_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, page) DO NOTHING`,
      [userId, page, actorId]
    );
  }
}
