import { getCurrentUser } from "@/lib/session";
import { canAssignSo } from "@/lib/roles";
import { buildSoAssignmentPdf } from "@/lib/so-assignment-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which SOs were assigned to which Order Making SO member today, as a PDF
 * grid — the day's assignments only. For those who assign: Order Making PO,
 * Central Visibility and Admin.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !canAssignSo(user.role)) return new Response("Forbidden", { status: 403 });
  const bytes = await buildSoAssignmentPdf("daily");
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Response(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      // Shown in the pop-up; ?download=1 saves it.
      "Content-Disposition": `${new URL(req.url).searchParams.get("download") ? "attachment" : "inline"}; filename="so-assignment-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
