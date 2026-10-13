import "server-only";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { roleLabel } from "@/lib/roles";
import { sanitize, wrap } from "@/lib/pdf-text";
import {
  ACTIVE_GAP_MINUTES,
  actionLabel,
  formatActiveMinutes,
} from "@/lib/audit-labels";
import { REPORT_EVENT_CAP, type AuditReport } from "@/lib/audit";

// The audit log as a printable report: what the period looked like at a
// glance, who was in the system and for how long, what kind of work was done,
// which orders it touched, and then every event in full.

// A4 landscape, in points.
const PAGE = { w: 842, h: 595 };
const MARGIN = 36;
const CONTENT = PAGE.w - MARGIN * 2; // 770
const FOOTER = 26;

const NAVY = rgb(0.12, 0.22, 0.39);
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const ZEBRA = rgb(0.965, 0.972, 0.98);
const TILE = rgb(0.95, 0.96, 0.98);
const BAR = rgb(0.29, 0.44, 0.7);
const WHITE = rgb(1, 1, 1);

const IST = "Asia/Kolkata";

export type AuditReportMeta = {
  /** "01 Sep 2026 – 11 Sep 2026", or the preset's name. */
  period: string;
  /** Which tab it was taken from: all events, logins, activity… */
  scope: string;
  search: string | null;
  generatedBy: string;
  /** Sign-ins and ownership changes are about people; they carry no SO/EC. */
  showSubject: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "11 Sep 2026 13:19" in IST — fixed width, so it never wraps its column. */
function istStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: IST,
      day: "2-digit",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year} ${parts.hour}:${parts.minute}`;
}

type Bar = { bar: number; label: string };
/** A cell: one string (wrapped), several lines, or a proportion bar. */
type Cell = string | string[] | Bar;

type Column = { label: string; width: number; align?: "right" };

const SIZE = 8.5;
const LINE = 10.5;
const PAD_X = 5;
const PAD_Y = 5;
/** Space a section heading takes, rule included. */
const HEADING_H = 33;

/** A page cursor that starts a new page when the next block would not fit. */
class Layout {
  page!: PDFPage;
  y = 0;

  constructor(
    private pdf: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE.w, PAGE.h]);
    this.y = PAGE.h - MARGIN;
  }

  /** Room left above the footer. */
  get room() {
    return this.y - (MARGIN + FOOTER);
  }

  ensure(height: number) {
    if (this.room < height) this.newPage();
  }

  text(
    value: string,
    x: number,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB } = {}
  ) {
    const font = opts.font ?? this.font;
    this.page.drawText(sanitize(value, font), {
      x,
      y,
      size: opts.size ?? SIZE,
      font,
      color: opts.color ?? INK,
    });
  }

  heading(title: string, note?: string) {
    // A heading alone at the foot of a page is worse than a gap.
    this.ensure(70);
    this.y -= 8;
    this.text(title, MARGIN, this.y - 11, { size: 11.5, font: this.bold, color: NAVY });
    if (note) {
      const w = this.bold.widthOfTextAtSize(sanitize(title, this.bold), 11.5);
      this.text(note, MARGIN + w + 10, this.y - 10.5, { size: 8, color: MUTED });
    }
    this.y -= 17;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + CONTENT, y: this.y },
      thickness: 1,
      color: NAVY,
    });
    this.y -= 8;
  }

  private tableHeader(columns: Column[]) {
    const h = 18;
    this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT, height: h, color: NAVY });
    let x = MARGIN;
    for (const col of columns) {
      const label = col.label.toUpperCase();
      const w = this.bold.widthOfTextAtSize(label, 7);
      this.text(label, col.align === "right" ? x + col.width - PAD_X - w : x + PAD_X, this.y - 12, {
        size: 7,
        font: this.bold,
        color: WHITE,
      });
      x += col.width;
    }
    this.y -= h;
  }

  /** Lines a cell will occupy, wrapped to its column. */
  private linesOf(cell: Cell, col: Column): string[] {
    return this.wrapped(cell, col).lines;
  }

  /**
   * A cell's wrapped lines, and how many of them belong to its first part —
   * the headline of a multi-part cell, which is set darker than the rest
   * however many lines it wraps to.
   */
  private wrapped(cell: Cell, col: Column): { lines: string[]; head: number } {
    if (typeof cell === "object" && !Array.isArray(cell)) {
      return { lines: [cell.label], head: 1 };
    }
    const parts = Array.isArray(cell) ? cell : [cell];
    const wrappedParts = parts.map((p) => wrap(p, this.font, SIZE, col.width - PAD_X * 2));
    return { lines: wrappedParts.flat(), head: wrappedParts[0]?.length ?? 0 };
  }

  /**
   * Rows under a navy header, zebra-striped, wrapping each cell to its column
   * and repeating the header on every page the table spills onto.
   * `muted` names the columns drawn in the secondary colour.
   */
  /** How tall a table will be once its cells are wrapped. */
  tableHeight(columns: Column[], rows: Cell[][]): number {
    return (
      18 +
      rows.reduce(
        (sum, row) =>
          sum +
          Math.max(...row.map((cell, i) => this.linesOf(cell, columns[i]).length)) * LINE +
          PAD_Y * 2,
        0
      )
    );
  }

  /**
   * A heading and its table as one block. If the block would fit whole on a
   * fresh page but not on this one, it moves there together — rather than
   * leaving the heading, or a few rows, stranded at the foot of this page.
   */
  section(
    title: string,
    note: string | undefined,
    columns: Column[],
    rows: Cell[][],
    opts: { empty?: string; muted?: number[] } = {}
  ) {
    const block = HEADING_H + this.tableHeight(columns, rows);
    const fullPage = PAGE.h - MARGIN * 2 - FOOTER;
    if (block > this.room && block <= fullPage) this.newPage();
    this.heading(title, note);
    this.table(columns, rows, opts);
  }

  table(columns: Column[], rows: Cell[][], opts: { empty?: string; muted?: number[] } = {}) {
    this.ensure(18 + LINE + PAD_Y * 2);
    this.tableHeader(columns);

    if (rows.length === 0) {
      this.y -= 6;
      this.text(opts.empty ?? "Nothing to show.", MARGIN + PAD_X, this.y - 9, { color: MUTED });
      this.y -= 18;
      return;
    }

    rows.forEach((row, r) => {
      const cells = row.map((cell, i) => this.wrapped(cell, columns[i]));
      const lines = cells.map((c) => c.lines);
      const height = Math.max(...lines.map((l) => l.length)) * LINE + PAD_Y * 2;

      if (this.room < height) {
        this.newPage();
        this.tableHeader(columns);
      }

      if (r % 2 === 1) {
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - height,
          width: CONTENT,
          height,
          color: ZEBRA,
        });
      }

      let x = MARGIN;
      row.forEach((cell, i) => {
        const col = columns[i];
        if (typeof cell === "object" && !Array.isArray(cell)) {
          // A proportion bar with its figure beside it.
          const track = col.width - PAD_X * 2 - 44;
          this.page.drawRectangle({
            x: x + PAD_X,
            y: this.y - PAD_Y - 8,
            width: Math.max(1.5, track * Math.min(1, cell.bar)),
            height: 6,
            color: BAR,
          });
          this.text(cell.label, x + PAD_X + track + 6, this.y - PAD_Y - 7.5, { color: MUTED });
        } else {
          const color = opts.muted?.includes(i) ? MUTED : INK;
          lines[i].forEach((line, n) => {
            const w = this.font.widthOfTextAtSize(line, SIZE);
            const tx = col.align === "right" ? x + col.width - PAD_X - w : x + PAD_X;
            // A multi-part cell's first part is its headline; the parts after
            // it are detail, set lighter.
            this.page.drawText(line, {
              x: tx,
              y: this.y - PAD_Y - 7.5 - n * LINE,
              size: SIZE,
              font: this.font,
              color: n >= cells[i].head ? MUTED : color,
            });
          });
        }
        x += col.width;
      });

      this.y -= height;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: MARGIN + CONTENT, y: this.y },
        thickness: 0.4,
        color: RULE,
      });
    });
    this.y -= 6;
  }
}

/** "Updated Planning — A: x → y; B: …" split into its headline and changes. */
function detailLines(details: string | null): string[] {
  if (!details) return ["—"];
  const split = details.indexOf(" — ");
  if (split < 0 || !details.includes("→")) return [details];
  return [
    details.slice(0, split),
    ...details
      .slice(split + 3)
      .split("; ")
      .map((c) => `• ${c}`),
  ];
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-IN");
}

export async function buildAuditReportPdf(
  report: AuditReport,
  meta: AuditReportMeta
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Audit Log Report — ${meta.period}`);
  pdf.setAuthor("Risansi SO to Dispatch");
  pdf.setCreationDate(new Date());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = new Layout(pdf, font, bold);
  const generatedAt = istStamp(new Date().toISOString());

  // --- title band -----------------------------------------------------------
  const band = 58;
  L.page.drawRectangle({ x: 0, y: PAGE.h - band, width: PAGE.w, height: band, color: NAVY });
  L.text("Audit Log Report", MARGIN, PAGE.h - 34, { size: 19, font: bold, color: WHITE });
  L.text("Risansi · SO to Dispatch", MARGIN, PAGE.h - 48, {
    size: 8.5,
    color: rgb(0.78, 0.83, 0.92),
  });
  const right = `Generated ${generatedAt} IST`;
  L.text(right, PAGE.w - MARGIN - font.widthOfTextAtSize(sanitize(right, font), 8.5), PAGE.h - 34, {
    size: 8.5,
    color: WHITE,
  });
  L.y = PAGE.h - band - 18;

  // --- what this report covers ---------------------------------------------
  const facts: [string, string][] = [
    ["Period", meta.period],
    ["Scope", meta.scope],
    ["Search", meta.search || "—"],
    ["Generated by", meta.generatedBy],
  ];
  facts.forEach(([k, v], i) => {
    const x = MARGIN + (i % 2) * (CONTENT / 2);
    const y = L.y - Math.floor(i / 2) * 14;
    L.text(k.toUpperCase(), x, y, { size: 7, font: bold, color: MUTED });
    L.text(v, x + 72, y, { size: 9 });
  });
  L.y -= 38;

  // --- headline numbers -----------------------------------------------------
  const t = report.totals;
  const tiles: [string, string][] = [
    ["Events", fmtInt(t.events)],
    ["Order actions", fmtInt(t.actions)],
    ["Sign-ins", fmtInt(t.logins)],
    ["Failed sign-ins", fmtInt(t.failed)],
    ["Active users", fmtInt(t.activeUsers)],
    ["Total active time", formatActiveMinutes(t.activeMinutes)],
    ["Orders touched", fmtInt(t.ordersTouched)],
  ];
  const gap = 6;
  const tileW = (CONTENT - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([label, value], i) => {
    const x = MARGIN + i * (tileW + gap);
    L.page.drawRectangle({ x, y: L.y - 50, width: tileW, height: 50, color: TILE });
    L.page.drawRectangle({ x, y: L.y - 50, width: 3, height: 50, color: NAVY });
    L.text(value, x + 10, L.y - 25, { size: 16, font: bold, color: NAVY });
    L.text(label.toUpperCase(), x + 10, L.y - 40, { size: 6.5, font: bold, color: MUTED });
  });
  L.y -= 64;

  // --- who was in the system -------------------------------------------------
  // An email can reach the log without its owner ever getting in — a failed
  // sign-in, an access request. Those are counted, not listed.
  const present = report.users.filter(
    (u) => u.sessions > 0 || u.actions > 0 || u.activeMinutes > 0
  );
  const absent = report.users.length - present.length;
  L.section(
    "Usage by user",
    `Active time = gaps of ${ACTIVE_GAP_MINUTES} min or less between a user's actions, added up; a longer gap does not count.${
      absent > 0 ? ` ${absent} account${absent === 1 ? "" : "s"} with only failed sign-ins or requests not listed.` : ""
    }`,
    [
      { label: "User", width: 230 },
      { label: "Role", width: 130 },
      { label: "Actions", width: 70, align: "right" },
      { label: "Sessions", width: 70, align: "right" },
      { label: "Active time", width: 90, align: "right" },
      { label: "Last active (IST)", width: 180 },
    ],
    present.map((u) => [
      u.name ? [u.name, u.email] : u.email,
      u.role ? roleLabel(u.role) : "—",
      fmtInt(u.actions),
      fmtInt(u.sessions),
      formatActiveMinutes(u.activeMinutes),
      istStamp(u.lastActive),
    ]),
    { empty: "No one was active in this period.", muted: [5] }
  );

  // --- what kind of work ---------------------------------------------------
  const top = Math.max(1, ...report.byAction.map((a) => a.count));
  L.section(
    "Activity by type",
    undefined,
    [
      { label: "Event", width: 280 },
      { label: "Count", width: 90, align: "right" },
      { label: "Share of events", width: 400 },
    ],
    report.byAction.map((a) => [
      actionLabel(a.action),
      fmtInt(a.count),
      {
        bar: a.count / top,
        label: `${Math.round((a.count / Math.max(1, t.events)) * 100)}%`,
      },
    ]),
    { empty: "No events in this period." }
  );

  // --- which orders ------------------------------------------------------------
  L.section(
    "Most-worked orders",
    "Top 15 by number of events",
    [
      { label: "SO No.", width: 280 },
      { label: "Events", width: 110, align: "right" },
      { label: "People", width: 110, align: "right" },
      { label: "Last activity (IST)", width: 270 },
    ],
    report.topOrders.map((o) => [o.so_no, fmtInt(o.count), fmtInt(o.users), istStamp(o.last)]),
    { empty: "No order was touched in this period.", muted: [3] }
  );

  // --- every event --------------------------------------------------------------
  L.newPage();
  L.heading(
    "Event log",
    report.truncated
      ? `Latest ${fmtInt(REPORT_EVENT_CAP)} of ${fmtInt(t.events)} events — narrow the period for the rest`
      : `${fmtInt(report.events.length)} events, newest first`
  );
  const subject = (e: AuditReport["events"][number]): Cell => {
    if (e.so_no) return e.ec_no ? [e.so_no, e.ec_no] : e.so_no;
    // An old order event that never recorded its order — say so rather than
    // leave a dash that reads like "no order involved".
    return e.action.startsWith("order.") ? "not recorded" : "—";
  };
  // The address, with the device beneath it; old events say they predate it.
  const origin = (e: AuditReport["events"][number]): Cell => {
    if (!e.ip_address && !e.device_type) return "not recorded";
    const machine = [e.device_type, e.browser].filter(Boolean).join(" · ");
    return machine ? [e.ip_address ?? "—", machine] : (e.ip_address ?? "—");
  };
  const columns: Column[] = meta.showSubject
    ? [
        { label: "Time (IST)", width: 88 },
        { label: "User", width: 140 },
        { label: "Event", width: 80 },
        { label: "SO / EC", width: 104 },
        { label: "Details", width: 256 },
        { label: "IP / Device", width: 102 },
      ]
    : [
        { label: "Time (IST)", width: 92 },
        { label: "User", width: 160 },
        { label: "Event", width: 104 },
        { label: "Details", width: 310 },
        { label: "IP / Device", width: 104 },
      ];
  L.table(
    columns,
    report.events.map((e) => {
      const who: Cell = e.user_role
        ? [e.user_email ?? "—", roleLabel(e.user_role)]
        : (e.user_email ?? "—");
      return meta.showSubject
        ? [istStamp(e.created_at), who, actionLabel(e.action), subject(e), detailLines(e.details), origin(e)]
        : [istStamp(e.created_at), who, actionLabel(e.action), detailLines(e.details), origin(e)];
    }),
    { empty: "No events in this period.", muted: [0, meta.showSubject ? 5 : 4] }
  );

  // --- footer on every page, now that the page count is known ----------------
  const pages = pdf.getPages();
  pages.forEach((page, i) => {
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 12 },
      end: { x: PAGE.w - MARGIN, y: MARGIN + 12 },
      thickness: 0.5,
      color: RULE,
    });
    page.drawText(sanitize(`Audit Log Report · ${meta.period} · Confidential`, font), {
      x: MARGIN,
      y: MARGIN,
      size: 7.5,
      font,
      color: MUTED,
    });
    const label = `Page ${i + 1} of ${pages.length}`;
    page.drawText(label, {
      x: PAGE.w - MARGIN - font.widthOfTextAtSize(label, 7.5),
      y: MARGIN,
      size: 7.5,
      font,
      color: MUTED,
    });
  });

  return pdf.save();
}
