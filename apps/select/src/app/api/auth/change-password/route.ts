/**
 * Gone. Passwords are changed at Risansi Digital.
 *
 * Phase 4b. This wrote `users_pump.password_hash`, which nothing reads any
 * more, so a success here would have been a lie. The forced-change flag is
 * read from the shared session now rather than from this app's column, so
 * nobody is left pinned to a screen that no longer exists.
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
