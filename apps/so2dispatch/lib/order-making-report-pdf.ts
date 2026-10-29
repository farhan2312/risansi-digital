import "server-only";
// Order Making's report as a PDF: A4 landscape, a navy title band, then one
// row per SO — its Sales Order and ECs each with their dates — as the
// on-page panel lays it out.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sanitize, wrap } from "@/lib/pdf-text";
import { blocksOf, type ReportShape, type SoBlock } from "@/lib/order-making-blocks";

const W = 842;
const H = 595;
const M = 24;
const NAVY = rgb(0.122, 0.22, 0.392);
const NAVY_2 = rgb(0.184, 0.329, 0.588);
const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.45, 0.47, 0.52);
const FAINT = rgb(0.75, 0.77, 0.8);
const RULE = rgb(0.9, 0.91, 0.93);
const STRIPE = rgb(0.973, 0.976, 0.984);
const HEAD_BG = rgb(0.953, 0.957, 0.965);
const GREEN = rgb(0.02, 0.47, 0.34);
const AMBER = rgb(0.6, 0.33, 0.03);
const ROSE = rgb(0.75, 0.13, 0.2);

const SIZE = 7.6;
const LINE = 9.6;

export async function buildOrderMakingReportPdf(report: ReportShape & { scope: string }): Promise<Uint8Array> {
  const blocks = blocksOf(report);
  const withOps = report.columns.some((c) => c.header === "SO Sent to Operation");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cols: { label: string; w: number }[] = [
    { label: "PO RECEIVED", w: 58 },
    { label: "CLIENT", w: 140 },
    { label: "TYPE", w: 58 },
    { label: "SALES ORDER", w: 78 },
    { label: "ECS", w: 112 },
    ...(withOps ? [{ label: "SENT TO OPERATION", w: 80 }] : []),
    { label: "ASSIGNED TO", w: 70 },
    { label: "REASON FOR DELAY", w: 0 },
    { label: "REMARKS", w: 0 },
  ];
  const fixed = cols.reduce((t, c) => t + c.w, 0);
  const flex = (W - 2 * M - fixed) / 2;
  for (const c of cols) if (c.w === 0) c.w = flex;

  const ecCount = blocks.reduce((t, b) => t + b.ecs.length, 0);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const pages: PDFPage[] = [page];

  const text = (s: string, x: number, yy: number, f: PDFFont, size: number, color = INK) =>
    page.drawText(sanitize(s, f), { x, y: yy, size, font: f, color });

  const titleBand = () => {
    const h = 44;
    page.drawRectangle({ x: M, y: y - h, width: W - 2 * M, height: h, color: NAVY });
    page.drawRectangle({ x: W / 2, y: y - h, width: W / 2 - M, height: h, color: NAVY_2, opacity: 0.55 });
    text("RISANSI · ORDER MAKING", M + 14, y - 15, bold, 7, rgb(0.78, 0.82, 0.9));
    text("Order Making report", M + 14, y - 32, bold, 14, rgb(1, 1, 1));
    const right = [report.scope, `${ecCount} ECs`];
    right.forEach((s, i) => {
      const t = sanitize(s, font);
      text(t, W - M - 14 - font.widthOfTextAtSize(t, 8), y - 17 - i * 12, font, 8, rgb(0.86, 0.89, 0.95));
    });
    y -= h + 8;
  };
  const headRow = () => {
    page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 18, color: HEAD_BG });
    let x = M;
    for (const c of cols) {
      text(c.label, x + 5, y - 8, bold, 6.4, MUTED);
      x += c.w;
    }
    y -= 20;
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
    headRow();
  };

  // One cell's lines: [text, font, colour] each.
  type Ln = [string, PDFFont, ReturnType<typeof rgb>];
  const cellLines = (b: SoBlock, label: string, w: number): Ln[] => {
    const fit = (s: string, f: PDFFont, color: ReturnType<typeof rgb>): Ln[] => wrap(s, f, SIZE, w - 10).map((l) => [l, f, color]);
    switch (label) {
      case "PO RECEIVED":
        return b.poDate ? [[b.poDate, font, MUTED]] : [["—", font, FAINT]];
      case "CLIENT":
        return fit(b.client || "—", bold, INK);
      case "TYPE":
        return [
          ...(b.orderType ? ([[b.orderType, bold, /pump|rolb/i.test(b.orderType) ? rgb(0.26, 0.22, 0.79) : rgb(0.06, 0.46, 0.43)]] as Ln[]) : []),
          ...(b.billMode ? fit(b.billMode, font, MUTED) : []),
        ];
      case "SALES ORDER":
        return [[b.soNo || "—", bold, INK], ...(b.soDate ? ([[b.soDate, font, MUTED]] as Ln[]) : [])];
      case "ECS":
        return b.ecs.length
          ? b.ecs.flatMap((e) => [[e.no, font, INK] as Ln, ...(e.date ? ([[e.date, font, FAINT]] as Ln[]) : [])])
          : [["No EC yet", font, FAINT]];
      case "SENT TO OPERATION":
        return b.sentToOps === "HOLD" ? [["HOLD", bold, ROSE]] : b.sentToOps ? [[b.sentToOps, font, GREEN]] : [["Not yet", font, FAINT]];
      case "ASSIGNED TO":
        return b.assigned ? fit(b.assigned, font, b.assigned === "Migrated" ? FAINT : INK) : [["—", font, FAINT]];
      case "REASON FOR DELAY":
        return b.reason ? b.reason.split("\n").flatMap((p) => fit(p, font, AMBER)) : [["—", font, FAINT]];
      default:
        return b.remarks ? b.remarks.split("\n").flatMap((p) => fit(p, font, INK)) : [["—", font, FAINT]];
    }
  };

  titleBand();
  headRow();
  if (blocks.length === 0) text("No SOs match the filters.", M + 5, y - 6, font, 9, MUTED);
  blocks.forEach((b, i) => {
    const cells = cols.map((c) => cellLines(b, c.label, c.w));
    const h = Math.max(...cells.map((c) => c.length)) * LINE + 8;
    if (y - h < M + 14) newPage();
    if (i % 2) page.drawRectangle({ x: M, y: y - h, width: W - 2 * M, height: h, color: STRIPE });
    let x = M;
    cells.forEach((lines, ci) => {
      lines.forEach(([s, f, color], k) => text(s, x + 5, y - 9 - k * LINE, f, SIZE, color));
      x += cols[ci].w;
    });
    page.drawLine({ start: { x: M, y: y - h }, end: { x: W - M, y: y - h }, thickness: 0.4, color: RULE });
    y -= h;
  });

  // Page numbers, bottom right.
  pages.forEach((p, i) => {
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 7), y: M - 12, size: 7, font, color: MUTED });
  });
  return pdf.save();
}
