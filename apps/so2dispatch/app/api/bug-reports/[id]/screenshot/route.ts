import { getCurrentUser } from "@/lib/session";
import { getBugReportScreenshot } from "@/lib/bug-reports";

export const runtime = "nodejs";

/** Download a bug report's screenshot: the admin, or whoever reported it. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const file = await getBugReportScreenshot(id);
  // Someone else's report reads as missing, not forbidden: its existence is
  // none of their business either.
  if (!file || (user.role !== "admin" && file.user_id !== user.id)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(file.file_data), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.file_name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
