import { getCurrentUser } from "@/lib/session";
import { canAssignSo } from "@/lib/roles";
import { buildSoAssignmentPdf } from "@/lib/so-assignment-pdf";
import { parseAssignWindow } from "@/lib/so-assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which SOs were assigned to which Order Making SO member today — or over a
 * range of days (?period=range&pfrom=&pto=) — as a PDF grid. For those who
 * assign: Order Making PO, Central Visibility and Admin.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !canAssignSo(user.role)) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const w = parseAssignWindow(sp.get("period") === "range" ? "range" : undefined, sp.get("pfrom"), sp.get("pto"));
  const bytes = await buildSoAssignmentPdf(w);
  const stamp = w.from === w.to ? w.from : `${w.from}-to-${w.to}`;
  return new Response(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      // Shown in the pop-up; ?download=1 saves it.
      "Content-Disposition": `${new URL(req.url).searchParams.get("download") ? "attachment" : "inline"}; filename="so-assignment-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
