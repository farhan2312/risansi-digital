import { desc } from "drizzle-orm";
import PDFDocument from "pdfkit";

import { error } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { parseAuditWindow, windowCondition } from "@/lib/auditRange";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Safety cap -- an all-time export of a busy log shouldn't be able to pull
 * the whole table into one response. */
const MAX_ROWS = 5_000;

const istStamp = (d: Date | null) =>
  d ? new Date(d.getTime() + 330 * 60_000).toISOString().replace("T", " ").slice(0, 16) : "";

const EVENT_LABEL: Record<string, string> = {
  login: "Sign-in",
  login_failed: "Failed sign-in",
  logout: "Sign-out",
  create: "Created",
  update: "Updated",
  delete: "Deleted",
};

const cell = (v: unknown): string => (v === null || v === undefined || v === "" ? "-" : String(v));

/** "Generate Report" on the Audit Log page: the selected date range's events
 * as a PDF, newest first -- a printable record for handing to someone who
 * doesn't have a portal login, same rows the CSV export used to cover. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const window = parseAuditWindow(new URL(req.url).searchParams);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(windowCondition(auditLogs.createdAt, window))
    .orderBy(desc(auditLogs.createdAt))
    .limit(MAX_ROWS);

  const fromLabel = window.fromDay ?? "the beginning";
  const toLabel = window.toDay ?? "today";

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // ---- Columns: [label, x, width] across the landscape page width (A4 landscape minus 2x36 margin = ~750pt). ----
  const columns = [
    { label: "Time (IST)", width: 92 },
    { label: "Event", width: 64 },
    { label: "User", width: 130 },
    { label: "Entity", width: 130 },
    { label: "Details", width: 240 },
    { label: "IP address", width: 90 },
  ];
  const tableLeft = doc.page.margins.left;
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const colX: number[] = [];
  {
    let x = tableLeft;
    for (const c of columns) {
      colX.push(x);
      x += c.width;
    }
  }

  const drawHeader = () => {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
    const y = doc.y;
    doc.rect(tableLeft, y, tableWidth, 18).fill("#132240");
    doc.fillColor("#ffffff");
    columns.forEach((c, i) => doc.text(c.label, colX[i] + 4, y + 5, { width: c.width - 8, lineBreak: false }));
    doc.y = y + 18;
    doc.fillColor("#0f172a");
  };

  // ---- Title block ----
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#132240").text("Risansi Industries Ltd — Audit Log Report", { align: "left" });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#475569")
    .text(`Range: ${fromLabel} to ${toLabel}  ·  Generated: ${istStamp(new Date())} IST  ·  By: ${claims.email}`);
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`${rows.length.toLocaleString()} event${rows.length === 1 ? "" : "s"}${rows.length === MAX_ROWS ? " (capped)" : ""}`);
  doc.moveDown(0.5);

  drawHeader();
  doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a");

  let rowIndex = 0;
  for (const r of rows) {
    const values = [
      istStamp(r.createdAt),
      EVENT_LABEL[r.eventType] ?? r.eventType,
      [cell(r.userName), r.userEmail ? `(${r.userEmail})` : ""].filter(Boolean).join(" "),
      [r.entityType ? r.entityType.replace(/_/g, " ") : null, r.entityLabel].filter(Boolean).join(": ") || "-",
      cell(r.details),
      cell(r.ipAddress),
    ];
    const heights = values.map((v, i) => doc.heightOfString(v, { width: columns[i].width - 8 }));
    const rowHeight = Math.max(14, ...heights) + 6;

    // New page once the row wouldn't fit above the bottom margin -- redraw the header on each page.
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
      doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a");
    }

    const y = doc.y;
    if (rowIndex % 2 === 1) doc.rect(tableLeft, y, tableWidth, rowHeight).fill("#f1f5f9").fillColor("#0f172a");
    values.forEach((v, i) => doc.text(v, colX[i] + 4, y + 3, { width: columns[i].width - 8 }));
    doc.y = y + rowHeight;
    rowIndex++;
  }

  // Page numbers, now that the total page count is known. The footer sits in the bottom margin (below
  // the last content row) -- pdfkit's text() silently inserts a whole extra blank page whenever it thinks
  // a write doesn't fit above doc.page.margins.bottom, which it does here on every single page, doubling
  // the page count. Zeroing the bottom margin for just this write is the standard workaround.
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#94a3b8")
      .text(`Page ${i + 1} of ${pageCount}`, tableLeft, doc.page.height - bottomMargin + 8, {
        width: tableWidth,
        align: "right",
        lineBreak: false,
      });
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  const pdf = await done;

  const label = `${window.fromDay ?? "start"}_to_${window.toDay ?? "today"}`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="audit-log_${label}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
