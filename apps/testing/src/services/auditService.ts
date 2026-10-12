import apiClient from "./apiClient";

/** Fire-and-forget page-view beat -- never blocks or throws into the caller,
 * this is telemetry for the Audit Log's Usage & Time tab, not a real action.
 * Caller (DashboardLayout) is responsible for only calling this once a
 * logged-in user is known. */
export const recordPageView = (path: string): void => {
  apiClient.post("/audit/pageview", { path }).catch(() => {});
};
