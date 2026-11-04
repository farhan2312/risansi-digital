// One KPI card per person enquiries are assigned to (GET
// /api/projects/assignee-stats). Client-safe.

export type StatusCounts = { total: number; pending: number; inProgress: number; completed: number };

export type AssigneeStats = {
  userId: string;
  name: string | null;
  email: string;
  role: string | null;
  /** Enquiries assigned in the period, pump and spare. */
  enquiries: number;
  /** A pump has two statuses, and tags with their own. */
  pump: { technical: StatusCounts; commercial: StatusCounts; tags: StatusCounts };
  /** A spare has no tags or technical step: just its one status. */
  spare: StatusCounts;
};
