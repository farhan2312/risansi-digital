"use client";

import { useState } from "react";

import ProductCodeSelect from "../../components/pump-selection/ProductCodeSelect";
import {
  CODE_SEGMENTS,
  SEGMENT_DB,
  buildPumpCode,
  missingParts,
  usesSubSealing,
  type CodeOption,
  type CodeParts,
  type CodeSegmentKey,
} from "../../lib/pump-code";
import { addPumpCodeOption } from "../../services/pumpCodeService";

// A pump product code, built from its parts (lib/pump-code.ts) or picked from the
// existing product_pump list. Shared by Pump & Qty and the spare quotation.

export type CodeMode = "build" | "pick";
/** `edited`: the built code as changed by hand (user, 2026-11-04). The parts stay, so
 *  the original can always be shown beside it. Changing a part drops the edit. */
export type CodeValue = { mode: CodeMode; parts: CodeParts; picked: string; edited?: string };

// As POST /api/product-pumps accepts.
const CODE_RE = /^[A-Z0-9][A-Z0-9.-/]{2,99}$/;

/** The edit, when there is one that really differs from the built code. */
export const editedCode = (v: CodeValue): string | null => {
  const e = v.mode === "build" ? (v.edited ?? "").trim() : "";
  return e && e !== buildPumpCode(v.parts) ? e : null;
};

/** The edit to add to the product code list: not when it, or the code it was edited
 *  from, is already there (user, 2026-11-04). */
export const editedCodeToAdd = (v: CodeValue, known: Set<string>): string | null => {
  const e = editedCode(v);
  return e && !known.has(e) && !known.has(buildPumpCode(v.parts).toUpperCase()) ? e : null;
};

export const codeOf = (v: CodeValue) => (v.mode === "build" ? (editedCode(v) ?? buildPumpCode(v.parts)) : v.picked);

/** A saved code that isn't what its parts build was edited by hand. */
export const editedFromSaved = (productCode: string | null | undefined, parts: CodeParts | null | undefined): string | undefined =>
  productCode && parts && productCode !== buildPumpCode(parts) ? productCode : undefined;

export const codeError = (v: CodeValue): string => {
  if (v.mode === "pick") return v.picked ? "" : "Pick the pump product code.";
  const missing = missingParts(v.parts);
  if (missing.length) return `Pick: ${missing.map((k) => CODE_SEGMENTS.find((s) => s.key === k)!.label).join(", ")}.`;
  const e = editedCode(v);
  return e && !CODE_RE.test(e) ? "The edited code: letters, digits, - . / only, 3 to 100 characters." : "";
};

const ADD = "__add__";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const selectCls =
  "w-full rounded-lg border bg-paper px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-50";

