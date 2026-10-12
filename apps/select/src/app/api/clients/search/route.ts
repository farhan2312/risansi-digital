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
      `SELECT code, legal_name, industry
         FROM clients
        WHERE deleted_at IS NULL
          AND (code ILIKE $1 OR legal_name ILIKE $1)
        ORDER BY
          CASE
            WHEN code ILIKE $3 THEN 0
            WHEN code ILIKE $2 THEN 1
            WHEN legal_name ILIKE $2 THEN 2
            ELSE 3
          END,
          legal_name
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
