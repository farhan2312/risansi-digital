"use client";

// Every department's state on one SO, as a board: the SO-scope departments as
// cards, then a per-EC matrix. Shared by the "Departments" popup on the order
// list and the order overview page, so the two can never drift apart.

import { Check } from "lucide-react";
import {
  DEPT_LABELS,
  describeDays,
  isPerEcDept,
  type DeptCompletion,
  type DeptKey,
} from "@/lib/dept-completion";
import { allDeptsSettled } from "@/lib/dept-status";
import type { DeptCell, DeptTargets, EcDeptStatus, SoDeptStatus } from "@/lib/orders";

const settled = (cell: DeptCell) => ({
  done: cell.state === "done",
  na: cell.state === "na",
});

/** Every department on this EC is done or not involved. */
export function ecComplete(ec: EcDeptStatus): boolean {
  return allDeptsSettled(EC_DEPTS.map((d) => settled(ec[d.key])));
}

/**
 * The whole order is finished: every EC is, and so are the three departments
 * that work at SO level. An order with no ECs is not complete — there is
 * nothing to have finished.
 */
export function orderComplete(status: SoDeptStatus): boolean {
  if (status.ecs.length === 0) return false;
  return (
    status.ecs.every(ecComplete) &&
    allDeptsSettled([status.billing, status.accounts, status.dispatch].map(settled))
  );
}

/**
 * The derived verdict on a row: nothing outstanding anywhere on it. Says "all
 * done" rather than "complete" so it cannot be read as the departments'
 * Complete ticks, which are a separate record.
 */
export function AllDoneChip({ label = "All done" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <Check className="h-3 w-3" />
      {label}
    </span>
  );
}

export function Badge({ cell }: { cell: DeptCell }) {
  const tone =
    cell.state === "done"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : cell.state === "pending"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-slate-100 text-slate-500 border-transparent";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {cell.label}
    </span>
  );
}

export const EC_DEPTS: {
  key: Extract<DeptKey, "drawing" | "purchase" | "quality" | "planning" | "assembly">;
  // Which target this department works to. Planning has no target column of
  // its own — it schedules the order to the Dispatch Target Date, so that is
  // the date it is judged against here.
  target?: keyof DeptTargets;
}[] = [
  { key: "drawing", target: "drawing" },
  { key: "purchase", target: "purchase" },
  { key: "quality", target: "quality" },
  { key: "planning", target: "dispatch" },
  { key: "assembly", target: "assembly" },
];

/**
 * The date a column is judged against. A revised dispatch date supersedes the
 * original wherever the dispatch target is shown, so Planning and the Dispatch
 * card never quote a date that has since moved.
 */
export function targetFor(
  targets: DeptTargets,
  key: keyof DeptTargets
): { date: string | null; label: string } {
  if (key !== "dispatch") return { date: targets[key], label: "Target" };
  return targets.dispatchRevised
    ? { date: targets.dispatchRevised, label: "Revised dispatch target" }
    : { date: targets.dispatch, label: "Dispatch target" };
}

export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function isPast(value: string | null): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

/**
 * The target under a department's name. Turns red once the date has passed and
 * that department still has work outstanding — a target nobody has met yet is
 * the thing worth seeing at a glance.
 */
export function Target({
  date,
  overdue,
  label = "Target",
}: {
  date: string | null;
  overdue: boolean;
  label?: string;
}) {
  const text = formatDate(date);
  if (!text) {
    return (
      <span className="block text-[10px] font-normal normal-case text-muted-foreground">
        No target
      </span>
    );
  }
  return (
    <span
      className={`block text-[10px] font-normal normal-case ${
        overdue ? "text-danger" : "text-muted-foreground"
      }`}
    >
      {label} {text}
      {overdue ? " · overdue" : ""}
    </span>
  );
}

function completionFor(
  completions: DeptCompletion[],
  dept: DeptKey,
  itemId: string | null
): DeptCompletion | null {
  return (
    completions.find(
      (c) => c.dept === dept && (isPerEcDept(dept) ? c.item_id === itemId : c.item_id === null)
    ) ?? null
  );
}

