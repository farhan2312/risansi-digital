/**
 * Gone. Accounts are managed at Risansi Digital.
 *
 * Phase 4b. Creating somebody, changing their role, resetting a password and
 * switching an account off all happen at digital.risansi.com/requests/people
 * now. They used to exist here and in two other portals as well, which meant
 * the same job had four implementations, the one that got used depended on who
 * you asked, and switching somebody off properly meant remembering all four.
 *
 * Worse than duplication: this portal can no longer decide any of it. Whether
 * somebody may open it is read from identity.app_grants per request, so a role
 * written into this table would be overwritten on the next page load and a
 * password set here would sign nobody in.
 *
 * Answered rather than deleted — a cached client bundle or an open tab will
 * still call it, and a 410 naming the new address is more use than a 404.
 *
 * Requesting access is a tile on the hub now.
 */
import { NextResponse } from "next/server";

const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

function gone() {
  return NextResponse.json(
    {
      error: "Accounts are managed at Risansi Digital.",
      manageUrl: `${HUB}/requests/people`,
    },
    { status: 410 },
  );
}

export async function GET() {
  return gone();
}

export async function POST() {
  return gone();
}
