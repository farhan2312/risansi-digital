import { getCurrentUser } from "@/lib/session";
import { getInvoiceLrFile } from "@/lib/orders";

export const runtime = "nodejs";

/** Download an invoice's LR / docket attachment. Any signed-in user. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { invoiceId } = await params;
  const file = await getInvoiceLrFile(invoiceId);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.file_data), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.file_name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
