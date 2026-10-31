import "server-only";
import { C, assemblyReport, type Cell } from "@/lib/dept-report-pdf";
import { alignmentText, asmLotText, day, statusTone, type ReportSheet, type SheetCell, type Tone } from "@/lib/planning-report-sheet";
import { PUMP_LIKE, READY_LOT_LIMIT } from "@/lib/order-schema";
import { ecDone, ecStageStatus, pumpLotsFromEcs, soStatuses, type PumpLot } from "@/lib/assembly";
import { lotNosLabel } from "@/lib/ready-lots";
import type { PumpSummary } from "@/lib/pump-summary";

// Assembly & Packing's report as a sheet — what the Excel holds and what the
// pop-up's Excel view shows. Spare: the PDF's lines, one per SO. Pump: every
// column of the Pump view but Chat, one row per pump EC (its SO's columns
// repeated on each, so the sheet filters cleanly).

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => Number(v ?? 0) || 0;

const toneOf = (c: Cell): Tone | null =>
  c.color === C.red ? "red" : c.color === C.green ? "green" : c.color === C.amber ? "amber" : c.color === C.blue ? "blue" : null;

/** Spare: the PDF's columns and lines. */
export function assemblySpareSheet(rows: Row[], filterLine: string): ReportSheet {
  const r = assemblyReport(rows, filterLine, "Spare assembly & packing report");
  const numeric = new Set(["Sl.", "ECs"]);
  return {
    title: r.title,
    filterLine,
    summary: {
      tiles: r.tiles.map((t) => ({ label: t.label, value: Number(t.value) || 0, tone: t.color ? toneOf({ text: "", color: t.color }) ?? undefined : undefined })),
      counts: r.breakdown?.line ? [{ label: r.breakdown.label, text: r.breakdown.line }] : [],
    },
    // The PDF's widths are points: about five to an Excel character.
    columns: r.columns.map((c) => ({ label: c.label, width: Math.max(7, Math.round(c.width / 5)), numeric: numeric.has(c.label) })),
    rows: r.rows.map((cells) => ({
      cells: cells.map((c, i): SheetCell => {
        const text = c.lines ? c.lines.map((l) => l.text).filter(Boolean).join("\n") : c.text;
        return numeric.has(r.columns[i].label) && /^\d+$/.test(text) ? Number(text) : text || null;
      }),
      // A stacked cell takes its first line's colour.
      tones: cells.map((c) => (c.lines?.length ? toneOf(c.lines[0]) : toneOf(c))),
      bold: cells.map((c) => !!c.bold),
    })),
  };
}

