"use client";

import type { PumpStage, PumpSummary } from "@/lib/pump-summary";

type Dept = "drawing" | "purchase" | "quality" | "planning" | "assembly";
type Tone = "done" | "part" | "pending" | "rework" | "na";

const TONE: Record<Tone, string> = {
  done: "text-emerald-700 dark:text-emerald-400",
  part: "text-sky-700 dark:text-sky-400",
  pending: "text-foreground",
  rework: "text-rose-700 dark:text-rose-400",
  na: "text-muted-foreground",
};

function formatDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A department's cell: its status and a line under it, opening the department. */
function Cell({
  text,
  tone = "pending",
  line,
  lineTone,
  title,
  onClick,
}: {
  text: string;
  tone?: Tone;
  line?: string;
  lineTone?: "late" | "muted";
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? "Open"}
      className="-m-1 flex flex-col items-start rounded-md p-1 text-left transition-colors hover:bg-background"
    >
      <span className={`text-[13px] font-medium ${TONE[tone]}`}>{text}</span>
      {line && <span className={`text-[11px] ${lineTone === "late" ? "font-medium text-rose-600" : "text-muted"}`}>{line}</span>}
    </button>
  );
}

/** A stage across the SO's ECs: the status holding it back, and how many are through. */
function stageTone(s: PumpStage, doneLabel: string): Tone {
  if (s.total > 0 && s.done === s.total) return "done";
  if (s.label === "Resubmit") return "rework";
  if (s.done > 0 || (s.label !== "Pending" && s.label !== doneLabel)) return "part";
  return "pending";
}

const td = (first = false) => `px-4 py-3 align-top ${first ? "border-l border-card-border" : ""}`;

/** The Pump view's department heads: the group row (Drawing … Planning) — Assembly & Packing comes after the lots. */
export function PumpLeadGroupHeads({ lotCount }: { lotCount: number }) {
  const g = "border-l border-card-border px-4 pt-3 pb-1 text-center";
  return (
    <>
      <th colSpan={4} className={g}>Drawing</th>
      <th colSpan={1} className={g}>Purchase</th>
      <th colSpan={1} className={g}>Quality</th>
      <th colSpan={2 + lotCount} className={g}>Planning</th>
      <th colSpan={3} className={g}>Assembly &amp; Packing</th>
    </>
  );
}

/** …and each column under it. */
export function PumpLeadSubHeads({ lotCount }: { lotCount: number }) {
  const h = (first = false) => `px-4 pb-2 whitespace-nowrap ${first ? "border-l border-card-border" : ""}`;
  return (
    <>
      <th className={h(true)}>GAD</th>
      <th className={h()}>Perf. Curve</th>
      <th className={h()}>Part Drawing</th>
      <th className={h()}>Readiness</th>
      <th className={h(true)}>BOI</th>
      <th className={h(true)}>QC Docs</th>
      <th className={h(true)}>Status</th>
      <th className={h()}>Assembly Readiness</th>
      {Array.from({ length: lotCount }, (_, i) => (
        <th key={i} className={h()}>Lot {i + 1}</th>
      ))}
      <th className={h(true)}>Alignment</th>
      <th className={h()}>Assembly</th>
      <th className={h()}>Packing</th>
    </>
  );
}

/**
 * Drawing, Purchase, Quality and Planning's own cells on a pump SO (the
 * Planning lots follow, drawn by the table).
 */
