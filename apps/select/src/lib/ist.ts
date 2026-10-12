/**
 * India Standard Time helpers. IST is UTC+05:30 all year (India has no
 * daylight saving), so a fixed offset is exact — no time-zone database needed,
 * and the result is the same whatever zone the server itself runs in.
 */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** The instant the IST calendar day containing `now` began (00:00 IST). */
export function startOfIstDay(now: Date = new Date()): Date {
  // Shift into IST, read the calendar date there, then shift midnight back.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const midnightAsUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnightAsUtc - IST_OFFSET_MS);
}

/** 00:00 IST on the Monday of the IST week containing `now`. */
export function startOfIstWeek(now: Date = new Date()): Date {
  const day = startOfIstDay(now);
  const ist = new Date(day.getTime() + IST_OFFSET_MS);
  const sinceMonday = (ist.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(day.getTime() - sinceMonday * 86400_000);
}

/** 00:00 IST on the 1st of the IST month containing `now`. */
export function startOfIstMonth(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}
