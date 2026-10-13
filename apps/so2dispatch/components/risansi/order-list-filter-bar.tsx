"use client";

import { AlertTriangle, PackageCheck, X } from "lucide-react";
import { UrlSearchInput, useUrlTable } from "./url-table";
import { MultiSelectFilter, SingleSelectFilter } from "./multi-select-filter";
import { DEPT_VIEWS } from "@/lib/dept-view";
import {
  DEPTS_WITHOUT_PARTY,
  DEPT_FILTER_KEYS,
  DEPT_FILTER_LABELS,
  PLANNING_PACKING_OPTIONS,
  statusesFor,
  type DeptFilterKey,
} from "@/lib/dept-status";
import {
  CLEARANCE_FILTER_OPTIONS,
  HOLD_REASON_FILTER_OPTIONS,
  BILL_MODE_FILTER_OPTIONS,
  PAYMENT_STATUS_FILTER_OPTIONS,
  DATE_PRESETS,
  FIELD_FILTER_FIELDS,
  PAYMENT_FILTER_DEPTS,
  BILL_MODE_FILTER_DEPTS,
  DISPATCH_STATUS_FILTER_DEPTS,
  PAYMENT_TERM_FILTER_OPTIONS,
  FIELD_STATES,
  ORDER_DATE_FIELDS,
  SIGN_OFF_OPTIONS,
  isOrderListFiltered,
  parseDeptFilter,
  presetRange,
} from "@/lib/order-list-filter";
import type { OrderListOptions } from "@/lib/orders";
import { SIGN_OFF_ENABLED } from "@/lib/dept-completion";
import { DISPATCH_STAGES } from "@/lib/dispatch-steps";

/** Every parameter the filter owns — what "Clear all" empties. */
const FILTER_KEYS = [
  "q",
  "zone",
  "rep",
  "market",
  "type",
  "dept",
  "dstatus",
  "signoff",
  "datefield",
  "from",
  "to",
  "overdue",
  "ready",
  "field",
  "fstate",
  "pterm",
  "bmode",
  "pstat",
  "dispst",
  "dstage",
  "pack",
  "clear",
  "hreason",
];

/**
 * The central dashboard's filters, for the orders list. Every control writes
 * to the URL and the server filters the whole table, so what you see — and
 * what Export downloads — is every matching SO, not just the page on screen.
 */
