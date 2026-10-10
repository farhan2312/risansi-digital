// Shared option sets for complaints.
//
// The channel list lived in two places — the raise-a-complaint modal and the
// detail drawer — which is how "Mail" survived in one after being questioned in
// the other. One definition, imported by both.

/**
 * How the complaint reached us.
 *
 * "Mail" was removed: nobody could tell it apart from "Email" at a glance, and
 * the six complaints recorded against it were all e-mail in practice (migration
 * 0060 converted them). Postal complaints are vanishingly rare and are recorded
 * as Verbal with a note.
 */
export const COMPLAINT_CHANNELS = ['Verbal', 'Email'] as const;
export type ComplaintChannel = typeof COMPLAINT_CHANNELS[number];

export const COMPLAINT_PRIORITIES = ['High', 'Medium', 'Low'] as const;
