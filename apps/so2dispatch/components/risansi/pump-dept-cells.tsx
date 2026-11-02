"use client";

import type { PumpStage, PumpSummary } from "@/lib/pump-summary";
import { latestPumpLot, type PumpLot } from "@/lib/assembly";
import { AlignmentValue } from "./alignment-cell";
import { SortHeader } from "./sort-header";
import { LatestLot, LotCell } from "./lot-cell";

type Dept = "drawing" | "purchase" | "quality" | "planning" | "assembly";
type Tone = "done" | "part" | "pending" | "rework" | "na" | "hold";

const TONE: Record<Tone, string> = {
  done: "text-emerald-700 dark:text-emerald-400",
  part: "text-sky-700 dark:text-sky-400",
  pending: "text-foreground",
  rework: "text-rose-700 dark:text-rose-400",
  na: "text-muted-foreground",
  hold: "text-rose-700 dark:text-rose-400",
};

/** Central Visibility holds the SO: a department's status reads Hold (its figures stay under it). */
const held = (s: PumpSummary, text: string, tone: Tone): { text: string; tone: Tone } =>
  s.held ? { text: "Hold", tone: "hold" } : { text, tone };

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

const DONE_WORDS = /^(approved|issued|fully|submitted|closed)/i;
const PART_WORDS = /^(partial|sent|order placed)/i;
const lineTone = (status: string) =>
  status === "Resubmit" ? TONE.rework : DONE_WORDS.test(status) ? TONE.done : PART_WORDS.test(status) ? TONE.part : "text-foreground";

/** EC by EC under a department's cell: "40266 · Approved by client". */
function EcLines({ lines }: { lines: { ec: string; text: string; status: string; title?: string }[] }) {
  if (lines.length === 0) return null;
  return (
    <span className="mt-1 flex flex-col gap-0.5 border-t border-card-border/60 pt-1">
      {lines.map((l, i) => (
        <span key={`${l.ec}-${i}`} title={l.title} className="whitespace-nowrap text-[11px]">
          <span className="font-medium text-muted-foreground">{l.ec}</span> <span className={lineTone(l.status)}>{l.text}</span>
        </span>
      ))}
    </span>
  );
}

