import { getCurrentUser } from "@/lib/session";
import { canAccessDepartment } from "@/lib/roles";
import { getQcDocumentFile } from "@/lib/orders";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !canAccessDepartment(user.role, "order_qc")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const file = await getQcDocumentFile(id);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(file.file_data), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.file_name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
