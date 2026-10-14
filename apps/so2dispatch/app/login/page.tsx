import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccessRefusal, getSharedSession, isAuthenticated } from "@/lib/session";
import { HUB_SIGN_OUT_URL, HUB_URL, hubSignInUrl } from "@/lib/hub";
import { HubNotice } from "@/components/auth/hub-notice";

export const metadata: Metadata = {
  title: "Sign in | SO to Dispatch",
};

// Session state is per-request, so this page can't be statically cached.
export const dynamic = "force-dynamic";

/**
 * Retired (Phase 5, step 7). Signing in happens at Risansi Digital; this page
 * only decides where to send people.
 *
 * - Signed in and admitted: into the app.
 * - Signed in at the hub but refused here: say why, with links. Not a
 *   redirect to the hub — the hub sends anyone already signed in straight
 *   back to `next`, which would bring them here again, round and round.
 * - Not signed in at the hub: to its sign-in, carrying `next` so a link out
 *   of a notification email still lands where it was going.
 *
 * The local cookie is still read (lib/session.ts) — nothing mints new ones,
 * so the existing ones drain on their own.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // A path on this portal only: never somewhere else by way of ?next=.
  const path = next && next.startsWith("/") && !next.startsWith("//") ? next : "/risansi/dashboard";

  if (await isAuthenticated()) redirect(path);

  const shared = await getSharedSession();
  if (shared) {
    const refusal = await getAccessRefusal();
    return (
      <HubNotice
        title="No access to SO to Dispatch"
        tone="danger"
        message={`You are signed in to Risansi Digital as ${shared.email}. ${
          refusal ?? "SO to Dispatch could not open your account. Ask for access from Risansi Digital."
        }`}
        actions={[
          { label: "Back to Risansi Digital", href: HUB_URL, primary: true },
          { label: "Sign in as someone else", href: HUB_SIGN_OUT_URL },
        ]}
      />
    );
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  redirect(hubSignInUrl(host ? `${proto}://${host}${path}` : undefined));
}
