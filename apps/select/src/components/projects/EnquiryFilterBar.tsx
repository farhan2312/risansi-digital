"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Filter, Search } from "lucide-react";

import apiClient from "../../services/apiClient";
import { ORDER_SUBTYPES, ORDER_TYPES } from "../../lib/roles";
import {
  ENQUIRY_STATUSES,
  filterKey,
  hasEnquiryFilters,
  type EnquiryFilterOptions,
  type EnquiryFilters,
  type MultiFilterKey,
} from "../../lib/enquiry-filters";

// The enquiry filters shared by the Enquiries page and the Dashboard: client
// search, then multi-select primary rep, secondary rep, zone, market, industry
// and status. The dropdown values come from the enquiries themselves, one per
// value whatever its spelling (lib/enquiry-filters filterKey).

const ORDER_TYPE_LABELS = ORDER_TYPES.map((o) => o.label);
const PUMP_TYPE_LABELS = ORDER_SUBTYPES.pump.map((o) => o.label);
const SPARE_TYPE_LABELS = ORDER_SUBTYPES.spare.map((o) => o.label);

let optionsCache: Promise<EnquiryFilterOptions> | null = null;
const loadOptions = () =>
  (optionsCache ??= apiClient
    .get<EnquiryFilterOptions>("/projects/filter-options")
    .then((r) => r.data)
    .catch((e) => {
      optionsCache = null;
      throw e;
    }));

