// The colour each pipeline stage is drawn in.
//
// One definition, because there were two identical hand-copied maps — in the
// opportunity drawer and the active-opportunities table — and a third was about
// to be written for the remarks log. Nothing enforced that they agreed; a stage
// added to one would simply have fallen back to grey in the other.
//
// Plain hex rather than CSS variables: these are stage identities rather than
// theme colours, and they read the same in light and dark.
export const STAGE_TONE: Record<string, string> = {
  Prospect:    '#1A5CB8',
  Suspect:     '#6B7FA3',
  Quoted:      '#D97706',
  Negotiating: '#F97316',
  'On Hold':   '#7C3AED',
  Won:         '#0E9F6E',
  Lost:        '#E02424',
  Dropped:     '#64748B',
};

/** The colour for a stage, falling back to the neutral one for anything unknown. */
export const stageTone = (stage: string | null | undefined): string =>
  STAGE_TONE[stage ?? ''] ?? '#6B7FA3';
