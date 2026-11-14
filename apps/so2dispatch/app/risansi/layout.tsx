import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canSeeEscalations, isRep } from "@/lib/roles";
import { countAlerts } from "@/lib/alerts";
import { countRemindersForRole } from "@/lib/reminders";
import { countUnread, recipientRolesForUser } from "@/lib/notifications";
import { ensurePlanningAlerts } from "@/lib/planning-alerts";
import { countOpenBugReports } from "@/lib/bug-reports";
import { countDiscussionUnread } from "@/lib/order-messages";
import { AppShell } from "@/components/risansi/app-shell";
import { cookies } from "next/headers";
import { SIDEBAR_COOKIE } from "@/lib/view-mode";

export const dynamic = "force-dynamic";

export default async function RisansiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Users issued a temporary password must set their own before using the app.
  // (The platform admin is never flagged, so it's exempt by construction.)
  if (user.must_change_password) redirect("/set-password");

  // Department roles see a reminder count on their own department nav item;
  // everyone gets an unread-notifications badge on the Notifications nav item.
  // Central/admin's Notifications page also shows live escalations (alertCount).
  // Planning's daily alerts (delays, LD dates coming up), raised once a day before its count is read.
  if (user.role === "planning") await ensurePlanningAlerts();
  const [alertCount, reminderCount, notifUnread, openBugCount, discussionUnread] =
    await Promise.all([
      canSeeEscalations(user.role) ? countAlerts() : Promise.resolve(0),
      countRemindersForRole(user.role),
      countUnread(
        recipientRolesForUser(user.role),
        user.notifications_seen_at,
        user.id,
        isRep(user.role) ? (user.rep_names?.length ? user.rep_names : ["(no rep linked)"]) : null
      ),
      // The tracker is the admin's to run; everyone else follows their own
      // reports through the bell.
      user.role === "admin" ? countOpenBugReports() : Promise.resolve(0),
      // Independent of the rest, so it loads alongside rather than after.
      countDiscussionUnread(user),
    ]);

  return (
    <AppShell
      sidebarCollapsed={(await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed"}
      user={{ name: user.full_name, email: user.email, role: user.role, roles: user.roles, view_pages: user.view_pages }}
      alertCount={alertCount}
      reminderCount={reminderCount}
      notifUnread={notifUnread}
      openBugCount={openBugCount}
      discussionUnread={discussionUnread}
    >
      {children}
    </AppShell>
  );
}
