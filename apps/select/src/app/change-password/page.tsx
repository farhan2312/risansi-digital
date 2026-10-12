/**
 * Changing a password happens at Risansi Digital.
 *
 * Phase 4b. The form that was here wrote `users_pump.password_hash`, which
 * nothing reads any more — so leaving it would let somebody set a new
 * password, be told it worked, and find the old one still signing them in.
 * That is worse than an error, because it looks like success.
 *
 * Kept as a redirect rather than deleted: it is linked from older notification
 * emails and people have it bookmarked. Middleware forwards this path too;
 * this file is the belt to that braces, for any request that reaches the page
 * without passing the matcher.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

export default async function ChangePasswordRedirect() {
  redirect(`${HUB}/change-password`);
}
