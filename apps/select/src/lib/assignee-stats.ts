// One KPI card per person enquiries are assigned to (GET
// /api/projects/assignee-stats). Client-safe.

export type StatusCounts = { total: number; pending: number; inProgress: number; completed: number };

export type AssigneeStats = {
  userId: string;
  name: string | null;
  email: string;
  role: string | null;
  /** Enquiries assigned in the period, by their rolled-up status. */
  enquiries: StatusCounts;
  /** The tags of those enquiries, by their own status. */
  tags: StatusCounts;
};
