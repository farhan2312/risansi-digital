"use client";

import { presetLabel, presetValue, type DateRangeValue, type PresetKey } from "@/lib/dateRangePresets";
import "./premium.css";

interface DateRangeFilterProps {
  presets: Exclude<PresetKey, "custom">[];
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
}

/** Preset pills + a From -> To box, side by side. Renders a fragment so the
 * parent decides the row (and whatever else sits on it). Styled by the
 * `.range-*` / `.date-plain` rules in premium.css. */
const DateRangeFilter = ({ presets, value, onChange }: DateRangeFilterProps) => (
  <>
    <div className="range-group" role="group" aria-label="Date range">
      {presets.map((key) => (
        <button key={key} type="button" className="range-pill" aria-pressed={value.preset === key} onClick={() => onChange(presetValue(key))}>
          {presetLabel(key)}
        </button>
      ))}
    </div>

    <div className="range-dates">
      <svg
        className="range-dates-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <input
        type="date"
        className="date-plain"
        value={value.from}
        max={value.to || undefined}
        onChange={(e) => onChange({ ...value, preset: "custom", from: e.target.value })}
        aria-label="From date"
      />
      <span className="range-dates-arrow" aria-hidden="true">
        →
      </span>
      <input
        type="date"
        className="date-plain"
        value={value.to}
        min={value.from || undefined}
        onChange={(e) => onChange({ ...value, preset: "custom", to: e.target.value })}
        aria-label="To date"
      />
    </div>
  </>
);

export default DateRangeFilter;