export function CodeModeToggle({ mode, onChange }: { mode: CodeMode; onChange: (mode: CodeMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-sunk p-0.5" role="tablist">
      {(
        [
          ["build", "Build code"],
          ["pick", "Pick existing code"],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={`rounded-md px-3 py-1 text-[12px] font-semibold ${mode === m ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function CodeFields({
  value,
  options,
  known,
  showErrors,
  onChange,
  onOptionAdded,
}: {
  value: CodeValue;
  options: CodeOption[];
  /** The existing product codes, to tell a new code from an existing one. */
  known: Set<string>;
  showErrors: boolean;
  onChange: (patch: Partial<CodeValue>) => void;
  onOptionAdded: (o: CodeOption) => void;
}) {
  const [adding, setAdding] = useState<{ segment: CodeSegmentKey; text: string; error: string } | null>(null);
  const error = codeError(value);
  const code = codeOf(value);

  const setPart = (key: CodeSegmentKey, part: string) => {
    const parts = { ...value.parts, [key]: part };
    if (key === "sealing" && part !== "MS") parts.subSealing = "";
    onChange({ parts, edited: undefined });
  };

  const addOption = async () => {
    if (!adding) return;
    const text = adding.text.trim();
    if (!text) return;
    try {
      const o = await addPumpCodeOption(SEGMENT_DB[adding.segment], text);
      if (!options.some((x) => x.segment === o.segment && x.code === o.code)) onOptionAdded(o);
      setPart(adding.segment, o.code);
      setAdding(null);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAdding((a) => (a ? { ...a, error: msg || "Couldn't add it." } : a));
    }
  };

  if (value.mode === "pick") {
    return (
      <div className="max-w-[520px]">
        <ProductCodeSelect value={value.picked} invalid={showErrors && !!error} onChange={(productCode) => onChange({ picked: productCode })} />
        {showErrors && error && <span className="mt-1 block text-[11.5px] text-neg">{error}</span>}
      </div>
    );
  }

  const isNew = !error && !known.has(code.toUpperCase());
  const generated = buildPumpCode(value.parts);
  // The right-hand box holds the generated code until someone changes it.
  const complete = missingParts(value.parts).length === 0;
  const edited = editedCode(value);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {CODE_SEGMENTS.map((seg) => {
          const opts = options.filter((o) => o.segment === SEGMENT_DB[seg.key]);
          const disabled = seg.key === "subSealing" && !usesSubSealing(value.parts);
          const missing = showErrors && !disabled && !value.parts[seg.key] && (seg.required || seg.key === "subSealing");
          return (
            <label key={seg.key} className="flex min-w-0 flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-fg-3">
                {seg.label}
                {!seg.required && seg.key !== "subSealing" && <span className="font-normal"> (optional)</span>}
              </span>
              <select
                className={`${selectCls} ${missing ? "border-neg" : "border-line"}`}
                value={value.parts[seg.key]}
                disabled={disabled}
                onChange={(e) => (e.target.value === ADD ? setAdding({ segment: seg.key, text: "", error: "" }) : setPart(seg.key, e.target.value))}
              >
                <option value="">{disabled ? "MS only" : seg.required ? "Select" : "None"}</option>
                {opts.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
                {seg.addable && <option value={ADD}>+ Add new…</option>}
              </select>
            </label>
          );
        })}
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunk p-2">
          <span className="text-[12px] font-semibold text-fg-2">New {CODE_SEGMENTS.find((s) => s.key === adding.segment)!.label.toLowerCase()}:</span>
          <input
            autoFocus
            className={`${selectCls} w-[160px] border-line font-mono uppercase`}
            value={adding.text}
            maxLength={30}
            placeholder={adding.segment === "model" ? "e.g. 95 or H95" : "code"}
            onChange={(e) => setAdding({ ...adding, text: e.target.value, error: "" })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addOption();
              }
            }}
          />
          <button type="button" className={btn} onClick={() => void addOption()} disabled={!adding.text.trim()}>
            Add
          </button>
          <button type="button" className="text-[12px] font-semibold text-fg-3 hover:text-fg" onClick={() => setAdding(null)}>
            Cancel
          </button>
          {adding.error && <span className="text-[12px] text-neg">{adding.error}</span>}
          <span className="w-full text-[11px] text-fg-3">Added to the list for everyone.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-fg-3">Product code:</span>
        <span className="rounded-md bg-sunk px-2.5 py-1 font-mono text-[13.5px] font-semibold tracking-wide break-all text-fg" title="The generated code">
          {generated || "—"}
        </span>
        {complete && (
          <>
            <span className="text-[15px] font-semibold text-fg-3" aria-hidden="true">
              →
            </span>
            <input
              className={`${selectCls} w-[300px] max-w-full border-accent font-mono font-semibold tracking-wide uppercase`}
              value={value.edited ?? generated}
              maxLength={100}
              aria-label="Edited product code"
              onChange={(e) => onChange({ edited: e.target.value.toUpperCase().replace(/\s+/g, "") })}
            />
            {edited && (
              <button type="button" className="text-[12px] font-semibold text-fg-3 hover:text-fg" onClick={() => onChange({ edited: undefined })}>
                Reset
              </button>
            )}
          </>
        )}
        {!error &&
          (isNew ? (
            <span className="rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-[11px] font-semibold text-warn">
              {edited && editedCodeToAdd(value, known) ? "New code (added to the list when saved)" : "New code (not in the product code list)"}
            </span>
          ) : (
            <span className="rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[11px] font-semibold text-pos">Existing code</span>
          ))}
        {showErrors && error && <span className="text-[12px] text-neg">{error}</span>}
      </div>
    </>
  );
}
