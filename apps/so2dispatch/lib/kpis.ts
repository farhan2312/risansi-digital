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
};

/** A card as shown: its count. */
export type KpiCard = Omit<KpiCardDef, "sql"> & { count: number };

/** What counts the cards: the queue's own condition, and the cards. */
export type KpiRequest = { restrict: string; cards: KpiCardDef[] };

/** A tone for a status word, so the cards read at a glance. */
export function toneFor(status: string): KpiTone {
  const s = status.toLowerCase();
  if (/(fully|closed|approved|issued to planning|received|packed$|^packed|complete|dispatched|assembled$|^assembled|submitted|paid|clear)/.test(s)) return "done";
  if (/(partial|partly|in plan|sent|lot|progress|resubmit)/.test(s)) return "part";
  if (/(overdue|hold|late|short)/.test(s)) return "danger";
  return "pending";
}
