// A department's choice on a new SO version — the words, shared by the
// server (lib/version-choice) and the browser (the version tag).

export const VERSION_CHOICES = ["not_needed", "copy", "flush"] as const;
export type VersionChoice = (typeof VERSION_CHOICES)[number];
export const CHOICE_LABEL: Record<VersionChoice, string> = {
  not_needed: "Not needed",
  copy: "Acknowledged · Copy",
  flush: "Acknowledged · Flush",
};

/** The departments that choose, by their EC-change department key, with their names. */
export const CHOICE_DEPTS: Record<string, string> = {
  drawing: "Drawing",
  purchase: "Purchase",
  qc: "Quality",
  planning: "Planning",
  assembly: "Assembly & Packing",
};

export type DeptChoice = {
  dept: string;
  choice: VersionChoice;
  flushed_ecs: string[];
  chosen_by_name: string | null;
  chosen_at: string;
};
