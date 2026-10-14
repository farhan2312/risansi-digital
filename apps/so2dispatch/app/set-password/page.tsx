import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { HUB_CHANGE_PASSWORD_URL, HUB_SIGN_OUT_URL } from "@/lib/hub";
import { HubNotice } from "@/components/auth/hub-notice";

export const metadata: Metadata = {
  title: "Change your password | SO to Dispatch",
};

// Session state is per-request, so this page can't be statically cached.
export const dynamic = "force-dynamic";

/**
 * Passwords live at Risansi Digital now (Phase 5, step 7). Anyone who still
 * owes a password change is sent there with a link — not a redirect, so a
 * stale flag can never bounce them between two sites. For a shared session
 * the flag is the hub's own (lib/session.ts), so changing it there clears it
 * here on the next request.
 */
export default async function SetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.must_change_password) redirect("/risansi/dashboard");

  return (
    <HubNotice
      title="Change your password"
      message="You are still using a password somebody else set for you. Choose your own at Risansi Digital, then come back."
      actions={[
        { label: "Change it at Risansi Digital", href: HUB_CHANGE_PASSWORD_URL, primary: true },
        { label: "Sign out", href: HUB_SIGN_OUT_URL },
      ]}
    />
  );
}
