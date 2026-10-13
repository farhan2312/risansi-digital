import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { sanitize, wrap } from "@/lib/pdf-text";
import {
  ASSEMBLY_ORDER,
  PLANNING_ORDER,
  countBy,
  summaryOf,
  type SpareSoRow,
  type SparesReport,
} from "@/lib/spares-report";
import {
  ACTIVITY_SERIES,
  OTHER_STATUS_COLOR,
  SPARE_DISPATCH_STATUSES,
  SPARE_STAGES,
  STATUS_COLORS,
  describeSparesReportFilter,
  shortDate,
  type SpareStage,
} from "@/lib/spares-report-filter";

// The Spares report on paper, for Mitali to send on: page one is the picture
// — work done in the period, where the SOs stand, the status split, the
// period bucket by bucket, how long ready SOs have waited — and the pages
// after it list every SO behind those numbers.

// A4 landscape, in points.
const PAGE = { w: 842, h: 595 };
const MARGIN = 36;
const WIDTH = PAGE.w - MARGIN * 2;
const BOTTOM = MARGIN + 16;

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function hex(color: string): RGB {
  const n = parseInt(color.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const TILE = rgb(0.95, 0.96, 0.97);
const RED = rgb(0.85, 0.15, 0.2);
const GREEN = hex("#10b981");
const AMBER_BG = hex("#fef3c7");
const AMBER_INK = hex("#92400e");
const ROSE_BG = hex("#ffe4e6");
const ROSE_INK = hex("#be123c");

const STAGE_SORT: Record<SpareStage, (a: SpareSoRow, b: SpareSoRow) => number> = {
  to_pack: (a, b) => (b.waiting_days ?? -1) - (a.waiting_days ?? -1) || b.pack_overdue - a.pack_overdue,
  packed: (a, b) => (a.packed_on ?? "9").localeCompare(b.packed_on ?? "9"),
  not_ready: (a, b) => (a.readiness_date ?? "9").localeCompare(b.readiness_date ?? "9"),
  dispatched: (a, b) => (b.dispatched_on ?? "").localeCompare(a.dispatched_on ?? ""),
};

type Column = { label: string; width: number; align?: "right" };

export async function buildSparesReportPdf(report: SparesReport): Promise<Uint8Array> {
  const { rows, activity, filter } = report;
  const sum = summaryOf(rows);

  const pdf = await PDFDocument.create();
  pdf.setTitle("Spares report");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const text = (s: string, x: number, at: number, size: number, f: PDFFont = font, color: RGB = INK) =>
    page.drawText(sanitize(s, f), { x, y: at, size, font: f, color });
  const textRight = (s: string, right: number, at: number, size: number, f: PDFFont = font, color: RGB = INK) => {
    const t = sanitize(s, f);
    page.drawText(t, { x: right - f.widthOfTextAtSize(t, size), y: at, size, font: f, color });
  };
  const label = (s: string, x: number, at: number) => text(s.toUpperCase(), x, at, 7, bold, MUTED);

  // ── Title ────────────────────────────────────────────────────────────────
  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  text("Spares report", MARGIN, y - 16, 16, bold);
  const sub = wrap(`${describeSparesReportFilter(filter)}  ·  generated ${generated} IST`, font, 8.5, WIDTH);
  sub.forEach((l, n) => text(l, MARGIN, y - 30 - n * 10, 8.5, font, MUTED));
  y -= 44 + (sub.length - 1) * 10;

  // ── 1. Work done in the period ───────────────────────────────────────────
  label(`Work done · ${shortDate(filter.from)} – ${shortDate(filter.to)}`, MARGIN, y - 7);
  y -= 13;
  const tiles = [
    { label: "SOs created", by: "Order Making", value: activity.created.length },
    { label: "PIs raised", by: "Billing", value: activity.pis.length },
    { label: "Payments confirmed", by: "Accounts", value: activity.payments.length },
    { label: "SOs made ready", by: "Planning", value: activity.readySos },
    { label: "SOs packed", by: "Assembly & Packing", value: activity.packedSos },
    { label: "SOs dispatched", by: "Dispatch", value: activity.dispatchedSos },
  ];
  const tileGap = 8;
  const tileW = (WIDTH - tileGap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = MARGIN + i * (tileW + tileGap);
    page.drawRectangle({ x, y: y - 44, width: tileW, height: 44, color: TILE });
    text(t.label, x + 8, y - 12, 7.5, bold, MUTED);
    text(String(t.value), x + 8, y - 30, 16, bold);
    text(t.by, x + 8, y - 40, 6.5, font, MUTED);
  });
  y -= 58;

  // ── 2. Where they stand today ────────────────────────────────────────────
  label("Where they stand today", MARGIN, y - 7);
  y -= 14;
  const total = Math.max(1, sum.pipeline[0].count);
  const barX = MARGIN + 92;
  const barMax = 300;
  sum.pipeline.forEach((p, i) => {
    const at = y - i * 17;
    text(p.label, MARGIN, at - 10, 8, font, MUTED);
    page.drawRectangle({ x: barX, y: at - 14, width: barMax, height: 13, color: TILE });
    const w = Math.max(4, (p.count / total) * barMax);
    page.drawRectangle({ x: barX, y: at - 14, width: w, height: 13, color: i === 0 ? hex("#cbd5e1") : GREEN });
    text(String(p.count), barX + w + 4, at - 10.5, 8, bold);
  });
  // What is held up, beside the pipeline.
  const holds = [
    { label: "Ready, waiting to pack", value: sum.toPack, bg: AMBER_BG, ink: AMBER_INK },
    { label: "Packed, waiting to dispatch", value: sum.packedWaiting, bg: AMBER_BG, ink: AMBER_INK },
    { label: "Overdue for packing", value: sum.packOverdue, bg: ROSE_BG, ink: ROSE_INK },
    { label: "Not ready yet", value: sum.notReady, bg: TILE, ink: INK },
  ];
  const holdX = MARGIN + 450;
  const holdW = (WIDTH - 450 - tileGap) / 2;
  holds.forEach((h, i) => {
    const x = holdX + (i % 2) * (holdW + tileGap);
    const top = y - Math.floor(i / 2) * 34;
    page.drawRectangle({ x, y: top - 30, width: holdW, height: 30, color: h.bg });
    text(String(h.value), x + 8, top - 20, 13, bold, h.ink);
    text(h.label, x + 8 + bold.widthOfTextAtSize(String(h.value), 13) + 6, top - 18, 8, font, h.ink);
  });
  y -= 4 * 17 + 10;

  // ── 3. Status split ──────────────────────────────────────────────────────
  const pies: { title: string; parts: { label: string; count: number; color: string }[] }[] = [
    {
      title: "Planning status",
      parts: countBy(rows, "planning_status", PLANNING_ORDER).map((p) => ({
        ...p,
        color: STATUS_COLORS[`planning:${p.label}`] ?? OTHER_STATUS_COLOR,
      })),
    },
    {
      title: "Assembly & Packing status",
      parts: countBy(rows, "assembly_status", ASSEMBLY_ORDER).map((p) => ({
        ...p,
        color: STATUS_COLORS[`assembly:${p.label}`] ?? OTHER_STATUS_COLOR,
      })),
    },
    {
      title: "Dispatch status",
      parts: countBy(rows, "dispatch_status", SPARE_DISPATCH_STATUSES).map((p) => ({
        ...p,
        color: STATUS_COLORS[`dispatch:${p.label}`] ?? OTHER_STATUS_COLOR,
      })),
    },
  ];
  const pieW = WIDTH / 3;
  const R = 34;
  pies.forEach((pie, i) => {
    const x0 = MARGIN + i * pieW;
    label(pie.title, x0, y - 7);
    const cx = x0 + R + 2;
    const cy = y - 16 - R;
    const n = pie.parts.reduce((s, p) => s + p.count, 0);
    if (n === 0) {
      page.drawCircle({ x: cx, y: cy, size: R, color: TILE });
    } else {
      let a0 = -Math.PI / 2;
      for (const p of pie.parts) {
        if (!p.count) continue;
        const sweep = (p.count / n) * Math.PI * 2;
        if (sweep >= Math.PI * 2 - 1e-6) {
          page.drawCircle({ x: cx, y: cy, size: R, color: hex(p.color) });
        } else {
          const a1 = a0 + sweep;
          // drawSvgPath reads y downward from its origin, so angles run clockwise.
          const x1 = R * Math.cos(a0);
          const y1 = R * Math.sin(a0);
          const x2 = R * Math.cos(a1);
          const y2 = R * Math.sin(a1);
          const large = sweep > Math.PI ? 1 : 0;
          page.drawSvgPath(`M 0 0 L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`, {
            x: cx,
            y: cy,
            color: hex(p.color),
          });
          a0 = a1;
        }
      }
    }
    page.drawCircle({ x: cx, y: cy, size: R * 0.55, color: rgb(1, 1, 1) });
    const totalText = String(n);
    text(totalText, cx - bold.widthOfTextAtSize(totalText, 11) / 2, cy - 4, 11, bold);
    // Legend.
    const lx = x0 + R * 2 + 14;
    pie.parts.forEach((p, k) => {
      const ly = y - 20 - k * 11;
      page.drawRectangle({ x: lx, y: ly - 1, width: 7, height: 7, color: hex(p.color) });
      text(p.label, lx + 11, ly, 7.5, font, MUTED);
      textRight(String(p.count), x0 + pieW - 14, ly, 7.5, bold);
      textRight(`${Math.round((p.count / Math.max(1, n)) * 100)}%`, x0 + pieW - 34 - 8, ly, 7, font, MUTED);
    });
  });
  y -= 16 + R * 2 + 14;

  // ── 4. Period chart and 5. waiting to pack ───────────────────────────────
  const chartW = WIDTH * 0.64;
  const chartH = Math.max(90, y - BOTTOM - 22);
  label(activity.bucketBy === "week" ? "Week by week" : "Month by month", MARGIN, y - 7);
  // Legend on the same line.
  let legX = MARGIN + 110;
  for (const s of ACTIVITY_SERIES) {
    page.drawRectangle({ x: legX, y: y - 8, width: 7, height: 7, color: hex(s.color) });
    text(s.label, legX + 10, y - 7, 7, font, MUTED);
    legX += 16 + font.widthOfTextAtSize(s.label, 7);
  }
  const buckets = activity.buckets;
  const max = Math.max(1, ...buckets.flatMap((b) => ACTIVITY_SERIES.map((s) => b[s.key])));
  const step = Math.max(1, Math.ceil(max / 4 / 5) * 5);
  const yMax = step * 4;
  const plotLeft = MARGIN + 20;
  const plotTop = y - 16;
  const plotBottom = plotTop - chartH + 14;
  const plotW = chartW - 20;
  const py = (v: number) => plotBottom + (plotTop - plotBottom) * (v / yMax);
  for (let i = 0; i <= 4; i++) {
    page.drawLine({ start: { x: plotLeft, y: py(step * i) }, end: { x: plotLeft + plotW, y: py(step * i) }, thickness: 0.4, color: RULE });
    textRight(String(step * i), plotLeft - 4, py(step * i) - 2.5, 6.5, font, MUTED);
  }
  const groupW = plotW / Math.max(1, buckets.length);
  const barW = Math.min(9, (groupW * 0.8) / ACTIVITY_SERIES.length);
  buckets.forEach((b, gi) => {
    const gx = plotLeft + gi * groupW + (groupW - barW * ACTIVITY_SERIES.length) / 2;
    ACTIVITY_SERIES.forEach((s, si) => {
      const v = b[s.key];
      if (v > 0) {
        page.drawRectangle({ x: gx + si * barW, y: plotBottom, width: barW - 1, height: py(v) - plotBottom, color: hex(s.color) });
      }
    });
    const lab = sanitize(b.label, font);
    const lw = font.widthOfTextAtSize(lab, 6.5);
    text(lab, plotLeft + gi * groupW + groupW / 2 - lw / 2, plotBottom - 9, 6.5, font, MUTED);
  });

  const ax = MARGIN + chartW + 24;
  const aw = WIDTH - chartW - 24;
  label("Waiting to pack · days since ready", ax, y - 7);
  const ageMax = Math.max(1, ...report.ageing.map((a) => a.count));
  const ageTone: Record<string, RGB> = {
    ok: hex("#fde68a"),
    warn: hex("#fbbf24"),
    late: hex("#fb7185"),
    none: hex("#e2e8f0"),
  };
  report.ageing.forEach((a, i) => {
    const at = y - 18 - i * 16;
    text(a.label, ax, at - 9, 7.5, font, MUTED);
    const bx = ax + 78;
    const bw = (aw - 78 - 22) * (a.count / ageMax);
    if (a.count) page.drawRectangle({ x: bx, y: at - 12, width: Math.max(2, bw), height: 11, color: ageTone[a.tone] });
    text(String(a.count), bx + Math.max(2, bw) + 4, at - 9, 7.5, bold);
  });

  // ── 6. The lists ─────────────────────────────────────────────────────────
  const newPage = () => {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - MARGIN;
  };

  function table(title: string, columns: Column[], lines: string[][], tone?: (row: number, col: number) => RGB | null) {
    const header = () => {
      let cx = MARGIN;
      for (const c of columns) {
        if (c.align === "right") textRight(c.label.toUpperCase(), cx + c.width - 6, y - 8, 6.5, bold, MUTED);
        else text(c.label.toUpperCase(), cx, y - 8, 6.5, bold, MUTED);
        cx += c.width;
      }
      y -= 12;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.75, color: RULE });
      y -= 2;
    };
    if (y - 60 < BOTTOM) newPage();
    y -= 8;
    text(`${title} (${lines.length})`, MARGIN, y - 10, 11, bold);
    y -= 18;
    if (lines.length === 0) {
      text("None.", MARGIN, y - 9, 8.5, font, MUTED);
      y -= 18;
      return;
    }
    header();
    lines.forEach((cells, r) => {
      const wrapped = cells.map((v, c) => wrap(v || "—", font, 8, columns[c].width - 6));
      const h = Math.max(...wrapped.map((w) => w.length)) * 10 + 5;
      if (y - h < BOTTOM) {
        newPage();
        text(`${title} (continued)`, MARGIN, y - 10, 9, bold, MUTED);
        y -= 16;
        header();
      }
      if (r % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - h + 2, width: WIDTH, height: h, color: rgb(0.975, 0.98, 0.985) });
      let cx = MARGIN;
      wrapped.forEach((ls, c) => {
        const col = columns[c];
        const color = tone?.(r, c) ?? (cells[c] ? INK : MUTED);
        const f = c === 1 ? bold : font;
        ls.forEach((t, k) => {
          if (col.align === "right") textRight(t, cx + col.width - 6, y - 9 - k * 10, 8, f, color);
          else text(t, cx, y - 9 - k * 10, 8, f, color);
        });
        cx += col.width;
      });
      y -= h;
    });
    y -= 6;
  }

  const SO_COLUMNS: Column[] = [
    { label: "Sl.", width: 26 },
    { label: "SO No.", width: 80 },
    { label: "SO date", width: 52 },
    { label: "Client", width: 156 },
    { label: "Planning", width: 70 },
    { label: "Readiness", width: 52 },
    { label: "Assembly", width: 72 },
    { label: "Waiting to pack", width: 70 },
    { label: "Packed on", width: 52 },
    { label: "Dispatch", width: 62 },
    { label: "Dispatched", width: 54 },
    { label: "PIs", width: 24, align: "right" },
  ];
  const soLine = (r: SpareSoRow): string[] => [
    String(r.sl_no),
    r.so_no || `#${r.sl_no}`,
    shortDate(r.so_date, "short"),
    r.client_name ?? "",
    r.planning_status,
    shortDate(r.readiness_date, "short"),
    r.assembly_status,
    r.stage !== "to_pack"
      ? ""
      : r.waiting_days !== null
        ? `${r.waiting_days} d${r.pack_overdue > 0 ? " (overdue)" : ""}`
        : r.waiting_since
          ? `Ready ${shortDate(r.waiting_since, false)}`
          : "No ready date",
    shortDate(r.packed_on, "short"),
    r.dispatch_status,
    shortDate(r.dispatched_on, "short"),
    r.pis ? String(r.pis) : "",
  ];

  newPage();
  for (const s of SPARE_STAGES) {
    const list = rows.filter((r) => r.stage === s.key).sort(STAGE_SORT[s.key]);
    table(s.label, SO_COLUMNS, list.map(soLine), (row, col) =>
      col === 7 && list[row].pack_overdue > 0 ? RED : null
    );
  }
  table("SOs created in this period", SO_COLUMNS, activity.created.map(soLine));
  table(
    "PIs raised in this period",
    [
      { label: "SO No.", width: 92 },
      { label: "Client", width: 230 },
      { label: "PI No.", width: 110 },
      { label: "PI date", width: 70 },
      { label: "PI value", width: 110, align: "right" },
      { label: "Payment term", width: 158 },
    ],
    activity.pis.map((p) => [
      p.so_no ?? "",
      p.client_name ?? "",
      p.pi_no ?? "",
      shortDate(p.pi_date, "short"),
      p.pi_value ? `${p.currency} ${money.format(Number(p.pi_value))}` : "",
      p.term ?? "",
    ])
  );
  table(
    "Payments confirmed in this period",
    [
      { label: "SO No.", width: 92 },
      { label: "Client", width: 230 },
      { label: "Payment status", width: 120 },
      { label: "Confirmed on", width: 78 },
      { label: "Amount received", width: 125, align: "right" },
      { label: "Balance", width: 125, align: "right" },
    ],
    activity.payments.map((p) => [
      p.so_no ?? "",
      p.client_name ?? "",
      p.payment_status ?? "",
      shortDate(p.confirmed_on, "short"),
      p.amount_received ? `${p.currency} ${money.format(Number(p.amount_received))}` : "",
      p.balance ? `${p.currency} ${money.format(Number(p.balance))}` : "",
    ])
  );

  const pages = pdf.getPages();
  pages.forEach((p, n) => {
    p.drawText("Spares report", { x: MARGIN, y: MARGIN - 10, size: 7, font, color: MUTED });
    const tag = `Page ${n + 1} of ${pages.length}`;
    p.drawText(tag, { x: PAGE.w - MARGIN - font.widthOfTextAtSize(tag, 7), y: MARGIN - 10, size: 7, font, color: MUTED });
  });

  return pdf.save();
}
