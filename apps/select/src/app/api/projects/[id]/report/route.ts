import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fetches the saved final Selection Summary PDF's raw bytes, for direct
// download — same pattern as the MOC document route, kept separate since
// it's a different artifact stored on `projects` itself, not a wizard-input
// child table.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  const [row] = await db
    .select({
      reportDocument: projects.reportDocument,
      reportFilename: projects.reportFilename,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!row || !row.reportDocument) {
    return error("No saved report for this project", 404);
  }

  const filename = row.reportFilename || "Selection-Summary.pdf";
  return new Response(new Uint8Array(row.reportDocument), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(row.reportDocument.length),
    },
  });
}

// Uploads the final Selection Summary PDF's raw bytes (Content-Type:
// application/pdf body, not JSON) — called when the user clicks "Confirm
// Pump Selection" on the last wizard step. The project row always already
// exists by this point, so this is a plain UPDATE, not an upsert.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  const filename = new URL(req.url).searchParams.get("filename") || "Selection-Summary.pdf";

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return error("Request body is empty", 400);

  // Project lifecycle: generating the final report means the selection is
  // done — always moves to "Completed" (unlike the Pending -> In Progress
  // flip, this one isn't conditional; confirming a selection is a stronger
  // signal than just touching a field).
  const [updated] = await db
    .update(projects)
    .set({
      reportDocument: bytes,
      reportFilename: filename,
      reportGeneratedAt: new Date(),
      status: "Completed",
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning({
      id: projects.id,
      reportFilename: projects.reportFilename,
      reportGeneratedAt: projects.reportGeneratedAt,
    });

  if (!updated) return error("Project not found", 404);

  return json(updated, 201);
}
