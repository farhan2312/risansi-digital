// The SO's target dates and their revision history.
//
// Plain module (no server imports) so the panel and the server action agree on
// one list. Each target keeps its current value on `orders` — that is what
// alerts.ts, reminders.ts, the Departments popup and the export read — while
// order_target_revisions records every value it has ever held.

export const TARGET_KEYS = [
  "drawing",
  "purchase",
  "quality",
  "packing",
  "dispatch",
] as const;

export type TargetKey = (typeof TARGET_KEYS)[number];

export type TargetDate = {
  key: TargetKey;
  label: string;
  /** The `orders` column holding the original value. */
  column: string;
  /**
   * Dispatch is the one target that already had a two-column shape: the
   * original stays put and revisions land in `dispatch_target_revised_date`,
   * which is the column every existing consumer COALESCEs to. Keeping that
   * means the history can be added without touching any of them.
   */
  revisedColumn?: string;
  /** Shown under the field so it is clear who the date is for. */
  hint: string;
};

export const TARGET_DATES: TargetDate[] = [
  {
    key: "drawing",
    label: "Target Date for Drawing",
    column: "drg_target_date",
    hint: "Drawing",
  },
  {
    key: "purchase",
    label: "Target Date for Purchase",
    column: "purchase_target_date",
    hint: "Purchase — applies when BOI = Yes",
  },
  {
    key: "quality",
    label: "Quality Target Date",
    column: "qc_doc_target_date",
    hint: "Quality — applies when Quality Required = Yes",
  },
  {
    key: "packing",
    label: "Target Date for Packing Team",
    column: "dispatch_team_target_date",
    hint: "Assembly & Packing",
  },
  {
    key: "dispatch",
    label: "Dispatch Target Date",
    column: "dispatch_target_date",
    hint: "Dispatch — Planning schedules to this date too",
  },
];

export const TARGET_BY_KEY = new Map<TargetKey, TargetDate>(
  TARGET_DATES.map((t) => [t.key, t])
);

export function isTargetKey(value: string): value is TargetKey {
  return (TARGET_KEYS as readonly string[]).includes(value);
}

/** One recorded value of a target. seq 1 is the original. */
export type TargetRevision = {
  id: string;
  target_key: TargetKey;
  seq: number;
  target_date: string;
  reason: string | null;
  changed_by_email: string | null;
  changed_by_role: string | null;
  created_at: string;
};
