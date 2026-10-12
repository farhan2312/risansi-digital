"use client";

import { useEffect, useState } from "react";
import { btnGhostSm, btnPrimarySm, control, fieldWrap, hint, hintError, label } from "./formStyles";
import { addFlangeStandard, listFlangeStandards } from "../../services/flangeStandardService";

// Suction / discharge connection and flange standard fields — on the
// Specifications step (moved from Fluid Properties, 2026-10-10).

/** Connection types - fixed lists. */
export const SUCTION_CONNECTIONS = ["Flange", "BSP Type", "BSP with Flange"];
export const END_CONNECTIONS = ["End Cover", "End Plate", "BSP Type", "BSP with Flange"];
/** With AG & BK (bucket with auger) the suction side is the bucket — the only option. */
export const BUCKET_CONNECTION = "Bucket";

/** Flange standards: one list shared by the suction and discharge fields. */
export function useFlangeStandards() {
  const [options, setOptions] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    listFlangeStandards()
      .then(setOptions)
      .catch(() => setLoadFailed(true));
  }, []);
  return { options, setOptions, loadFailed };
}

const OTHER_FLANGE_STD = "__other__";

/** Plain dropdown for a connection type; a saved value outside the list stays selectable. */
export const ConnectionSelect = ({
  fieldLabel,
  value,
  options,
  onChange,
}: {
  fieldLabel: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) => (
  <div className={fieldWrap}>
    <label className={label}>{fieldLabel}</label>
    <select className={control} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select</option>
      {(value && !options.includes(value) ? [...options, value] : options).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  </div>
);

/**
 * Flange standard dropdown, backed by flange_standard_master (Suction and
 * Discharge Flange Std share the list, loaded once by the step). Picking
 * "Other" swaps the list for a box: what is typed there is saved to the list,
 * so the next enquiry can pick it instead of retyping it.
 */
export const FlangeStdField = ({
  fieldLabel,
  value,
  onChange,
  options,
  setOptions,
  loadFailed,
}: {
  fieldLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  setOptions: (options: string[]) => void;
  loadFailed: boolean;
}) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setAddError("");
    try {
      const res = await addFlangeStandard(trimmed);
      setOptions(res.options);
      // The server returns the stored spelling, so a case-different repeat
      // selects the existing value rather than adding a near-duplicate.
      onChange(res.value);
      setAdding(false);
      setDraft("");
    } catch {
      setAddError("Couldn't save it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  // A value saved earlier always stays selectable, even if the list failed to
  // load or the value was since removed.
  const shown = value && !options.some((o) => o.toLowerCase() === value.toLowerCase()) ? [...options, value] : options;

  if (adding) {
    return (
      <div className={fieldWrap}>
        <label className={label}>{fieldLabel}</label>
        <div className="flex items-center gap-[8px]">
          <input
            autoFocus
            type="text"
            className={`${control} flex-1`}
            value={draft}
            placeholder="New flange standard"
            onChange={(e) => {
              setDraft(e.target.value);
              if (addError) setAddError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
          />
          <button type="button" className={btnPrimarySm} onClick={() => void save()} disabled={saving}>
            {saving ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            className={btnGhostSm}
            onClick={() => {
              setAdding(false);
              setDraft("");
              setAddError("");
            }}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
        <span className={hint}>Saved to the flange standard list for future enquiries.</span>
        {addError && <span className={hintError}>{addError}</span>}
      </div>
    );
  }

  return (
    <div className={fieldWrap}>
      <label className={label}>{fieldLabel}</label>
      <select
        className={control}
        value={value}
        onChange={(e) => {
          if (e.target.value === OTHER_FLANGE_STD) {
            setAdding(true);
            setDraft("");
            return;
          }
          onChange(e.target.value);
        }}
      >
        <option value="">Select Flange Std</option>
        {shown.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OTHER_FLANGE_STD}>Other (type manually)…</option>
      </select>
      {loadFailed && <span className={hintError}>Couldn&apos;t load the flange standard list — try again.</span>}
    </div>
  );
};
