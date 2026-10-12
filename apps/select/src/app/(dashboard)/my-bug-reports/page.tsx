"use client";

import BugTrackerPage from "@/screens/bug-tracker/BugTrackerPage";

// Every signed-in user: the reports they filed, read-only (the API scopes
// ?mine=1 to the caller). System admins triage everything at /admin/bug-tracker.
export default function Page() {
  return <BugTrackerPage mine />;
}
