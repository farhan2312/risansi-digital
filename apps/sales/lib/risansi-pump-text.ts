// What a rep means when they cannot answer a box.
//
// A dash is not a serial number. Reps fill the boxes they do not know with
// "-", and the unique index on (client_id, pump_sl_no) covers every non-empty
// serial — so two pumps entered as "-" collided and the second overwrote the
// first, and the next batch overwrote that. West Valley Sugar Mill's order of
// two came out as one row (id 12122, 25 Sep), and adding a second model made
// it vanish.
//
// A placeholder therefore means the same thing as an empty box: not recorded.
// It is stored as NULL, which the partial index ignores, so as many unnumbered
// pumps as the client owns can sit side by side.
//
// One definition, shared by the save action and the form, so the form can say
// out loud what the action is about to do rather than quietly discarding what
// somebody typed.

const PLACEHOLDER =
  /^(?:[-–—._/\\?*]+|n\.?\s*a\.?|n\/a|nil|none|null|nan|tbd|unknown|not\s*(?:available|known|applicable))$/i;

/** True when the text says "I don't know" rather than naming anything. */
export function isPlaceholderText(s: string | null | undefined): boolean {
  const v = (s ?? '').trim();
  return v !== '' && PLACEHOLDER.test(v);
}

/** The value to store: the trimmed text, or null for blank and for a placeholder. */
export function pumpTextOrNull(s: string | null | undefined): string | null {
  const v = (s ?? '').trim();
  return v === '' || PLACEHOLDER.test(v) ? null : v;
}
