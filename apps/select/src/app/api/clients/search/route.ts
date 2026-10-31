import { error, json } from "@/lib/api";
import { isMarketIntellConfigured, miQuery } from "@/lib/db/market-intell";

export const dynamic = "force-dynamic";

// Typeahead over the Market Intell client master, used by the Create Enquiry
// modal to prefill client code / name / industry. READ-ONLY: this app never
// writes to Market Intell (see lib/db/market-intell.ts).
//
// Matches either the client code or the legal name, and always excludes
// soft-deleted rows (deleted_at IS NULL). Results are ranked so the closest
// match comes first: exact code, then code prefix, then name prefix, then any
// substring — the caller only shows a short list, so ordering matters more
// than the total count.
const MAX_RESULTS = 10;

type ClientRow = {
  code: string;
  legal_name: string;
  industry: string | null;
  market_type: string | null;
  zone: string | null;
  primary_rep: string | null;
  secondary_reps: string | null;
};

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  // Below 2 chars a substring match returns most of the table; the client
  // debounces, but guard here too so a stray request stays cheap.
  if (q.length < 2) return json([]);
  if (!isMarketIntellConfigured()) return json([]);

  const like = `%${q}%`;
  const prefix = `${q}%`;

  try {
    const rows = await miQuery<ClientRow>(
      // Reps, market type and zone as the sales portal reads them: the
      // primary rep and the secondary reps (active users only), and the zone
      // of the client's tour route.
      `SELECT c.code, c.legal_name, c.industry, c.market_type, tr.zone,
              (SELECT u.name FROM users u WHERE u.id = c.primary_rep_id AND u.is_active) AS primary_rep,
              (SELECT string_agg(u.name, ', ' ORDER BY u.name)
                 FROM client_secondary_reps s
                 JOIN users u ON u.id = s.rep_id AND u.is_active
                WHERE s.client_id = c.id) AS secondary_reps
         FROM clients c
         LEFT JOIN tour_routes tr ON tr.id = c.tour_id
        WHERE c.deleted_at IS NULL
          AND (c.code ILIKE $1 OR c.legal_name ILIKE $1)
        ORDER BY
          CASE
            WHEN c.code ILIKE $3 THEN 0
            WHEN c.code ILIKE $2 THEN 1
            WHEN c.legal_name ILIKE $2 THEN 2
            ELSE 3
          END,
          c.legal_name
        LIMIT ${MAX_RESULTS}`,
      [like, prefix, q],
    );
    return json(rows);
  } catch (err) {
    console.error(
      "Market Intell client search failed:",
      err instanceof Error ? err.message : err,
    );
    return error("Client lookup is unavailable right now", 502);
  }
}
