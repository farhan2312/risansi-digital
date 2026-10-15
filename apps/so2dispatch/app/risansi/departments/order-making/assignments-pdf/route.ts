import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canAssignSo } from "@/lib/roles";
import { parseAssignPeriod } from "@/lib/so-assignment";
import { buildSoAssignmentPdf } from "@/lib/so-assignment-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which SOs are assigned to which Order Making SO member, as a PDF grid —
 * today's (default) or all time. For those who assign: Order Making PO,
 * Central Visibility and Admin.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAssignSo(user.role)) return new Response("Forbidden", { status: 403 });
  const period = parseAssignPeriod(req.nextUrl.searchParams.get("period") ?? undefined);
  const bytes = await buildSoAssignmentPdf(period);
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Response(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="so-assignment-${period}-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