/** A multi-select dropdown, also used by Client Operation Docs' filters. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  // The panel is fixed-positioned under the button: the page headers it sits
  // in clip anything that overflows them.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 258)) });
  };

  // Close on a click outside, Escape, or the page scrolling under it.
  useEffect(() => {
    if (!open) return;
    place();
    const onMove = (e: Event) => {
      // Scrolling the list inside the panel is fine.
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const picked = new Set(value.map(filterKey));
  const isOn = (v: string) => picked.has(filterKey(v));
  const toggle = (v: string) => onChange(isOn(v) ? value.filter((x) => filterKey(x) !== filterKey(v)) : [...value, v]);
  // A picked value no longer offered stays visible so it can be unticked.
  const all = [...options, ...value.filter((v) => !options.some((o) => filterKey(o) === filterKey(v)))];
  const shown = q.trim() ? all.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : all;
  const on = value.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 max-w-[220px] items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] shadow-xs transition-[color,background-color,border-color] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
          on ? "border-primary/40 bg-primary/8 font-medium text-primary" : "border-border bg-card text-foreground hover:border-input hover:bg-muted"
        }`}
      >
        <span className="truncate">{!on ? label : value.length === 1 ? value[0] : label}</span>
        {value.length > 1 && (
          <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-primary-foreground">{value.length}</span>
        )}
        <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && at && (
        <div
          style={{ top: at.top, left: at.left }}
          className="fixed z-[1100] w-[250px] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-[0_8px_28px_rgba(15,23,42,0.14)]">
          {all.length > 8 && (
            <div className="border-b border-border p-1.5">
              <input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
              />
            </div>
          )}
          <ul role="listbox" aria-multiselectable="true" className="max-h-[260px] overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-3 py-2 text-[12.5px] text-muted-foreground">Nothing to pick</li>}
            {shown.map((o) => (
              <li key={o}>
                <label className="mx-1 flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-[12.5px] text-foreground hover:bg-muted">
                  <input type="checkbox" checked={isOn(o)} onChange={() => toggle(o)} className="size-3.5 accent-[var(--sc-primary)]" />
                  <span className={`truncate ${isOn(o) ? "font-medium" : ""}`}>{o}</span>
                </label>
              </li>
            ))}
          </ul>
          {on && (
            <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[11.5px]">
              <span className="text-muted-foreground">{value.length} selected</span>
              <button type="button" onClick={() => onChange([])} className="font-medium text-primary hover:underline">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EnquiryFilterBar({
  value,
  onChange,
  showClient = true,
  orderTypeRequired = false,
}: {
  value: EnquiryFilters;
  onChange: (next: EnquiryFilters) => void;
  /** The Enquiries page has its own client name search box. */
  showClient?: boolean;
  /** The Dashboard: always Pump or Spare, no All, and only that type's dropdowns. */
  orderTypeRequired?: boolean;
}) {
  const [opts, setOpts] = useState<EnquiryFilterOptions | null>(null);
  useEffect(() => {
    loadOptions().then(setOpts).catch(() => setOpts({ primaryReps: [], secondaryReps: [], zones: [], markets: [], industries: [] }));
  }, []);

  // The client search is sent once typing pauses.
  const [client, setClient] = useState(value.client ?? "");
  useEffect(() => setClient(value.client ?? ""), [value.client]);
  useEffect(() => {
    if ((value.client ?? "") === client) return;
    const t = setTimeout(() => onChange({ ...value, client }), 300);
    return () => clearTimeout(t);
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const multi = (key: MultiFilterKey, label: string, list: readonly string[] | undefined) => (
    <MultiSelect
      label={label}
      options={list ?? []}
      value={value[key] ?? []}
      onChange={(next) => onChange({ ...value, [key]: next.length ? next : undefined })}
    />
  );

  const onlySpares = value.orderType?.length === 1 && value.orderType[0] === "Spare";
  const onlyPumps = value.orderType?.length === 1 && value.orderType[0] === "Pump";
  // Clear leaves a required order type where it is.
  const kept = orderTypeRequired ? { orderType: value.orderType } : {};

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Filter className="size-3.5" aria-hidden />
        Filters
      </span>
      {showClient && (
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label="Client name or code"
            placeholder="Client name or code…"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className={`h-8 w-[200px] rounded-md border bg-card pr-2.5 pl-8 text-[12.5px] text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 ${
              value.client ? "border-primary/50" : "border-input"
            }`}
          />
        </label>
      )}
      <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 ring-1 ring-border ring-inset" role="radiogroup" aria-label="Order type">
        {(orderTypeRequired ? ORDER_TYPE_LABELS : ["All", ...ORDER_TYPE_LABELS]).map((label) => {
          const on = label === "All" ? value.orderType?.length !== 1 : value.orderType?.length === 1 && value.orderType[0] === label;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() =>
                // The other type's status filters leave with their dropdowns.
                onChange({
                  ...value,
                  orderType: label === "All" ? undefined : [label],
                  ...(label === "Spare" ? { status: undefined, commercialStatus: undefined } : {}),
                  ...(label === "Pump" ? { spareStatus: undefined } : {}),
                  // The other type's dropdown is gone, so its picks would match nothing.
                  ...(orderTypeRequired ? (label === "Spare" ? { pumpType: undefined } : { spareType: undefined }) : {}),
                })
              }
              className={`h-full rounded-[5px] px-3 text-[12.5px] font-medium transition-[color,background-color,box-shadow] ${on ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {!(orderTypeRequired && onlySpares) && multi("pumpType", "Pump type", PUMP_TYPE_LABELS)}
      {!(orderTypeRequired && !onlySpares) && multi("spareType", "Spare type", SPARE_TYPE_LABELS)}
      {multi("primaryRep", "Primary rep", opts?.primaryReps)}
      {multi("secondaryRep", "Secondary rep", opts?.secondaryReps)}
      {multi("zone", "Zone", opts?.zones)}
      {multi("market", "Market", opts?.markets)}
      {multi("industry", "Industry", opts?.industries)}
      {/* Pumps and spares filter by status independently. */}
      {!onlySpares && multi("status", "Technical status", ENQUIRY_STATUSES)}
      {!onlySpares && multi("commercialStatus", "Commercial status", ENQUIRY_STATUSES)}
      {!onlyPumps && multi("spareStatus", onlySpares ? "Status" : "Spare status", ENQUIRY_STATUSES)}
      {hasEnquiryFilters({ ...value, orderType: orderTypeRequired ? undefined : value.orderType }) && (
        <button
          type="button"
          onClick={() => {
            setClient("");
            onChange(kept);
          }}
          className="inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
