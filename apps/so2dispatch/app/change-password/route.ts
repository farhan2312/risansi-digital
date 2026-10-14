import { NextResponse } from "next/server";
import { HUB_CHANGE_PASSWORD_URL } from "@/lib/hub";

// Passwords are changed at Risansi Digital (Phase 5, step 7). A route rather
// than a link to the hub straight from the menu: HUB_URL is a server
// variable, and this keeps the address in one place.
export function GET() {
  return NextResponse.redirect(HUB_CHANGE_PASSWORD_URL);
}
