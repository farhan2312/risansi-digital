// Builds the orders workbook: one sheet per subject rather than one giant
// nested grid. Each sheet repeats the same key columns — Sl. No. + SO No., and
// EC No. for anything held per EC — so a row on any sheet says which order and
// which EC it belongs to, and the sheets can be joined (VLOOKUP/filter) on
// those keys.
//
// Kept out of the route so the shape can be exercised without an HTTP session.
import ExcelJS from "exceljs";
import type { OrderExportRow } from "@/lib/orders";
import {
  BILLING_DOC_FIELDS,
  BOI_ITEM_FIELDS,
  PAYMENT_TERM_FIELDS,
  DRAWING_REVISION_FIELDS,
  INVOICE_FIELDS,
  PACKING_SLIP_FIELDS,
  PACKING_SLIP_KINDS,
  SECTION_BY_TABLE,
  type OrderField,
  type OrderFieldType,
  type OrderTable,
} from "@/lib/order-schema";

type Row = Record<string, unknown>;
type Cell = string | number | Date | null;

const HEAD_BG = "FF1F3864"; // header row
const KEY_BG = "FFEAF0F8"; // the Sl./SO/EC key columns
const RULE = "FFBFC9D9";
const MUTED = "FF5B6B80";

// Every sheet leads with these, so any row can be traced back to its order.
const SO_KEYS = ["Sl. No.", "SO No."];
const EC_KEYS = [...SO_KEYS, "EC No."];

/** jsonb gives dates as strings and numerics as numbers — coerce per field. */
function cellFor(source: Row | null, field: OrderField): Cell {
  const raw = source?.[field.column];
  if (raw == null || raw === "") return null;

  if (field.type === "date") {
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (field.type === "int" || field.type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

function text(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** A section's own fields, minus the keys every sheet already carries. */
function fieldsOf(table: OrderTable): OrderField[] {
  const section = SECTION_BY_TABLE.get(table);
  if (!section) return [];
  return section.fields.filter(
    (f) => f.column !== "so_no" && f.column !== "ec_no"
  );
}

/**
 * One sheet: the key columns, then a column per field. `rows` supplies the key
 * values and the record each field is read from, so every sheet is described
 * the same way regardless of which table it came from.
 */
export type SheetSpec = {
  name: string;
  // What the sheet holds, shown on the Summary's index.
  about: string;
  perEc: boolean;
  // Columns beyond the keys that the source record doesn't carry (e.g. which
  // set a packing slip belongs to). `options` is the closed list a value
  // comes from, for anything that offers a dropdown.
  extra?: {
    label: string;
    type: OrderFieldType;
    value: (row: Row) => Cell;
    options?: string[];
  }[];
  fields: OrderField[];
  rows: Array<{
    slNo: number | null;
    soNo: string | null;
    ecNo: string | null;
    source: Row;
  }>;
};

function writeSheet(wb: ExcelJS.Workbook, spec: SheetSpec) {
  const ws = wb.addWorksheet(spec.name, {
    views: [{ state: "frozen", xSplit: spec.perEc ? 3 : 2, ySplit: 1 }],
  });

  const keys = spec.perEc ? EC_KEYS : SO_KEYS;
  const extra = spec.extra ?? [];
  const header = [
    ...keys,
    ...extra.map((e) => e.label),
    ...spec.fields.map((f) => f.label),
  ];

  const head = ws.addRow(header);
  head.height = 30;
  head.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.eachCell((cell) => {
    fill(cell, HEAD_BG);
    cell.border = { bottom: { style: "thin", color: { argb: RULE } } };
  });

  for (const r of spec.rows) {
    const values: Cell[] = [
      r.slNo,
      r.soNo,
      ...(spec.perEc ? [r.ecNo] : []),
      ...extra.map((e) => e.value(r.source)),
      ...spec.fields.map((f) => cellFor(r.source, f)),
    ];
    const row = ws.addRow(values);
    for (let c = 1; c <= keys.length; c += 1) {
      fill(row.getCell(c), KEY_BG);
      row.getCell(c).font = { bold: c > 1 };
    }
    // Number formats live on the cell, not the column, so the key columns keep
    // their own alignment while dates and amounts read properly.
    const from = keys.length + 1;
    [...extra, ...spec.fields].forEach((f, i) => {
      const cell = row.getCell(from + i);
      if (cell.value == null) return;
      if (f.type === "date") cell.numFmt = "dd-mm-yyyy";
      else if (f.type === "number") cell.numFmt = "#,##0.00";
      else if (f.type === "int") cell.numFmt = "0";
    });
  }

  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 8 : i < keys.length ? 20 : 18;
  });
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: header.length },
  };
  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    scale: 70,
    printTitlesRow: "1:1",
    margins: {
      left: 0.3,
      right: 0.3,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  };
  return ws;
}

/**
 * The order status: what Central Visibility set, else what the invoices say.
 * Recomputed rather than typed in; its reason and the diverted-to note ride
 * alongside.
 */
