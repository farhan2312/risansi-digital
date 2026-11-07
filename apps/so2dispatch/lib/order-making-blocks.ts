// Order Making's report as one block per SO: its own details once, and each
// of its ECs. The report's lines (one per EC, the SO repeated on each) become
// these for the on-page panel and its PDF alike. Plain module.

export type ReportLine = { cells: unknown[]; filled: boolean };
export type ReportShape = { columns: { header: string }[]; lines: ReportLine[] };

export type SoBlock = {
  poDate: string;
  client: string;
  orderType: string;
  billMode: string;
  soNo: string;
  soDate: string;
  sentToOps: string;
  assigned: string;
  reason: string;
  remarks: string;
  ecs: { no: string; date: string }[];
  /** The PO Receiving and SO dates as times, for sorting; null when blank. */
  poTime: number | null;
  soTime: number | null;
};

/** The report's sorts: PO Receiving Date, Client, Assigned to, SO Date; "-" for the other way. */
export const REPORT_SORT_KEYS = ["po", "client", "assigned", "so_date"] as const;
export type ReportSortKey = (typeof REPORT_SORT_KEYS)[number];

/** A sort as the URL carries it (rsort), or null for the list's own order. */
export function parseReportSort(v: string | null | undefined): string | null {
  const key = (v ?? "").replace(/^-/, "");
  return (REPORT_SORT_KEYS as readonly string[]).includes(key) ? (v as string) : null;
}

const timeOf = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const t = (v instanceof Date ? v : new Date(String(v))).getTime();
  return Number.isNaN(t) ? null : t;
};

/** The blocks in the sort's order; blank values last either way, ties in the list's own order. */
export function sortBlocks(blocks: SoBlock[], sort: string | null): SoBlock[] {
  const key = parseReportSort(sort)?.replace(/^-/, "") as ReportSortKey | undefined;
  if (!key) return blocks;
  const dir = sort!.startsWith("-") ? -1 : 1;
  const val = (b: SoBlock): number | string | null =>
    key === "po" ? b.poTime
    : key === "so_date" ? b.soTime
    : key === "client" ? b.client.trim().toLowerCase() || null
    : b.assigned.trim().toLowerCase() || null;
  return blocks
    .map((b, i) => ({ b, i, v: val(b) }))
    .sort((x, y) => {
      if (x.v == null || y.v == null) return x.v == null && y.v == null ? x.i - y.i : x.v == null ? 1 : -1;
      const c = typeof x.v === "number" && typeof y.v === "number" ? x.v - y.v : String(x.v).localeCompare(String(y.v));
      return c === 0 ? x.i - y.i : c * dir;
    })
    .map((x) => x.b);
}

/** A date as "29 Oct 2026" (a Date, or a string a Date reads); anything else as it is. */
export function reportDay(v: unknown): string {
  if (v == null || v === "") return "";
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function blocksOf(report: ReportShape): SoBlock[] {
  const at = (h: string) => report.columns.findIndex((c) => c.header === h);
  const ix = {
    po: at("PO Receiving Date"),
    client: at("Client Name"),
    type: at("Order Type"),
    bill: at("Bill Mode"),
    so: at("SO No."),
    soDate: at("SO Date"),
    ec: at("EC No."),
    ecDate: at("EC Date"),
    ops: at("SO Sent to Operation"),
    who: at("Assigned Person"),
    reason: at("Reason for Delay"),
    remarks: at("Remarks"),
  };
  const raw = (l: ReportLine, i: number) => (i < 0 ? null : l.cells[i]);
  const s = (l: ReportLine, i: number) => {
    const v = raw(l, i);
    return v == null ? "" : String(v);
  };
  const out: SoBlock[] = [];
  for (const l of report.lines) {
    const last = out[out.length - 1];
    const ec = { no: s(l, ix.ec), date: s(l, ix.ec) ? reportDay(raw(l, ix.ecDate)) : "" };
    if (last && last.soNo && last.soNo === s(l, ix.so) && last.client === s(l, ix.client)) {
      if (ec.no) last.ecs.push(ec);
      continue;
    }
    const ops = raw(l, ix.ops);
    out.push({
      poDate: reportDay(raw(l, ix.po)),
      client: s(l, ix.client),
      orderType: s(l, ix.type),
      billMode: s(l, ix.bill),
      soNo: s(l, ix.so),
      soDate: reportDay(raw(l, ix.soDate)),
      // Blank when the report leaves the column out (an SO member's).
      sentToOps: ix.ops < 0 ? "" : ops === "HOLD" || ops === "N/A" ? ops : reportDay(ops),
      assigned: s(l, ix.who),
      reason: s(l, ix.reason),
      remarks: s(l, ix.remarks),
      ecs: ec.no ? [ec] : [],
      poTime: timeOf(raw(l, ix.po)),
      soTime: timeOf(raw(l, ix.soDate)),
    });
  }
  return out;
}
