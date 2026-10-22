"use client";

import { useEffect, useState } from "react";

import type { PrintPageSize } from "../../lib/enquiry-print";

// Page size picker beside "Print / Save as PDF" on the Technical doc and the
// Commercial Offer. "Default" leaves it to the print dialog. The choice is
// remembered in this browser.

const OPTIONS: { value: PrintPageSize; label: string }[] = [
  { value: "", label: "Page: Default" },
  { value: "A4", label: "A4" },
  { value: "A4 landscape", label: "A4 Landscape" },
  { value: "A3", label: "A3" },
  { value: "A3 landscape", label: "A3 Landscape" },
];
const KEY = "print-page-size";

export function usePrintPageSize(): [PrintPageSize, (v: PrintPageSize) => void] {
  const [size, setSize] = useState<PrintPageSize>("");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY) as PrintPageSize | null;
      if (v && OPTIONS.some((o) => o.value === v)) setSize(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const choose = (v: PrintPageSize) => {
    setSize(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [size, choose];
}

export default function PrintPageSizeSelect({
  value,
  onChange,
}: {
  value: PrintPageSize;
  onChange: (v: PrintPageSize) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PrintPageSize)}
      aria-label="Page size for printing"
      title="Page size for Print / Save as PDF"
      className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[12.5px] font-semibold text-fg-2 outline-none hover:border-accent focus:border-accent"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
