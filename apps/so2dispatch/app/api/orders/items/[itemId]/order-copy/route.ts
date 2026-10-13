import { getCurrentUser } from "@/lib/session";
import { getItemOrderCopy } from "@/lib/orders";

export const runtime = "nodejs";

/** Download the Order Copy file uploaded on a Spare EC. Any signed-in user
 *  may fetch (files are non-sensitive purchase docs; can tighten if needed). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { itemId } = await params;
  const file = await getItemOrderCopy(itemId);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.file_data), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.file_name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