const DISPATCH_STATUS_FIELD: OrderField = {
  column: "order_status",
  label: "Order Status",
  type: "text",
};
const STATUS_REASON_FIELD: OrderField = {
  column: "status_reason",
  label: "Order Status Reason",
  type: "text",
};
const DIVERTED_TO_FIELD: OrderField = {
  column: "status_diverted_to",
  label: "Diverted To",
  type: "text",
};

// Attachments are stored as file bytes, which a sheet can't carry — but the
// file name is what people look for ("did the order copy come in?").
const ORDER_COPY_FIELD: OrderField = {
  column: "order_copy_file_name",
  label: "Order Copy (file)",
  type: "text",
};

// The app prints Packing Slip No. / Qty as the invoice card's header rather
// than as form fields, so INVOICE_FIELDS omits them — but they are what says
// which of the SO's slips an invoice covers.
const INVOICE_EXPORT_FIELDS: OrderField[] = [
  { column: "packing_slip_no", label: "Packing Slip No.", type: "text" },
  { column: "packing_quantity", label: "Packing Qty", type: "int" },
  ...INVOICE_FIELDS,
];

// Quality keeps two per-EC upload lists: its own certificates and reports, and
// the requirement files Central Visibility hands it. Same shape, so they share
// a sheet with a column saying which list a file came from.
const QC_DOCUMENT_FIELDS: OrderField[] = [
  { column: "file_name", label: "File Name", type: "text" },
  { column: "uploaded_at", label: "Uploaded", type: "date" },
];

const REVISION_SEQ = {
  label: "Rev. #",
  type: "int" as OrderFieldType,
  value: (row: Row) => Number(row.seq ?? null) || null,
};

const PACKING_SET = {
  label: "Set",
  type: "text" as OrderFieldType,
  options: [PACKING_SLIP_KINDS.tentative.label, PACKING_SLIP_KINDS.actual.label],
  value: (row: Row) => {
    const kind = String(row.kind ?? "");
    if (kind === PACKING_SLIP_KINDS.actual.value) {
      return PACKING_SLIP_KINDS.actual.label;
    }
    if (kind === PACKING_SLIP_KINDS.tentative.value) {
      return PACKING_SLIP_KINDS.tentative.label;
    }
    return kind || null;
  },
};

/** Build every sheet's rows in one pass over the orders. */
function collect(orders: OrderExportRow[]) {
  type Bucket = SheetSpec["rows"];
  const soRows: Bucket = [];
  const accounts: Bucket = [];
  const terms: Bucket = [];
  const pis: Bucket = [];
  const invoices: Bucket = [];
  const ecs: Bucket = [];
  const quality: Bucket = [];
  const planning: Bucket = [];
  const assembly: Bucket = [];
  const revisions: Bucket = [];
  const boi: Bucket = [];
  const qcDocs: Bucket = [];
  const slips: Bucket = [];

  for (const so of orders) {
    const slNo = Number(so.order.sl_no ?? null) || null;
    const soNo = text(so.order.so_no);
    const key = { slNo, soNo, ecNo: null };

    soRows.push({
      ...key,
      source: {
        ...so.order,
        order_status: so.order.status_override ?? so.order.dispatch_status ?? "Pending",
      },
    });
    // A missing 1:1 detail row still earns a line — "Accounts hasn't filled
    // this in yet" is different from "this SO isn't in the file".
    accounts.push({ ...key, source: so.order_accounts ?? {} });
    for (const t of so.order_payment_terms) terms.push({ ...key, source: t });
    for (const d of so.order_billing_docs) pis.push({ ...key, source: d });
    for (const inv of so.order_invoices) invoices.push({ ...key, source: inv });
    // Packing slips sit on the SO; an older one still names its EC.
    for (const ps of so.order_packing_slips) {
      slips.push({ ...key, ecNo: text(ps.ec_no) || null, source: ps });
    }

    for (const item of so.items) {
      const ecNo = text(item.item.ec_no);
      const ecKey = { slNo, soNo, ecNo };

      ecs.push({ ...ecKey, source: item.item });
      quality.push({ ...ecKey, source: item.order_qc ?? {} });
      planning.push({ ...ecKey, source: item.order_planning ?? {} });
      assembly.push({ ...ecKey, source: item.order_assembly_dispatch ?? {} });

      for (const rv of item.order_drawing_revisions) {
        revisions.push({ ...ecKey, source: rv });
      }
      for (const b of item.order_boi_items) boi.push({ ...ecKey, source: b });
      for (const q of item.order_qc_documents) {
        qcDocs.push({ ...ecKey, source: { ...q, list: "Quality output" } });
      }
      for (const q of item.order_qc_requirement_documents) {
        qcDocs.push({ ...ecKey, source: { ...q, list: "Requirement" } });
      }
    }
  }

  const specs: SheetSpec[] = [
    {
      name: "Orders",
      about: "One row per SO — the order details Central Visibility fills.",
      perEc: false,
      fields: [...fieldsOf("orders"), DISPATCH_STATUS_FIELD, STATUS_REASON_FIELD, DIVERTED_TO_FIELD],
      rows: soRows,
    },
    {
      name: "EC Items",
      about: "One row per EC (the add-on), with its pump/spare attributes.",
      perEc: true,
      fields: [...fieldsOf("order_items"), ORDER_COPY_FIELD],
      rows: ecs,
    },
    {
      name: "Payment terms",
      about: "How each SO is to be paid — one row per slice of its terms.",
      perEc: false,
      fields: PAYMENT_TERM_FIELDS,
      rows: terms,
    },
    {
      name: "Accounts",
      about: "Payment status and receipts, per SO.",
      perEc: false,
      fields: fieldsOf("order_accounts"),
      rows: accounts,
    },
    {
      name: "PIs",
      about: "Proforma invoices raised by Billing & Operations, per SO.",
      perEc: false,
      fields: BILLING_DOC_FIELDS,
      rows: pis,
    },
    {
      name: "Invoices",
      about: "Dispatch's invoice and dispatch cards, one per dispatch, per SO.",
      perEc: false,
      fields: INVOICE_EXPORT_FIELDS,
      rows: invoices,
    },
    {
      name: "Drawing revisions",
      about: "Drawing's hand-offs — issued to client, approved, to production.",
      perEc: true,
      extra: [REVISION_SEQ],
      fields: DRAWING_REVISION_FIELDS,
      rows: revisions,
    },
    {
      name: "Bought-out items",
      about: "Purchase's BOI list — what is bought out and when it arrived.",
      perEc: true,
      fields: BOI_ITEM_FIELDS,
      rows: boi,
    },
    {
      name: "Quality",
      about: "Quality's required documents and submission, per EC.",
      perEc: true,
      fields: fieldsOf("order_qc"),
      rows: quality,
    },
    {
      name: "Quality documents",
      about: "Files attached per EC — Quality's own output and requirements.",
      perEc: true,
      extra: [
        {
          label: "List",
          type: "text" as OrderFieldType,
          value: (row: Row) => text(row.list),
        },
      ],
      fields: QC_DOCUMENT_FIELDS,
      rows: qcDocs,
    },
    {
      name: "Planning",
      about: "Planning's readiness, assembly and packing dates, per EC.",
      perEc: true,
      fields: fieldsOf("order_planning"),
      rows: planning,
    },
    {
      name: "Assembly & Packing",
      about: "Assembly & Packing's dates and delay remarks, per EC.",
      perEc: true,
      fields: fieldsOf("order_assembly_dispatch"),
      rows: assembly,
    },
    {
      name: "Packing slips",
      about: "Packing slips per EC — tentative (Planning) and actual (Packing).",
      perEc: true,
      extra: [PACKING_SET],
      fields: PACKING_SLIP_FIELDS,
      rows: slips,
    },
  ];

  return specs;
}

