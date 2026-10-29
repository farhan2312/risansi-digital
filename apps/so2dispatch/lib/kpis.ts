// The small summary cards under a department queue's filter bar: how many
// SOs of the queue — as filtered, but before its own status filter — stand at
// each status. A card applies its status when clicked (clears it when already
// on). Shared by the browser and the server.

export type KpiTone = "neutral" | "pending" | "part" | "done" | "danger";

/** A card as the page asks for it: what it counts (SQL over orders `o`) and the URL it sets. */
export type KpiCardDef = {
  key: string;
  label: string;
  /** Null for the queue's total. */
  sql: string | null;
  /** The URL params the card sets; the same keys set to null clear it. */
  params: Record<string, string | null>;
  tone?: KpiTone;
  /** A sum over the SOs instead of a count of them (e.g. their ECs), shown but not clickable. */
  measure?: string;
  /** A heading the card sits under (the Orders page groups its cards by department). */
  group?: string;
};

/** The URL param holding what the card clicked set (as a query string). */
export const KPI_PICKED = "kc";

/** What a card sets, as KPI_PICKED carries it: its non-empty params. */
export function pickedValue(params: Record<string, string | null>): string | null {
  const set = Object.entries(params).filter((e): e is [string, string] => e[1] !== null);
  return set.length ? new URLSearchParams(set).toString() : null;
}

/**
 * The URL as the cards count it: the filter bar as set, less what the card
 * clicked (KPI_PICKED) set — so clicking a card narrows the list but leaves
 * the cards as they were, while a filter chosen in the bar narrows both. A
 * card the URL no longer matches (its filter since changed in the bar) is no
 * longer the pick, and everything set counts.
 */
export function cardBaseGet(get: (key: string) => string | undefined): (key: string) => string | undefined {
  const raw = get(KPI_PICKED);
  if (!raw) return get;
  const picked = [...new URLSearchParams(raw)];
  if (!picked.length || !picked.every(([k, v]) => get(k) === v)) return get;
  const own = new Set(picked.map(([k]) => k));
  return (key) => (own.has(key) || key === KPI_PICKED ? undefined : get(key));
}

/** A card as shown: its count. */
export type KpiCard = Omit<KpiCardDef, "sql"> & { count: number };

/** What counts the cards: the queue's own condition, and the cards. */
export type KpiRequest = { restrict: string; cards: KpiCardDef[] };

/** A tone for a status word, so the cards read at a glance. */
export function toneFor(status: string): KpiTone {
  const s = status.toLowerCase();
  if (/(fully|closed|approved|issued to planning|received|packed$|^packed|complete|dispatched|assembled$|^assembled|submitted|paid|clear)/.test(s)) return "done";
  if (/(partial|partly|in plan|sent|lot|progress|resubmit|order placed)/.test(s)) return "part";
  if (/(overdue|hold|late|short)/.test(s)) return "danger";
  return "pending";
}
