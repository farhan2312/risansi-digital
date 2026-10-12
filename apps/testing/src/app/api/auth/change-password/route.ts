/**
 * Gone. Passwords are changed at Risansi Digital.
 *
 * Phase 4b. This wrote `users.password_hash`, which nothing reads any more,
 * so a successful-looking response here would have been a lie: somebody
 * would set a new password, be told it worked, and find the old one still
 * signing them in. Worse than an error, because it looks like success.
 *
 * Five accounts were flagged `must_change_password` in this app's own table
 * when the form went. That flag is read from the shared session now, not from
 * the column, so none of them are pinned to a screen that no longer exists.
 */
import { NextResponse } from "next/server";

const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

export async function POST() {
  return NextResponse.json(
    {
      error: "Passwords are changed at Risansi Digital.",
      changePasswordUrl: `${HUB}/change-password`,
    },
    { status: 410 },
  );
}
