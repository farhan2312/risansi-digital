// Drawing's Assigned to, as both the server and the page read it.

export type DrawingMember = { id: string; full_name: string };
export type DrawingAssignee = { id: string; name: string; at: string | null };

/** Unassigned, as the filter names it in the URL. */
export const DRAWING_UNASSIGNED = "none";
/** The filter's URL key. */
export const DRAWING_ASSIGNEE_KEY = "drg_to";
