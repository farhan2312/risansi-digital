"use client";

import { useEffect, useRef, useState } from "react";

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

function MultiSelect({
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
        className={`flex h-9 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition ${
          on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line bg-paper text-fg-2 hover:border-fg-3"
        }`}
      >
        <span className="truncate">{!on ? label : value.length === 1 ? value[0] : label}</span>
        {value.length > 1 && (
          <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-bold text-white">{value.length}</span>
        )}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`h-3.5 w-3.5 shrink-0 transition ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && at && (
        <div
          style={{ top: at.top, left: at.left }}
          className="fixed z-[60] w-[250px] overflow-hidden rounded-xl border border-line bg-paper shadow-[0_12px_32px_rgba(10,22,40,0.16)]">
          {all.length > 8 && (
            <div className="border-b border-line p-2">
              <input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="h-8 w-full rounded-md border border-line bg-sunk px-2.5 text-[12.5px] text-fg outline-none focus:border-accent"
              />
            </div>
          )}
          <ul role="listbox" aria-multiselectable="true" className="max-h-[260px] overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-3 py-2 text-[12.5px] text-fg-4">Nothing to pick</li>}
            {shown.map((o) => (
              <li key={o}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[12.5px] text-fg-2 hover:bg-elev">
                  <input type="checkbox" checked={isOn(o)} onChange={() => toggle(o)} className="h-3.5 w-3.5 accent-[var(--brand-blue)]" />
                  <span className={`truncate ${isOn(o) ? "font-semibold text-fg" : ""}`}>{o}</span>
                </label>
              </li>
            ))}
          </ul>
          {on && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11.5px]">
              <span className="text-fg-3">{value.length} selected</span>
              <button type="button" onClick={() => onChange([])} className="font-semibold text-accent hover:underline">
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
}: {
  value: EnquiryFilters;
  onChange: (next: EnquiryFilters) => void;
  /** The Enquiries page has its own client name search box. */
  showClient?: boolean;
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-fg-3 uppercase">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M3 5h18l-7 8v6l-4 2v-8z" />
        </svg>
        Filters
      </span>
      {showClient && (
        <label className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            type="search"
            aria-label="Client name or code"
            placeholder="Client name or code…"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className={`h-9 w-[200px] rounded-lg border bg-paper pr-2.5 pl-8 text-[12.5px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft ${
              value.client ? "border-accent" : "border-line"
            }`}
          />
        </label>
      )}
      {multi("orderType", "Order type", ORDER_TYPE_LABELS)}
      {multi("pumpType", "Pump type", PUMP_TYPE_LABELS)}
      {multi("spareType", "Spare type", SPARE_TYPE_LABELS)}
      {multi("primaryRep", "Primary rep", opts?.primaryReps)}
      {multi("secondaryRep", "Secondary rep", opts?.secondaryReps)}
      {multi("zone", "Zone", opts?.zones)}
      {multi("market", "Market", opts?.markets)}
      {multi("industry", "Industry", opts?.industries)}
      {multi("status", "Technical status", ENQUIRY_STATUSES)}
      {multi("commercialStatus", "Commercial status", ENQUIRY_STATUSES)}
      {hasEnquiryFilters(value) && (
        <button
          type="button"
          onClick={() => {
            setClient("");
            onChange({});
          }}
          className="rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft"
        >
          Clear
        </button>
      )}
    </div>
  );
}
