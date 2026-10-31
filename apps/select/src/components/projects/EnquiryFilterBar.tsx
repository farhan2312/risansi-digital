"use client";

import { useEffect, useState } from "react";

import apiClient from "../../services/apiClient";
import {
  ENQUIRY_STATUSES,
  hasEnquiryFilters,
  type EnquiryFilterOptions,
  type EnquiryFilters,
} from "../../lib/enquiry-filters";

// The enquiry filters shared by the Enquiries page and the Dashboard: client
// search, primary rep, secondary rep, zone, market, industry and status. The
// dropdown values come from the enquiries themselves.

let optionsCache: Promise<EnquiryFilterOptions> | null = null;
const loadOptions = () =>
  (optionsCache ??= apiClient
    .get<EnquiryFilterOptions>("/projects/filter-options")
    .then((r) => r.data)
    .catch((e) => {
      optionsCache = null;
      throw e;
    }));

const selectCls = (on: boolean) =>
  `h-9 max-w-[200px] min-w-[120px] rounded-lg border px-2.5 text-[12.5px] outline-none transition focus:ring-2 focus:ring-accent-soft ${
    on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line bg-paper text-fg-2 hover:border-fg-3"
  }`;

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

  const pick = (key: keyof EnquiryFilters, label: string, all: string, list: readonly string[] | undefined) => (
    <select
      aria-label={label}
      title={label}
      className={selectCls(Boolean(value[key]))}
      value={value[key] ?? ""}
      onChange={(e) => onChange({ ...value, [key]: e.target.value || undefined })}
    >
      <option value="">{all}</option>
      {(list ?? []).map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
      {/* Keep a picked value selectable even if it is no longer in the list. */}
      {value[key] && !(list ?? []).includes(value[key]!) && <option value={value[key]}>{value[key]}</option>}
    </select>
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
            className={`h-9 w-[200px] rounded-lg border pr-2.5 pl-8 text-[12.5px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft ${
              value.client ? "border-accent" : "border-line"
            } bg-paper`}
          />
        </label>
      )}
      {pick("primaryRep", "Primary rep", "All primary reps", opts?.primaryReps)}
      {pick("secondaryRep", "Secondary rep", "All secondary reps", opts?.secondaryReps)}
      {pick("zone", "Zone", "All zones", opts?.zones)}
      {pick("market", "Market type", "All markets", opts?.markets)}
      {pick("industry", "Industry", "All industries", opts?.industries)}
      {pick("status", "Status", "All statuses", ENQUIRY_STATUSES)}
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
