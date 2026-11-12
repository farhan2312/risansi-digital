// The client's city and country from the sales portal (Market Intell, read only), for
// the documents' Client Name box: "VA TECH WABAG LIMITED, Chennai, India" (user,
// 2026-11-12). Looked up by the enquiry's client code each time a document opens, so a
// change in sales shows up; no code, or sales not reachable: the name alone. Server only.
import { isMarketIntellConfigured, miQuery } from "@/lib/db/market-intell";

/** "Chennai, India" for a client code, or "" when there is nothing to add. */
export async function clientPlace(clientCode: string | null | undefined): Promise<string> {
  const code = (clientCode ?? "").trim();
  if (!code || !isMarketIntellConfigured()) return "";
  try {
    const [row] = await miQuery<{ city: string | null; country: string | null }>(
      `SELECT city, country FROM clients WHERE upper(trim(code)) = upper($1) AND deleted_at IS NULL LIMIT 1`,
      [code],
    );
    return [row?.city, row?.country].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  } catch {
    return "";
  }
}

/** The Client Name box on a document: the name, then the city and country. */
export async function docClientName(name: string | null | undefined, clientCode: string | null | undefined): Promise<string> {
  const n = (name ?? "").trim();
  const place = await clientPlace(clientCode);
  return [n, place].filter(Boolean).join(", ");
}
