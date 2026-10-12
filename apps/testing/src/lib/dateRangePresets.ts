/** Shared date-range presets for the Overview dashboard and the Audit Log --
 * one definition so "This week" means the same thing on both. Dates are the
 * viewer's local calendar days as YYYY-MM-DD; `from`/`to` of "" = open-ended. */

export type PresetKey = "today" | "week" | "month" | "7d" | "30d" | "90d" | "12m" | "all" | "custom";

export interface DateRangeValue {
  preset: PresetKey;
  from: string;
  to: string;
}

/** Local calendar day, not UTC -- otherwise "Today" is yesterday for the
 * first hours of an IST morning. */
export const localIsoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The last `days` days ending today, inclusive (1 = today only); null = all time. */
export const rangeFor = (days: number | null): { from: string; to: string } => {
  if (days === null) return { from: "", to: "" };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: localIsoDay(from), to: localIsoDay(to) };
};

const PRESET_DEFS: Record<Exclude<PresetKey, "custom">, { label: string; days: () => number | null }> = {
  today: { label: "Today", days: () => 1 },
  // Monday-based week: Sunday counts as day 7.
  week: { label: "This week", days: () => (new Date().getDay() === 0 ? 7 : new Date().getDay()) },
  month: { label: "This month", days: () => new Date().getDate() },
  "7d": { label: "7 days", days: () => 7 },
  "30d": { label: "30 days", days: () => 30 },
  "90d": { label: "90 days", days: () => 90 },
  "12m": { label: "12 months", days: () => 365 },
  all: { label: "All time", days: () => null },
};

export const presetLabel = (key: Exclude<PresetKey, "custom">): string => PRESET_DEFS[key].label;

export const presetValue = (key: Exclude<PresetKey, "custom">): DateRangeValue => ({
  preset: key,
  ...rangeFor(PRESET_DEFS[key].days()),
});