export function PumpLeadCells({
  s,
  today,
  onOpen,
}: {
  s: PumpSummary;
  today: string;
  onOpen: (dept: Dept) => void;
}) {
  const d = s.drawing;
  const readinessLate = !!d.readiness && !d.closed && d.readiness < today;
  return (
    <>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        <Cell
          text={d.gad.total ? d.gad.label : "—"}
          tone={d.gad.total ? stageTone(d.gad, "Issued to planning") : "na"}
          line={d.gad.total ? `${d.gad.done}/${d.gad.total} issued` : undefined}
          onClick={() => onOpen("drawing")}
        />
      </td>
      <td className={td()} onClick={(e) => e.stopPropagation()}>
        {d.curve ? (
          <Cell
            text={d.curve.label}
            tone={stageTone(d.curve, "Approved by client")}
            line={`${d.curve.done}/${d.curve.total} approved`}
            onClick={() => onOpen("drawing")}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Not required</span>
        )}
      </td>
      <td className={td()} onClick={(e) => e.stopPropagation()}>
        {d.part ? (
          <Cell
            text={d.part.label}
            tone={stageTone(d.part, "Fully complete")}
            line={`${d.part.done}/${d.part.total} complete`}
            onClick={() => onOpen("drawing")}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Not required</span>
        )}
      </td>
      <td className={`${td()} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        <Cell
          text={d.closed ? "Closed" : formatDate(d.readiness)}
          tone={d.closed ? "done" : d.readiness ? "pending" : "na"}
          line={readinessLate ? "Overdue" : d.closed && d.readiness ? `Readiness ${formatDate(d.readiness)}` : undefined}
          lineTone={readinessLate ? "late" : "muted"}
          onClick={() => onOpen("drawing")}
        />
      </td>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        {s.purchase.required ? (
          <Cell
            text={s.purchase.state}
            tone={s.purchase.state === "Closed" ? "done" : "pending"}
            line={s.purchase.items ? `${s.purchase.received}/${s.purchase.items} received` : "No items yet"}
            onClick={() => onOpen("purchase")}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Not required</span>
        )}
      </td>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        {s.quality.required ? (
          <Cell
            text={s.quality.state}
            tone={s.quality.state === "Closed" ? "done" : s.quality.submitted > 0 ? "part" : "pending"}
            line={s.quality.total ? `${s.quality.submitted}/${s.quality.total} ECs submitted` : "No ECs yet"}
            title={s.quality.docs ? `Needs: ${s.quality.docs}` : "No documents named yet"}
            onClick={() => onOpen("quality")}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Not required</span>
        )}
      </td>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        <Cell
          text={s.planning.status}
          tone={s.planning.status === "Fully ready" ? "done" : s.planning.status === "Partial ready" ? "part" : "pending"}
          onClick={() => onOpen("planning")}
        />
      </td>
      <td className={`${td()} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        <Cell text={formatDate(s.planning.readiness)} tone={s.planning.readiness ? "pending" : "na"} onClick={() => onOpen("planning")} />
      </td>
    </>
  );
}

/** A stage of Assembly & Packing: its status, and its next planned day (red once passed) or the last one done. */
function stageCell(st: { status: string; next: string | null; last: string | null }, today: string) {
  const full = /^fully/i.test(st.status);
  const late = !!st.next && st.next < today;
  return {
    tone: (full ? "done" : /^partially/i.test(st.status) ? "part" : "pending") as Tone,
    line: !full && st.next ? `Plan ${formatDate(st.next)}${late ? " · overdue" : ""}` : st.last ? `Done ${formatDate(st.last)}` : undefined,
    late: !full && late,
  };
}

/**
 * Planning's view of what comes after it on a pump SO, read-only: the
 * Alignment, assembly, packing, the packing slips and the dispatch status.
 */
export function PumpAfterPlanningCells({ s, today, className, rowSpan }: { s: PumpSummary; today: string; className: string; rowSpan?: number }) {
  const a = s.alignment;
  const asm = stageCell(s.assembly, today);
  const pkg = stageCell(s.packing, today);
  const part = (name: string, yes: string | null, status: string | null, date?: string | null) =>
    yes === "Yes" ? `${name}: ${status ?? "Yes"}${date ? ` ${formatDate(date)}` : ""}` : yes === "No" ? `${name}: No` : null;
  const lines = [part("Base plate", a.base_plate, a.base_plate_status, a.base_plate_date), part("Wooden box", a.wooden_box, a.wooden_box_status)].filter(
    (x): x is string => !!x
  );
  const stage = (text: string, st: ReturnType<typeof stageCell>) => (
    <>
      <span className={`block text-[13px] font-medium ${TONE[st.tone]}`}>{text}</span>
      {st.line && <span className={`block text-[11px] ${st.late ? "font-medium text-rose-600" : "text-muted"}`}>{st.line}</span>}
    </>
  );
  const dispatched = /dispatched/i.test(s.dispatch) && !/partial|lot/i.test(s.dispatch);
  return (
    <>
      <td rowSpan={rowSpan} className={`${className} border-l border-card-border`}>
        {lines.length ? (
          lines.map((l) => (
            <span key={l} className="block whitespace-nowrap text-[12px] text-foreground">
              {l}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      {/* Not sent on to Assembly & Packing yet: nothing there to show. */}
      <td rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>
        {s.sentToAssembly ? stage(s.assembly.status, asm) : <span className="text-xs text-muted">—</span>}
      </td>
      <td rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>
        {s.sentToAssembly ? stage(s.packing.status, pkg) : <span className="text-xs text-muted">—</span>}
      </td>
      <td rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>
        {s.slips.length ? (
          s.slips.map((p, i) => (
            <span key={`${p.no}-${i}`} className="block text-[12px] text-foreground">
              {p.no}
              <span className="text-muted">
                {p.date ? ` · ${formatDate(p.date)}` : ""}
                {p.qty != null ? ` · Qty ${p.qty}` : ""}
                {p.kind === "tentative" ? " · tentative" : ""}
              </span>
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>
        {s.sentToDispatch ? (
          <span className={`text-[13px] font-medium ${dispatched ? TONE.done : /partial|lot/i.test(s.dispatch) ? TONE.part : TONE.pending}`}>
            {s.dispatch}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
    </>
  );
}

/** Assembly & Packing's cells on a pump SO: the Alignment, then assembly and packing. */
export function PumpTailCells({ s, today, onOpen }: { s: PumpSummary; today: string; onOpen: (dept: Dept) => void }) {
  const a = s.alignment;
  const asm = stageCell(s.assembly, today);
  const pkg = stageCell(s.packing, today);
  const part = (name: string, yes: string | null, status: string | null, date?: string | null) =>
    yes === "Yes" ? `${name}: ${status ?? "Yes"}${date ? ` ${formatDate(date)}` : ""}` : yes === "No" ? `${name}: No` : null;
  const lines = [part("Base plate", a.base_plate, a.base_plate_status, a.base_plate_date), part("Wooden box", a.wooden_box, a.wooden_box_status)].filter(
    (x): x is string => !!x
  );
  return (
    <>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onOpen("assembly")}
          title="Open"
          className="-m-1 flex flex-col items-start rounded-md p-1 text-left transition-colors hover:bg-background"
        >
          {lines.length ? (
            lines.map((l) => (
              <span key={l} className="whitespace-nowrap text-[12px] text-foreground">
                {l}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </button>
      </td>
      <td className={`${td()} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        <Cell text={s.assembly.status} tone={asm.tone} line={asm.line} lineTone={asm.late ? "late" : "muted"} onClick={() => onOpen("assembly")} />
      </td>
      <td className={`${td()} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        <Cell text={s.packing.status} tone={pkg.tone} line={pkg.line} lineTone={pkg.late ? "late" : "muted"} onClick={() => onOpen("assembly")} />
      </td>
    </>
  );
}
