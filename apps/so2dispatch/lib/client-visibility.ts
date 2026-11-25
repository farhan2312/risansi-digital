// Who may see who the client is. Planning, Assembly & Packing, Purchase and
// Quality work to dates, statuses and items — the customer does not change
// what they do — so the client's name and code never reach them: stripped
// from what the server sends, and left off every screen. Plain module.

import { canSeeClient } from "@/lib/roles";

/** The columns that say who the client is. */
export const CLIENT_KEYS = ["client_name", "client_code"] as const;

/** The row without the client's name and code, for a role that may not see them; as it is otherwise. */
export function withoutClient<T extends Record<string, unknown>>(row: T, role: string): T {
  if (canSeeClient(role) || !row) return row;
  const out = { ...row } as Record<string, unknown>;
  for (const k of CLIENT_KEYS) if (k in out) out[k] = null;
  return out as T;
}
