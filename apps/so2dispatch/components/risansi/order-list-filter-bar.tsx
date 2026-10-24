"use client";

import { useEffect, useRef, useState } from "react";
import { EcKindToggle } from "./planning-pump-table";
import { AlertTriangle, Check, ChevronDown, PackageCheck, PackageX, PauseCircle, X } from "lucide-react";
import { UrlSearchInput, useUrlTable } from "./url-table";
import { MultiSelectFilter, SingleSelectFilter, useShownValue } from "./multi-select-filter";
import { DEPT_VIEWS } from "@/lib/dept-view";
import {
  DEPTS_WITHOUT_PARTY,
  DEPT_FILTER_KEYS,
  DEPT_FILTER_LABELS,
  planningPackingOptions,
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
  serializeDeptStatusMulti,
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
  "client",
  // The Pump card picked on the Orders page.
  "pk",
  "type",
  "dept",
  "dstatus",
  "signoff",
  "datefield",
  "from",
  "to",
  "overdue",
  "ready",
  "noslip",
  "field",
  "fstate",
  "pterm",
  "bmode",
  "pstat",
  "dsm",
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
  kindToggle,
  noTypeFilter = false,
  noStatusFilter = false,
  extraFilters,
  searchClassName,
  extraKeys = [],
}: {
  /** A queue with statuses of its own (Drawing) drops the department Status filter… */
  noStatusFilter?: boolean;
  /** …and shows its own filters here, under these URL params. */
  extraFilters?: React.ReactNode;
  /** A narrower search box where a queue has more filters to fit on the row. */
  searchClassName?: string;
  extraKeys?: string[];
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
  /**
   * Planning: Spare or Pump, as a toggle at the start of the bar in place of
   * the Type filter — the queue looks different for each.
   */
  kindToggle?: "spare" | "pump";
  /** A queue of one type only (Purchase: pumps) has no Type to choose. */
  noTypeFilter?: boolean;
}) {
  // Who the customer is does not change what these departments do: they work
  // to dates and statuses, so the party facets are noise on their queues.
  const showsParty = !dept || !DEPTS_WITHOUT_PARTY.has(dept);
  const { get, setParams } = useUrlTable();
  // Dispatch no longer dates by, or chases, its dispatch target.
  const hasTarget = hasTargetProp && dept !== "dispatch";
  const parsed = parseDeptFilter(
    (key) => get(key) || undefined,
    dept ?? null,
    { noDispatchTarget }
  );
  // With the toggle, the type is pinned to it (statuses read that type's words).
  const filter = kindToggle ? { ...parsed, types: kindToggle === "pump" ? ["Pump", "ROLB"] : ["Spare"] } : parsed;
  const filtered = isOrderListFiltered(parsed) || extraKeys.some((k) => !!get(k));
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
        {kindToggle && (
          <EcKindToggle
            value={kindToggle}
            // A status is a Pump word or a Spare word: none carries over.
            onChange={(k) => setParams({ type: k === "pump" ? "Pump,ROLB" : null, dstatus: null, page: null })}
          />
        )}
        <UrlSearchInput placeholder={searchPlaceholder} className={searchClassName} />
        {showsParty && (
        <>
        <MultiSelectFilter
          label="Zone"
          options={options.zones}
          selected={filter.zones}
          onChange={(next) => setParams({ zone: next })}
        />
        {options.repScope && options.repScope.length <= 1 ? (
          // A Rep: their own SOs, nothing to choose.
          <span className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-input-border bg-background px-3 text-sm text-foreground">
            <span className="text-muted">Rep:</span> {options.repScope[0]}
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
        <MultiSelectFilter
          label="Client"
          searchable
          options={options.clients ?? []}
          selected={filter.clients ?? []}
          // Kept apart by "|": a client name can hold a comma.
          onChange={(next) => setParams({ client: next.length ? next.join("|") : null })}
        />
        </>
        )}
        {/* Pump or Spare — every queue, since a department's work differs by type. */}
        {!kindToggle && !noTypeFilter && (
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
        )}
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
        {extraFilters}
        {activeDept && !noStatusFilter && (
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
                    // A Pump SO's own Assembly and Packing statuses; a Spare's, packed or not.
                    options: planningPackingOptions(filter.types),
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
        {/* Billing, Planning, Assembly & Packing: where Dispatch has got to on the SO. */}
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
        {/* The orders list: statuses in several departments at once. */}
        {noDispatchTarget && (
          <DeptStatusMultiFilter
            value={filter.deptStatusMulti}
            spareOnly={filter.types.length > 0 && filter.types.every((t) => t.toLowerCase() === "spare")}
            types={filter.types}
            onChange={(next) => setParams({ dsm: serializeDeptStatusMulti(next) })}
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
        {/* Every department and the Orders list: only the SOs on hold (Central or Accounts). */}
        <button
          type="button"
          onClick={() => setParams({ hold: filter.onHold ? null : "1" })}
          aria-pressed={filter.onHold}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
            filter.onHold
              ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : "border-input-border text-foreground hover:bg-background"
          }`}
        >
          <PauseCircle className="h-3.5 w-3.5" />
          On hold
        </button>
        {/* Planning, Assembly & Packing, the Orders list: a lot packed but on no packing slip. */}
        {(!dept || dept === "planning" || dept === "assembly") && (
          <button
            type="button"
            onClick={() => setParams({ noslip: filter.noSlip ? null : "1" })}
            aria-pressed={filter.noSlip}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
              filter.noSlip
                ? "border-rose-500/40 bg-rose-500/10 text-rose-700"
                : "border-input-border text-foreground hover:bg-background"
            }`}
          >
            <PackageX className="h-3.5 w-3.5" />
            Packed, no slip
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
            // Assembly & Packing's planned packing date (Spare lots).
            if (f.value === "packing") return !dept || ["planning", "assembly", "dispatch"].includes(activeDept ?? "");
            // Drawing's own readiness date.
            if (f.value === "drg_readiness") return !dept || activeDept === "drawing";
            // Purchase's bought-out items: when each is expected.
            if (f.value === "boi_expected") return !dept || activeDept === "purchase";
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
              dept === "assembly"
                ? "packing"
                : dept === "planning"
                ? "readiness"
                : dept === "drawing"
                ? "drg_readiness"
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
              onClick={() => setParams(Object.fromEntries([...FILTER_KEYS, ...extraKeys].map((k) => [k, null])))}
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

/**
 * Statuses in several departments at once, each department under its own
 * heading: "Planning: Fully ready" and "Billing: Pending" together. Any of a
 * department's ticked statuses; every department ticked.
 */
function DeptStatusMultiFilter({
  value: valueProp,
  spareOnly,
  types,
  onChange: onChangeProp,
}: {
  value: Partial<Record<DeptFilterKey, string[]>>;
  /** A Spare has no drawing, bought-out items or QC documents. */
  spareOnly: boolean;
  types: string[];
  onChange: (next: Partial<Record<DeptFilterKey, string[]>>) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Ticks show at once, not when the page reloads.
  const [value, setValue] = useShownValue(valueProp, JSON.stringify(valueProp));
  const onChange = (next: Partial<Record<DeptFilterKey, string[]>>) => {
    setValue(next);
    onChangeProp(next);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const depts = DEPT_FILTER_KEYS.filter((k) => !spareOnly || !["drawing", "purchase", "quality"].includes(k));
  const picked = Object.entries(value).filter(([, v]) => v?.length) as [DeptFilterKey, string[]][];
  const summary =
    picked.length === 0
      ? "Any"
      : picked.length === 1
        ? `${DEPT_FILTER_LABELS[picked[0][0]]}: ${picked[0][1].join(", ")}`
        : `${picked.length} departments`;
  function toggle(dept: DeptFilterKey, status: string) {
    const cur = value[dept] ?? [];
    const next = cur.includes(status) ? cur.filter((s) => s !== status) : [...cur, status];
    onChange({ ...value, [dept]: next });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Department statuses filter"
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
          picked.length ? "border-primary/40 bg-primary/[0.06] text-foreground" : "border-input-border bg-surface text-foreground hover:bg-background"
        }`}
      >
        <span className="text-muted">Dept statuses:</span>
        <span className="max-w-[16rem] truncate font-medium">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1.5 max-h-96 w-64 overflow-y-auto rounded-lg border border-card-border bg-surface py-1 shadow-lg">
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({})}
              className="mb-1 flex w-full items-center gap-1.5 border-b border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear selection
            </button>
          )}
          <p className="px-3 pb-1 pt-1 text-[11px] text-muted">Any status within a department · every department ticked</p>
          {depts.map((dept) => (
            <div key={dept}>
              <p className="mt-1 border-t border-card-border px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {DEPT_FILTER_LABELS[dept]}
              </p>
              {statusesFor(dept, types).map((status) => {
                const checked = (value[dept] ?? []).includes(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggle(dept, status)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-background"
                  >
                    <span
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input-border"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    {status}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
