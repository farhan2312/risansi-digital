import { readFile } from "node:fs/promises";
import path from "node:path";

import { error } from "@/lib/api";
import { ADMIN_DOCS } from "@/lib/adminDocs";
import { AuthError, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Sends one of the documentation PDFs. Admin only; the name is matched against the fixed list in
 * lib/adminDocs.ts, never used as a path, so nothing outside /private-docs can be read.
 * `?download=1` makes the browser save it instead of showing it. */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { name } = await params;
  const doc = ADMIN_DOCS.find((d) => d.slug === name);
  if (!doc) return error("Document not found", 404);

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(process.cwd(), "private-docs", doc.file));
  } catch {
    return error("Document file is missing on the server", 404);
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.downloadName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