/** The Pump view's department heads: the group row (Drawing … Planning) — Assembly & Packing comes after the lots. */
export function PumpLeadGroupHeads({
  lotCount,
  head,
}: {
  lotCount: number;
  /** Each department's heading, as the caller draws it (the Orders list's filter it). */
  head?: (dept: "drawing" | "purchase" | "quality" | "planning" | "assembly", label: string) => React.ReactNode;
}) {
  const g = "border-l border-card-border px-4 pt-3 pb-1 text-center";
  const h = (dept: Parameters<NonNullable<typeof head>>[0], label: string) => (head ? head(dept, label) : label);
  return (
    <>
      <th colSpan={4} className={g}>{h("drawing", "Drawing")}</th>
      <th colSpan={1} className={g}>{h("purchase", "Purchase")}</th>
      <th colSpan={1} className={g}>{h("quality", "Quality")}</th>
      {/* Each with its Latest Lot after the numbered ones. */}
      <th colSpan={3 + lotCount} className={g}>{h("planning", "Planning")}</th>
      <th colSpan={2 + lotCount} className={g}>{h("assembly", "Assembly & Packing")}</th>
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
      <th className={h()}><SortHeader label="Readiness" sortKey="drg_readiness_date" /></th>
      <th className={h(true)}>BOI</th>
      <th className={h(true)}>QC Docs</th>
      <th className={h(true)}>Status</th>
      <th className={h()}><SortHeader label="Assembly Readiness" sortKey="readiness" /></th>
      {Array.from({ length: lotCount }, (_, i) => (
        <th key={i} className={h()}>Lot {i + 1}</th>
      ))}
      <th className={h()}>Latest Lot</th>
      <th className={h(true)}>Alignment</th>
      {Array.from({ length: lotCount }, (_, i) => (
        <th key={`a${i}`} className={h()}>Lot {i + 1}</th>
      ))}
      <th className={h()}>Latest Lot</th>
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
  // No EC yet: the SO has reached none of these departments.
  if (!s.hasEcs) {
    const none = <span className="text-xs text-muted-foreground">—</span>;
    return (
      <>
        {[true, false, false, false, true, true, true, false].map((first, i) => (
          <td key={i} className={td(first)}>
            {none}
          </td>
        ))}
      </>
    );
  }
  return (
    <>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        <Cell
          {...(d.gad.total ? held(s, d.gad.label, stageTone(d.gad, "Issued to planning")) : { text: "—", tone: "na" as Tone })}
          line={d.gad.total ? `${d.gad.done}/${d.gad.total} issued` : undefined}
          onClick={() => onOpen("drawing")}
        />
        <EcLines lines={d.ecs.map((e) => ({ ec: e.ec, text: e.gad, status: e.gad }))} />
      </td>
      <td className={td()} onClick={(e) => e.stopPropagation()}>
        {d.curve ? (
          <>
          <Cell
            {...held(s, d.curve.label, stageTone(d.curve, "Approved by client"))}
            line={`${d.curve.done}/${d.curve.total} approved`}
            onClick={() => onOpen("drawing")}
          />
          <EcLines lines={d.ecs.filter((e) => e.curve !== "Not required").map((e) => ({ ec: e.ec, text: e.curve, status: e.curve }))} />
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Not required</span>
        )}
      </td>
      <td className={td()} onClick={(e) => e.stopPropagation()}>
        {d.part ? (
          <>
          <Cell
            {...held(s, d.part.label, stageTone(d.part, "Fully complete"))}
            line={`${d.part.done}/${d.part.total} complete`}
            onClick={() => onOpen("drawing")}
          />
          <EcLines lines={d.ecs.filter((e) => e.part !== "Not required").map((e) => ({ ec: e.ec, text: e.part, status: e.part }))} />
          </>
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
          <>
          <Cell
            {...held(s, s.purchase.state, s.purchase.state === "Closed" ? "done" : "pending")}
            line={s.purchase.items ? `${s.purchase.received}/${s.purchase.items} received` : "No items yet"}
            onClick={() => onOpen("purchase")}
          />
          {/* Item by item: what, how many, where it stands, expected and received. */}
          {s.purchase.list.length > 0 && (
            <span className="mt-1 flex flex-col gap-1 border-t border-card-border/60 pt-1">
              {s.purchase.list.map((b, i) => (
                <span key={i} className="flex flex-col whitespace-nowrap text-[11px] leading-tight">
                  <span>
                    <span className="font-medium text-muted-foreground">{b.ec}</span>{" "}
                    <span className="font-medium text-foreground">{b.item}</span>
                    {b.qty != null && <span className="text-muted"> · Qty {b.qty}</span>}
                  </span>
                  <span className={TONE[b.tone]}>{b.status}</span>
                  {(b.expected || b.received) && (
                    <span className="text-muted">
                      {b.expected ? `Exp ${formatDate(b.expected)}` : ""}
                      {b.expected && b.received ? " · " : ""}
                      {b.received ? <span className="text-emerald-700 dark:text-emerald-400">Rcvd {formatDate(b.received)}</span> : null}
                    </span>
                  )}
                </span>
              ))}
            </span>
          )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Not required</span>
        )}
      </td>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        {s.quality.required ? (
          <>
          <Cell
            {...held(s, s.quality.state, s.quality.state === "Closed" ? "done" : s.quality.submitted > 0 ? "part" : "pending")}
            line={s.quality.total ? `${s.quality.submitted}/${s.quality.total} ECs submitted` : "No ECs yet"}
            title={s.quality.docs ? `Needs: ${s.quality.docs}` : "No documents named yet"}
            onClick={() => onOpen("quality")}
          />
          <EcLines
            lines={s.quality.ecs.map((e) => ({
              ec: e.ec,
              status: e.label,
              text: e.total ? `${e.label} ${e.done}/${e.total}${e.last ? ` · ${formatDate(e.last)}` : ""}` : e.label,
              title: e.missing.length ? `Still to give: ${e.missing.join(", ")}` : undefined,
            }))}
          />
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Not required</span>
        )}
      </td>
      <td className={td(true)} onClick={(e) => e.stopPropagation()}>
        <Cell
          {...held(s, s.planning.status, s.planning.status === "Fully ready" ? "done" : s.planning.status === "Partial ready" ? "part" : "pending")}
          onClick={() => onOpen("planning")}
        />
      </td>
      <td className={`${td()} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        <Cell text={formatDate(s.planning.readiness)} tone={s.planning.readiness ? "pending" : "na"} onClick={() => onOpen("planning")} />
      </td>
    </>
  );
}

/**
 * Planning's view of what comes after it on a pump SO, read-only, laid out
 * as Assembly & Packing's own: the base plate and the wooden boxes, each lot's
 * assembly and packing (lots 1 to lotCount, a column each), then the packing
 * slips and the dispatch status.
 */
export function PumpAfterPlanningCells({
  s,
  lots,
  lotCount,
  slips,
  className,
  rowSpan,
}: {
  s: PumpSummary;
  lots: PumpLot[];
  lotCount: number;
  /** The SO's numbered packing slips, with the lots each carries. */
  slips: Record<string, unknown>[];
  className: string;
  rowSpan?: number;
}) {
  const dispatched = /dispatched/i.test(s.dispatch) && !/partial|lot/i.test(s.dispatch);
  const holdText = <span className={`block text-[13px] font-medium ${TONE.hold}`}>Hold</span>;
  const none = <span className="text-xs text-muted">—</span>;
  return (
    <>
      {(["base_plate", "wooden_box"] as const).map((which, i) => (
        <td key={which} rowSpan={rowSpan} className={`${className} ${i === 0 ? "border-l border-card-border" : ""}`}>
          <AlignmentValue alignment={s.alignment} which={which} canEdit={false} onOpen={() => {}} />
        </td>
      ))}
      {/* Not sent on to Assembly & Packing yet: nothing there to show. */}
      {Array.from({ length: lotCount }, (_, i) => i + 1).map((n, i) => (
        <td key={n} rowSpan={rowSpan} className={`${className} ${i === 0 ? "border-l border-card-border" : ""}`}>
          {s.held ? holdText : s.sentToAssembly ? <LotCell lot={lots.find((l) => l.n === n && l.ecs.length > 0)} slips={slips} /> : none}
        </td>
      ))}
      <td rowSpan={rowSpan} className={className}>
        {s.held ? holdText : s.sentToAssembly ? <LatestLot lot={latestPumpLot(lots)} slips={slips} /> : none}
      </td>
      <td rowSpan={rowSpan} className={`${className} whitespace-nowrap border-l border-card-border`}>
        {s.slips.length
          ? s.slips.map((p, i) => (
              <span key={`${p.no}-${i}`} className="block text-[12px] text-foreground">
                {p.no}
                <span className="text-muted">
                  {p.date ? ` · ${formatDate(p.date)}` : ""}
                  {p.qty != null ? ` · Qty ${p.qty}` : ""}
                  {p.kind === "tentative" ? " · tentative" : ""}
                </span>
              </span>
            ))
          : none}
      </td>
      <td rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>
        {s.held ? (
          holdText
        ) : s.sentToDispatch ? (
          <span className={`text-[13px] font-medium ${dispatched ? TONE.done : /partial|lot/i.test(s.dispatch) ? TONE.part : TONE.pending}`}>
            {s.dispatch}
          </span>
        ) : (
          <span className="text-xs text-muted">Not at Dispatch yet</span>
        )}
      </td>
    </>
  );
}

/** Assembly & Packing's cells on a pump SO: the Alignment, then each lot's assembly and packing. */
export function PumpTailCells({ s, lotCount, onOpen }: { s: PumpSummary; lotCount: number; onOpen: (dept: Dept) => void }) {
  const a = s.alignment;
  // The numbered slips and the lots each carries, for a packed lot on no slip.
  const slips = s.slips.map((p) => ({ packing_slip_no: p.no, lot_nos: p.lot_nos }));
  const part = (name: string, yes: string | null, status: string | null, date?: string | null) =>
    yes === "Yes" ? `${name}: ${status ?? "Pending"}${date ? ` ${formatDate(date)}` : ""}` : yes === "No" ? `${name}: No` : null;
  const lines = [
    part("Base plate", a.base_plate, a.base_plate_status, a.base_plate_date),
    part("Wooden box", a.wooden_box, a.wooden_box_status, a.wooden_box_status === "Received" ? a.wooden_box_received_date : null),
  ].filter(
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
      {/* Lot by lot: its assembly and packing, as on Assembly & Packing's page. */}
      {Array.from({ length: lotCount }, (_, i) => i + 1).map((n) => (
        <td key={n} className={`${td()} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
          {s.held ? (
            <span className={`text-[13px] font-medium ${TONE.hold}`}>Hold</span>
          ) : s.sentToAssembly ? (
            <button type="button" onClick={() => onOpen("assembly")} title="Open" className="-m-1 rounded-md p-1 text-left hover:bg-background">
              <LotCell lot={s.lots.find((l) => l.n === n && l.ecs.length > 0)} slips={slips} />
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
      ))}
      {/* However many lots there are: the latest, whichever it is. */}
      <td className={`${td()} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
        {s.held ? (
          <span className={`text-[13px] font-medium ${TONE.hold}`}>Hold</span>
        ) : s.sentToAssembly ? (
          <button type="button" onClick={() => onOpen("assembly")} title="Open" className="-m-1 rounded-md p-1 text-left hover:bg-background">
            <LatestLot lot={latestPumpLot(s.lots)} slips={slips} />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </>
  );
}
