// Date handling shared by every department dashboard. The dates on an order
// are IST calendar dates stored as YYYY-MM-DD, so they compare as strings and
// must never be pushed through a local-timezone Date to be reasoned about.

/** "Today" in IST, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Whole days from today, negative for the past. */
export function daysFromToday(date: string): number {
  const a = new Date(`${todayIso()}T00:00:00Z`).getTime();
  const b = new Date(`${date}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "4d late" / "today" / "in 5d". */
export function describeDue(days: number): string {
  if (days < 0) return `${Math.abs(days)}d late`;
  return days === 0 ? "today" : `in ${days}d`;
}

export const PAST_PRESETS = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "This month",
  "This year",
] as const;

// Only a deadline can be in the future, so "Next 7 days" is offered only to
// the departments that work to one.
export const DATE_PRESETS = [...PAST_PRESETS, "Next 7 days"] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

export function presetRange(preset: DatePreset): [string, string] {
  const today = todayIso();
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  switch (preset) {
    case "Today":
      return [today, today];
    case "Yesterday":
      return [shift(-1), shift(-1)];
    case "Last 7 days":
      return [shift(-6), today];
    case "Next 7 days":
      return [today, shift(7)];
    case "This month":
      return [`${today.slice(0, 7)}-01`, today];
    default:
      return [`${today.slice(0, 4)}-01-01`, today];
  }
}