export function OrderListFilterBar({
  options,
  total,
  dept,
  searchPlaceholder = "Search SO, client name, client code, EC…",
  hasTarget: hasTargetProp = true,
  noDispatchTarget = false,
}: {
  options: OrderListOptions;
  total: number;
  /**
   * Inside a department's own queue the department is not a choice: it is
   * pinned, the selector is dropped, and Status and Completion read that
   * department's vocabulary.
   */
  dept?: DeptFilterKey;
  searchPlaceholder?: string;
  /** Whether the pinned department works to a target date at all. */
  hasTarget?: boolean;
  /** The orders list: no Dispatch target date filter; SO date by default. */
  noDispatchTarget?: boolean;
}) {
  // Who the customer is does not change what these departments do: they work
  // to dates and statuses, so the party facets are noise on their queues.
  const showsParty = !dept || !DEPTS_WITHOUT_PARTY.has(dept);
  const { get, setParams } = useUrlTable();
  // Dispatch no longer dates by, or chases, its dispatch target.
  const hasTarget = hasTargetProp && dept !== "dispatch";
  const filter = parseDeptFilter(
    (key) => get(key) || undefined,
    dept ?? null,
    { noDispatchTarget }
  );
  const filtered = isOrderListFiltered(filter);
  const activeDept = dept ?? filter.dept;
  // "Target date" only means something once a department is settled, and only
  // for one that works to a date at all. On the order list, where the
  // department is a choice, the option says whose target it is.
  const deptTarget = activeDept
    ? dept
      ? hasTarget
      : DEPT_VIEWS[activeDept].hasTarget && activeDept !== "dispatch"
    : false;
  // Assembly & Packing works to the SO's Target Date for Packing Team.
  const targetLabel = activeDept
    ? activeDept === "assembly"
      ? "Target Date for Packing Team"
      : `${DEPT_FILTER_LABELS[activeDept]} target`
    : "Target date";

  const activePreset =
    DATE_PRESETS.find((p) => {
      const [from, to] = presetRange(p);
      return from === filter.from && to === filter.to;
    }) ?? null;

  return (
    <div className="mb-4 space-y-2 rounded-xl border border-card-border bg-surface p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <UrlSearchInput placeholder={searchPlaceholder} />
        {showsParty && (
        <>
        <MultiSelectFilter
          label="Zone"
          options={options.zones}
          selected={filter.zones}
          onChange={(next) => setParams({ zone: next })}
        />
        {options.repLock ? (
          <span className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-input-border bg-background px-3 text-sm text-foreground">
            <span className="text-muted">Rep:</span> {options.repLock}
          </span>
        ) : (
          <MultiSelectFilter
            label="Rep"
            options={options.reps}
            selected={filter.reps}
            onChange={(next) => setParams({ rep: next })}
          />
        )}
        <MultiSelectFilter
          label="Market"
          options={options.markets}
          selected={filter.markets}
          onChange={(next) => setParams({ market: next })}
        />
        </>
        )}
        {/* Pump or Spare — every queue, since a department's work differs by type. */}
        <MultiSelectFilter
          label="Type"
          options={options.types}
          selected={filter.types}
          onChange={(next) => {
            // A Planning status is a Pump word or a Spare word: drop one the
            // new type does not have.
            const allowed = activeDept ? statusesFor(activeDept, next) : [];
            setParams({
              type: next,
              dstatus: filter.deptStatuses.filter((s) => allowed.includes(s)),
            });
          }}
        />
        {!dept && (
        <SingleSelectFilter
          label="Department"
          allLabel="All departments"
          // A Spare has no drawing, bought-out items or QC documents to chase.
          options={DEPT_FILTER_KEYS.filter(
            (k) =>
              !(filter.types.length > 0 && filter.types.every((t) => t.toLowerCase() === "spare")) ||
              !["drawing", "purchase", "quality"].includes(k)
          ).map((k) => ({ value: k, label: DEPT_FILTER_LABELS[k] }))}
          selected={filter.dept}
          onChange={(next) => {
            // A status is one department's word; keep it only if the new
            // department has it too. Sign-off belongs to a department, so it
            // goes when the department does.
            const status = next
              ? filter.deptStatuses.filter((s) => statusesFor(next as DeptFilterKey).includes(s))
              : [];
            const keepsTarget =
              next && next !== "dispatch" && DEPT_VIEWS[next as DeptFilterKey].hasTarget;
            // The Orders list keeps them whatever the department.
            const keepsPayment = !dept || (!!next && PAYMENT_FILTER_DEPTS.includes(next));
            const keepsBillMode = !dept || (!!next && BILL_MODE_FILTER_DEPTS.includes(next));
            setParams({
              dept: next,
              dstatus: status,
              pack: next === "planning" ? filter.packingStatuses : null,
              pterm: keepsPayment ? filter.paymentTerms : null,
              bmode: keepsBillMode ? filter.billModes : null,
              signoff: next ? filter.signOff : null,
              datefield:
                filter.dateField === "dept_target" && !keepsTarget
                  ? null
                  : filter.dateField === "dispatch_target"
                    ? null
                    : filter.dateField,
            });
          }}
        />
        )}
        {/* Any of several statuses — "Partial ready" and "Fully ready" together. */}
        {activeDept && (
          <MultiSelectFilter
            label="Status"
            allLabel="Any status"
            options={statusesFor(activeDept, filter.types)}
            selected={filter.deptStatuses}
            onChange={(next) => setParams({ dstatus: next })}
            // Planning: whether a ready EC is packed yet, on the same EC.
            group={
              activeDept === "planning"
                ? {
                    heading: "Assembly & Packing",
                    options: PLANNING_PACKING_OPTIONS,
                    selected: filter.packingStatuses,
                    onChange: (next) => setParams({ pack: next }),
                  }
                : undefined
            }
          />
        )}
        {/* Dispatch: the SO's stage in Invoice → Dispatch → Docket & LR. */}
        {dept === "dispatch" && (
          <MultiSelectFilter
            label="Stage"
            allLabel="Any stage"
            options={DISPATCH_STAGES}
            selected={filter.dispatchStages}
            onChange={(next) => setParams({ dstage: next })}
          />
        )}
        {/* Billing: where Dispatch has got to on the SO. */}
        {dept && DISPATCH_STATUS_FILTER_DEPTS.includes(dept) && (
          <MultiSelectFilter
            label="Dispatch status"
            allLabel="Any dispatch status"
            options={statusesFor("dispatch")}
            selected={filter.dispatchStatuses}
            onChange={(next) => setParams({ dispst: next })}
          />
        )}
        {/* Billing and Accounts: how the SO is paid. */}
        {(!dept || (activeDept && PAYMENT_FILTER_DEPTS.includes(activeDept))) && (
          <MultiSelectFilter
            label="Payment terms"
            allLabel="Any terms"
            options={PAYMENT_TERM_FILTER_OPTIONS}
            selected={filter.paymentTerms}
            onChange={(next) => setParams({ pterm: next })}
          />
        )}
        {/* Billing, Accounts and Planning: how the SO is billed. */}
        {(!dept || (activeDept && BILL_MODE_FILTER_DEPTS.includes(activeDept))) && (
          <MultiSelectFilter
            label="Bill mode"
            allLabel="Any mode"
            options={BILL_MODE_FILTER_OPTIONS}
            selected={filter.billModes}
            onChange={(next) => setParams({ bmode: next })}
          />
        )}
        {/* The orders list: Accounts' payment status. */}
        {!dept && (
          <MultiSelectFilter
            label="Payment status"
            allLabel="Any payment status"
            options={PAYMENT_STATUS_FILTER_OPTIONS}
            selected={filter.paymentStatuses}
            onChange={(next) => setParams({ pstat: next })}
          />
        )}
        {/* The orders list: Central Visibility's clearance, and why SOs are held. */}
        {noDispatchTarget && (
          <>
            <MultiSelectFilter
              label="Clearance"
              allLabel="Any clearance"
              options={CLEARANCE_FILTER_OPTIONS}
              selected={filter.clearance}
              onChange={(next) => setParams({ clear: next })}
            />
            <MultiSelectFilter
              label="Hold reason"
              allLabel="Any reason"
              options={HOLD_REASON_FILTER_OPTIONS}
              selected={filter.holdReasons}
              onChange={(next) => setParams({ hreason: next })}
            />
          </>
        )}
        {/* The order list only: one of the SO's own fields, filled or pending. */}
        {!dept && (
          <>
            <SingleSelectFilter
              label="Field"
              allLabel="Any field"
              options={FIELD_FILTER_FIELDS.map((f) => ({ value: f.column, label: f.label }))}
              selected={filter.field?.column ?? null}
              onChange={(next) =>
                setParams({ field: next, fstate: next ? (filter.field?.state ?? "pending") : null })
              }
            />
            <SingleSelectFilter
              label="Is"
              allLabel="Pending"
              disabled={!filter.field}
              options={FIELD_STATES.filter((s) => s.value !== "pending").map((s) => ({ value: s.value, label: s.label }))}
              selected={filter.field?.state === "filled" ? "filled" : null}
              onChange={(next) => setParams({ fstate: next ?? "pending" })}
            />
          </>
        )}
        {SIGN_OFF_ENABLED && (
        <SingleSelectFilter
          label="Completion"
          allLabel="Any"
          disabled={!activeDept}
          options={SIGN_OFF_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          selected={filter.signOff}
          onChange={(next) => setParams({ signoff: next })}
        />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Past its own target with work outstanding — only meaningful for a
            department that works to a date. */}
        {activeDept && hasTarget && activeDept !== "dispatch" && (
          <button
            type="button"
            onClick={() => setParams({ overdue: filter.overdue ? null : "1" })}
            aria-pressed={filter.overdue}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
              filter.overdue
                ? "border-danger-border bg-danger-bg text-danger"
                : "border-input-border text-foreground hover:bg-background"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Overdue only
          </button>
        )}
        {/* Dispatch comes after Assembly & Packing: this is the shortlist
            of orders they have packed and that have not gone out. */}
        {activeDept === "dispatch" && (
          <button
            type="button"
            onClick={() => setParams({ ready: filter.ready ? null : "1" })}
            aria-pressed={filter.ready}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
              filter.ready
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                : "border-input-border text-foreground hover:bg-background"
            }`}
          >
            <PackageCheck className="h-3.5 w-3.5" />
            Ready to dispatch
          </button>
        )}
        <SingleSelectFilter
          label="Date"
          allLabel={
            dept === "planning"
              ? "Readiness date"
              : dept
                ? hasTarget
                  ? targetLabel
                  : "SO date"
                : noDispatchTarget
                  ? "SO date"
                  : "Dispatch target"
          }
          // A department has no use for somebody else's target; inside its own
          // queue it keeps its own, the order's own dates, and when work was
          // completed. Elsewhere "Target date" appears only once a department
          // is chosen — and only one that works to a date — since otherwise it
          // names no column at all.
          options={ORDER_DATE_FIELDS.filter((f) => {
            // Planning reads by its readiness date, not a target.
            if (f.value === "dept_target") return deptTarget && activeDept !== "planning";
            // Assembly & Packing, Billing and Dispatch work from Planning's readiness date too.
            if (f.value === "readiness")
              return !dept || ["planning", "assembly", "billing", "dispatch"].includes(activeDept ?? "");
            if (f.value === "dispatch_target") return !dept && !noDispatchTarget;
            // Completion dates come from sign-offs, which are switched off.
            if (f.value === "completed_on") return SIGN_OFF_ENABLED;
            return true;
          }).map((f) => ({
            value: f.value,
            label: f.value === "dept_target" ? targetLabel : f.label,
          }))}
          selected={filter.dateField}
          onChange={(next) => {
            const fallback =
              dept === "planning" || dept === "assembly"
                ? "readiness"
                : dept
                  ? hasTarget
                    ? "dept_target"
                    : "so_date"
                  : noDispatchTarget
                    ? "so_date"
                    : "dispatch_target";
            setParams({ datefield: next === fallback ? null : next });
          }}
        />
        {DATE_PRESETS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (activePreset === label) {
                setParams({ from: null, to: null });
                return;
              }
              const [from, to] = presetRange(label);
              setParams({ from, to });
            }}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
              activePreset === label
                ? "border-primary/40 bg-primary/[0.06] text-foreground"
                : "border-input-border bg-surface text-muted hover:bg-background hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          From
          <input
            type="date"
            value={filter.from ?? ""}
            max={filter.to ?? undefined}
            onChange={(e) => setParams({ from: e.target.value || null })}
            className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          To
          <input
            type="date"
            value={filter.to ?? ""}
            min={filter.from ?? undefined}
            onChange={(e) => setParams({ to: e.target.value || null })}
            className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
          />
        </label>
        {filtered && (
          <>
            <button
              type="button"
              onClick={() => setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
            >
              <X className="h-3.5 w-3.5" />
              Clear all
            </button>
            <span className="ml-auto text-xs text-muted">
              <span className="font-semibold text-foreground">{total}</span> matching{" "}
              {total === 1 ? "order" : "orders"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
