/** Small formatting helpers shared by every Audit Log tab. */

export const ROLE_LABELS: Record<string, string> = {
  source: "Source Team",
  testing: "Testing Team",
  "central-admin": "Central Admin",
  admin: "Admin",
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "15h 04m" / "30m 32s" / "8s" -- drops to the next-smaller unit rather than always showing h/m/s. */
export const formatDuration = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};

/** Compact form for grid cells: "1.7h" / "46m". */
export const formatDurationShort = (totalSeconds: number): string =>
  totalSeconds >= 3600 ? `${(totalSeconds / 3600).toFixed(1)}h` : `${Math.max(1, Math.round(totalSeconds / 60))}m`;

const utcDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** "2026-09-19" -> "Sat, 19 Sep". */
export const dayShort = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(utcDate(day));

/** "2026-09-19" -> "S" (weekday initial for a grid header). */
export const weekdayInitial = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" }).format(utcDate(day));

export const dayOfMonth = (day: string): number => utcDate(day).getUTCDate();

/** 11 -> "11:00 – 12:00". */
export const hourSlot = (hour: number): string =>
  `${String(hour).padStart(2, "0")}:00 – ${String((hour + 1) % 24).padStart(2, "0")}:00`;

/** "5m ago" / "3h ago" / "2d ago". */
export const timeAgo = (iso: string): string => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
};

/** Two-letter initials from a name, or from the local part of an email ("rachna.chauhan@x" -> "RC"). */
export const personInitials = (name: string | null, email: string | null): string => {
  const source = name?.trim() || (email ?? "?").split("@")[0].replace(/[._-]+/g, " ");
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Fixed slot per known label so a category keeps its color across every card
 * (color follows the entity); anything unlisted takes the next free slot, and
 * "Unknown"/"Other" are always neutral -- never a series color. */
export const NEUTRAL = "var(--text-faint)";
export const assignColors = (labels: string[], preferred: Record<string, string>): Record<string, string> => {
  const slots = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const label of labels) {
    if (label === "Unknown" || label === "Other") result[label] = NEUTRAL;
    else if (preferred[label]) {
      result[label] = preferred[label];
      used.add(preferred[label]);
    }
  }
  for (const label of labels) {
    if (result[label]) continue;
    const free = slots.find((s) => !used.has(s));
    result[label] = free ?? NEUTRAL;
    if (free) used.add(free);
  }
  return result;
};