/** Cover sheet: what this file is, when it was taken, and how to join it up. */
function buildSummarySheet(
  ws: ExcelJS.Worksheet,
  specs: SheetSpec[],
  scope: string
) {
  const title = ws.addRow(["Order-to-Dispatch export"]);
  title.font = { bold: true, size: 16, color: { argb: HEAD_BG } };
  title.height = 24;
  ws.addRow([
    `Generated ${new Date().toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    })}`,
  ]).font = { color: { argb: MUTED } };
  ws.addRow([scope]).font = { color: { argb: MUTED } };
  ws.addRow([]);

  const note = ws.addRow([
    "Every sheet starts with the same key columns — Sl. No. and SO No., plus EC No. on anything held per EC — so you can filter any sheet to one order, or match rows across sheets on those columns.",
  ]);
  note.font = { italic: true, color: { argb: MUTED } };
  note.alignment = { wrapText: true, vertical: "top" };
  note.height = 32;
  ws.mergeCells(note.number, 1, note.number, 4);
  ws.addRow([]);

  const head = ws.addRow(["Sheet", "Keyed by", "Rows", "What it holds"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((cell) => fill(cell, HEAD_BG));

  for (const spec of specs) {
    const row = ws.addRow([
      spec.name,
      spec.perEc ? "SO + EC" : "SO",
      spec.rows.length,
      spec.about,
    ]);
    row.getCell(1).font = { bold: true };
    row.getCell(3).alignment = { horizontal: "right" };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
    });
  }

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 8;
  ws.getColumn(4).width = 68;
  // No frozen pane here: a "frozen" view with nothing actually split writes a
  // <pane> with no xSplit/ySplit, which Excel rejects outright.
}

/**
 * Every sheet's shape with no rows in it — names, keys and columns exactly as
 * the export writes them. The migration template is built from this, so a file
 * exported from the system and a file filled in for migration have the same
 * sheets and the same headers.
 */
export function exportSheetDefs(): SheetSpec[] {
  return collect([]);
}

/** The whole export workbook: a cover sheet plus one sheet per subject. */
export function buildOrdersWorkbook(
  orders: OrderExportRow[],
  scope = "All orders"
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const specs = collect(orders);
  buildSummarySheet(wb.addWorksheet("Summary"), specs, scope);
  for (const spec of specs) writeSheet(wb, spec);
  return wb;
}