/** Each lot's planned date for a stage, as the Planned Date cell reads. */
function plannedText(lots: PumpLot[], stage: "assembly" | "packing"): string {
  return lots
    .map((l) => {
      const date = stage === "assembly" ? l.assembly_plan_date : l.packing_plan_date;
      if (!date) return "";
      const shift = stage === "assembly" ? l.assembly_shift : l.packing_shift;
      const done = stage === "assembly" ? l.assembled_date : l.packed_date;
      return [
        `L${l.n} ${day(date)}`,
        shift,
        stage === "packing" && l.pdi ? `PDI ${l.pdi}` : "",
        done ? `${stage === "assembly" ? "Assembled" : "Packed"} ${day(done)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    })
    .filter(Boolean)
    .join("\n");
}

const stageTone = (s: string): Tone | null =>
  /^hold/i.test(s) ? "red" : /^(fully|assembled|packed)/i.test(s) ? "green" : /^partial/i.test(s) ? "blue" : s ? "amber" : null;

/** Pump: every column of the Pump view but Chat, one row per pump EC. */
export function assemblyPumpSheet(rows: Row[], filterLine: string): ReportSheet {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!PUMP_LIKE.includes(str(r.item_type))) continue;
    const k = str(r.order_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  // Lot 1 to n, as many as any SO here has, at least READY_LOT_LIMIT — as the view.
  const lotNs = Array.from(
    { length: Math.max(READY_LOT_LIMIT, ...[...groups.values()].map((ecs) => pumpLotsFromEcs(ecs).length)) },
    (_, i) => i + 1
  );

  const Col = (label: string, width: number, group: string, numeric = false) => ({ label, width, group, numeric });
  const columns = [
    Col("Sl.", 7, "SO", true),
    Col("SO No.", 18, "SO"),
    Col("SO Date", 12, "SO"),
    Col("PPC Status", 16, "SO"),
    Col("Readiness Date", 13, "SO"),
    ...lotNs.map((n) => Col(`Lot ${n}`, 30, "Lots")),
    Col("Base Plate", 16, "Alignment"),
    Col("Wooden Box", 34, "Alignment"),
    Col("Assembly Status", 18, "Assembly"),
    Col("Assembly Planned Date", 30, "Assembly"),
    Col("Packing Status", 18, "Packing"),
    Col("Packing Planned Date", 30, "Packing"),
    Col("Packing Slips", 30, "Packing"),
    Col("Dispatch Status", 18, "Dispatch"),
    Col("EC No.", 20, "EC"),
    Col("Model No.", 24, "EC"),
    Col("EC Date", 12, "EC"),
    Col("Qty", 8, "EC", true),
    Col("Ready", 8, "EC", true),
    Col("Assembled", 10, "EC", true),
    Col("Assembly", 18, "EC"),
    Col("Packed", 8, "EC", true),
    Col("Packing", 18, "EC"),
  ];
  const soCount = columns.findIndex((c) => c.label === "EC No.");

  const out: ReportSheet["rows"] = [];
  const bySoAssembly = new Map<string, number>();
  const bySoPacking = new Map<string, number>();
  let ecCount = 0;
  let pumps = 0;
  let held = 0;
  let noSlip = 0;
  for (const ecs of groups.values()) {
    const head = ecs[0];
    const hold = str(head.clearance_status) === "Hold";
    const lots = pumpLotsFromEcs(ecs);
    const ecList = ecs.map((r) => ({ id: str(r.id), quantity: num(((r.ec ?? {}) as Row).quantity) }));
    const so = soStatuses(ecList, lots);
    const slips = (Array.isArray(head.so_child_rows) ? head.so_child_rows : []) as Row[];
    const numbered = slips.filter((s) => str(s.packing_slip_no));
    if (hold) held++;
    bySoAssembly.set(hold ? "Hold" : so.assembly, (bySoAssembly.get(hold ? "Hold" : so.assembly) ?? 0) + 1);
    bySoPacking.set(hold ? "Hold" : so.packing, (bySoPacking.get(hold ? "Hold" : so.packing) ?? 0) + 1);
    noSlip += lots.filter((l) => l.packed_date && asmLotText(l, slips).endsWith("No slip")).length;

    const asm = hold ? "HOLD" : so.assembly;
    const pack = hold ? "HOLD" : so.packing;
    const dispatch = hold ? "HOLD" : numbered.length ? str(head.so_dispatch_status) || "Pending" : "Not at Dispatch yet";
    const ppc = str(head.ppc_status);
    const soCells: [SheetCell, Tone | null][] = [
      [Number(head.sl_no) || str(head.sl_no) || null, null],
      [str(head.so_no) || `#${str(head.sl_no)}`, null],
      [day(head.so_date) || null, null],
      [ppc || null, ppc ? statusTone(ppc) : null],
      [day(head.planning_readiness_date) || null, null],
      ...lotNs.map((n): [SheetCell, Tone | null] => {
        const t = asmLotText(lots.find((l) => l.n === n), slips);
        return [t || null, t ? (t.endsWith("No slip") ? "red" : statusTone(t)) : null];
      }),
      ...(["base_plate", "wooden_box"] as const).map((w): [SheetCell, Tone | null] => {
        const t = alignmentText(head.alignment as PumpSummary["alignment"] | undefined, w);
        return [t || null, t && t !== "No" ? statusTone(t.replace(/^[^:]*: /, "")) : null];
      }),
      [asm, stageTone(asm)],
      [plannedText(lots, "assembly") || null, null],
      [pack, stageTone(pack)],
      [plannedText(lots, "packing") || null, null],
      [
        numbered.length
          ? numbered
              .map((s) => [str(s.packing_slip_no), day(s.packing_slip_date), lotNosLabel(s.lot_nos)].filter(Boolean).join(" · "))
              .join("\n")
          : null,
        null,
      ],
      [dispatch, dispatch === "HOLD" ? "red" : /^fully/i.test(dispatch) ? "green" : /lot/i.test(dispatch) ? "blue" : "amber"],
    ];
    ecs.forEach((r, k) => {
      const ec = (r.ec ?? {}) as Row;
      const quantity = num(ec.quantity);
      const d = ecDone(lots, str(r.id));
      const ecAsm = hold ? "HOLD" : ecStageStatus(d.assembled, quantity, "assembly");
      const ecPack = hold ? "HOLD" : ecStageStatus(d.packed, quantity, "packing");
      ecCount++;
      pumps += quantity;
      const ecCells: [SheetCell, Tone | null][] = [
        [str(r.ec_no) || str(ec.ec_no) || null, null],
        [str(ec.model_no) || null, null],
        [day(ec.ec_date) || null, null],
        [quantity || null, null],
        [num(r.ready_qty), null],
        [d.assembled, null],
        [ecAsm, stageTone(ecAsm)],
        [d.packed, null],
        [ecPack, stageTone(ecPack)],
      ];
      const cells = [...soCells, ...ecCells];
      out.push({
        cells: cells.map((c) => c[0]),
        tones: cells.map((c) => c[1]),
        bold: columns.map((c, i) => c.label === "SO No." || c.label === "EC No." || cells[i][1] === "red"),
        repeat: k > 0,
      });
    });
  }
  const line = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join("   ·   ");
  return {
    title: "Pump assembly & packing report",
    filterLine,
    summary: {
      tiles: [
        { label: "SOs", value: groups.size },
        { label: "Pump ECs", value: ecCount },
        { label: "Pumps", value: pumps },
        { label: "Fully assembled", value: bySoAssembly.get("Fully assembled") ?? 0, tone: "green" },
        { label: "Fully packed", value: bySoPacking.get("Fully packed") ?? 0, tone: "green" },
        { label: "Packed, no slip", value: noSlip, tone: "red" },
        { label: "Hold", value: held, tone: "red" },
      ],
      counts: [
        { label: "SOs by assembly", text: line(bySoAssembly) },
        { label: "SOs by packing", text: line(bySoPacking) },
      ],
    },
    columns,
    rows: out,
    soColumns: soCount,
  };
}
