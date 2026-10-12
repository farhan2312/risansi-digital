"use client";

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Small pill toggle for switching a card's metric ("Events | Users | Active time"). */
const Segmented = <T extends string>({ options, value, onChange, ariaLabel }: SegmentedProps<T>) => (
  <div className="inline-flex items-center gap-0.5 rounded-lg bg-bg-sunk p-0.5" role="group" aria-label={ariaLabel}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        aria-pressed={value === o.value}
        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
          value === o.value ? "bg-surface text-text-h shadow-sm" : "text-text-muted hover:text-text"
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export default Segmented;