/**
 * A department ticking its own Complete box, which is a different claim from
 * the derived status above it: the status says what has been recorded, this
 * says the department called its part finished — and how that landed against
 * its target. Worded exactly as the pipeline and the workspace checkbox word
 * it, so all three read as the same act.
 */
export function Completion({
  completion,
  applicable = true,
}: {
  completion: DeptCompletion | null;
  // A department with nothing to do on this order shows neither line: there is
  // nothing for it to have completed.
  applicable?: boolean;
}) {
  if (!completion) {
    if (!applicable) return null;
    return (
      <span className="mt-1 block text-[10px] text-muted-foreground">Not completed</span>
    );
  }
  const days = describeDays(completion.days_taken);
  const late = (completion.days_taken ?? 0) > 0;
  return (
    <span className="mt-1 block text-[10px] text-muted-foreground">
      Completed {formatDate(completion.completed_on)}
      {days ? " · " : ""}
      {days && <span className={late ? "text-danger" : "text-emerald-600"}>{days}</span>}
    </span>
  );
}

/**
 * The board. `completions` adds each department's sign-off under its state;
 * pass none to show state alone (the popup does, until it loads them).
 */
export function DeptStatusBoard({
  status,
  completions = [],
  compact = false,
}: {
  status: SoDeptStatus;
  completions?: DeptCompletion[];
  // Inside the popup the board sits in a small scroll area, so it drops the
  // section captions the full page wants.
  compact?: boolean;
}) {
  const soDepts: { dept: DeptKey; cell: DeptCell; target?: keyof DeptTargets }[] = [
    { dept: "billing", cell: status.billing },
    { dept: "accounts", cell: status.accounts },
    { dept: "dispatch", cell: status.dispatch, target: "dispatch" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Order level
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {soDepts.map((d) => {
            const target = d.target ? targetFor(status.targets, d.target) : null;
            return (
              <div
                key={d.dept}
                className="rounded-lg border border-card-border bg-background px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {DEPT_LABELS[d.dept]}
                    {target && (
                      <Target
                        date={target.date}
                        label={target.label}
                        overdue={isPast(target.date) && d.cell.state === "pending"}
                      />
                    )}
                  </span>
                  <Badge cell={d.cell} />
                </div>
                <Completion
                  completion={completionFor(completions, d.dept, null)}
                  applicable={d.cell.state !== "na"}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          EC level
          {!compact && (
            <span className="ml-2 font-normal normal-case tracking-normal">
              Target dates are set per order, so every EC below works to the same one.
            </span>
          )}
        </p>
        {status.ecs.length === 0 ? (
          <p className="rounded-lg border border-card-border bg-background px-3 py-4 text-sm text-muted">
            No ECs on this order yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-card-border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-background">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5">EC No.</th>
                  {EC_DEPTS.map((d) => {
                    const target = d.target ? targetFor(status.targets, d.target) : null;
                    return (
                      <th key={d.key} className="px-3 py-2.5 whitespace-nowrap align-top">
                        {DEPT_LABELS[d.key]}
                        {target && (
                          <Target
                            date={target.date}
                            label={target.label}
                            overdue={
                              isPast(target.date) &&
                              status.ecs.some((ec) => (ec[d.key] as DeptCell).state === "pending")
                            }
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {status.ecs.map((ec) => {
                  // An EC nobody owes anything on reads as one finished line,
                  // rather than five chips the reader has to add up.
                  const complete = ecComplete(ec);
                  return (
                  <tr
                    key={ec.id}
                    className={`align-top text-foreground ${
                      complete ? "bg-emerald-500/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium">
                      {ec.ec_no || "—"}
                      {ec.item_type && (
                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                          {ec.item_type}
                        </span>
                      )}
                      {complete && (
                        <span className="mt-1 block">
                          <AllDoneChip />
                        </span>
                      )}
                    </td>
                    {EC_DEPTS.map((d) => (
                      <td key={d.key} className="px-3 py-2.5">
                        <Badge cell={ec[d.key] as DeptCell} />
                        <Completion
                          completion={completionFor(completions, d.key, ec.id)}
                          applicable={(ec[d.key] as DeptCell).state !== "na"}
                        />
                      </td>
                    ))}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
