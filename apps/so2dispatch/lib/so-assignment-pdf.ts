import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { query } from "@/lib/db";
import { sanitize, wrap } from "@/lib/pdf-text";
import { SO_DETAILS_FILLED_SQL } from "@/lib/order-gaps";
import { orderOpenSql } from "@/lib/dept-view";
import type { AssignPeriod } from "@/lib/so-assignment";

/** One SO in the assignment grid. */
type Row = {
  member: string | null;
  so_no: string | null;
  sl_no: number;
  so_date: string | null;
  client_name: string | null;
  order_type: string | null;
  assigned_on: string | null;
  created_on: string | null;
  filled: boolean;
};

/** "Today" in the business's own calendar. */
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;

/**
 * The SOs and who their Sales Order details are assigned to, as a grid —
 * one table per Order Making SO member, then the unassigned ones. Daily: the
 * SOs assigned today, and the open ones made today that nobody has yet.
 */
export async function buildSoAssignmentPdf(period: AssignPeriod): Promise<Uint8Array> {
  const daily = period === "daily";
  const r = await query<Row>(
    `SELECT u.full_name AS member, o.so_no, o.sl_no::int AS sl_no,
            to_char(o.so_date, 'DD Mon YYYY') AS so_date, o.client_name, o.order_type,
            to_char(o.so_assigned_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS assigned_on,
            to_char(o.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS created_on,
            (${SO_DETAILS_FILLED_SQL}) AS filled
       FROM orders o
       LEFT JOIN users u ON u.id = o.so_assignee_id
      WHERE ${orderOpenSql("o")}
        ${
          daily
            ? `AND ((o.so_assignee_id IS NOT NULL AND (o.so_assigned_at AT TIME ZONE 'Asia/Kolkata')::date = ${TODAY_SQL})
                 OR (o.so_assignee_id IS NULL AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = ${TODAY_SQL}))`
            : ""
        }
      ORDER BY u.full_name NULLS LAST, o.so_assigned_at DESC NULLS LAST, o.sl_no DESC`
  );

  const groups = new Map<string, Row[]>();
  for (const row of r.rows) {
    const key = row.member ?? "Unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842;
  const H = 595; // A4 landscape
  const M = 32;
  const cols = [
    { label: "Sl. No.", w: 50 },
    { label: "SO No.", w: 110 },
    { label: "SO Date", w: 75 },
    { label: "Client", w: 260 },
    { label: "Type", w: 55 },
    { label: daily ? "Assigned / made" : "Assigned on", w: 95 },
    { label: "SO details", w: 133 },
  ];
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.42, 0.46);
  const line = rgb(0.85, 0.85, 0.88);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (p: PDFPage, s: string, x: number, yy: number, f: PDFFont, size: number, color = ink) =>
    p.drawText(sanitize(s, f), { x, y: yy, size, font: f, color });

  const stamp = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const header = () => {
    text(page, "SO details assignment", M, y, bold, 15);
    text(page, `${daily ? "Today" : "All time"} · ${r.rows.length} SOs · ${stamp}`, M, y - 16, font, 9, muted);
    y -= 34;
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const headRow = () => {
    let x = M;
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: rgb(0.94, 0.95, 0.97) });
    for (const c of cols) {
      text(page, c.label, x + 4, y, bold, 8.5, muted);
      x += c.w;
    }
    y -= 18;
  };

  header();
  if (r.rows.length === 0) {
    text(page, daily ? "Nothing assigned or made today." : "No open SOs.", M, y, font, 10, muted);
  }
  for (const [member, rows] of groups) {
    const filled = rows.filter((x) => x.filled).length;
    if (y < M + 60) newPage();
    text(page, member, M, y, bold, 11.5);
    text(
      page,
      member === "Unassigned" ? `${rows.length} SOs` : `${rows.length} assigned · ${rows.length - filled} pending · ${filled} filled`,
      M + bold.widthOfTextAtSize(sanitize(member, bold), 11.5) + 10,
      y,
      font,
      9,
      muted
    );
    y -= 18;
    headRow();
    for (const row of rows) {
      const client = wrap(row.client_name ?? "—", font, 8.5, cols[3].w - 8);
      // The row: its lines 11pt apart, 5pt clear above and below its rule.
      const h = Math.max(1, client.length) * 11 + 8;
      if (y - h < M) {
        newPage();
        text(page, `${member} (continued)`, M, y, bold, 10);
        y -= 16;
        headRow();
      }
      const cells = [
        String(row.sl_no),
        row.so_no ?? "—",
        row.so_date ?? "—",
        "",
        row.order_type ?? "—",
        (row.member ? row.assigned_on : row.created_on) ?? "—",
        row.filled ? "Filled" : "Pending",
      ];
      let x = M;
      cells.forEach((c, i) => {
        if (i === 3) {
          client.forEach((l, k) => text(page, l, x + 4, y - k * 11, font, 8.5));
        } else {
          const color = i === 6 ? (row.filled ? rgb(0.02, 0.47, 0.34) : rgb(0.71, 0.38, 0.03)) : ink;
          text(page, c, x + 4, y, i === 6 ? bold : font, 8.5, color);
        }
        x += cols[i].w;
      });
      const rule = y - (Math.max(1, client.length) - 1) * 11 - 5;
      page.drawLine({ start: { x: M, y: rule }, end: { x: W - M, y: rule }, thickness: 0.4, color: line });
      y -= h + 3;
    }
    y -= 12;
  }
  return pdf.save();
}
