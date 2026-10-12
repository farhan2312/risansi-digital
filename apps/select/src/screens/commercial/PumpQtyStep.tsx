"use client";

import { useEffect, useMemo, useState } from "react";

import ProductCodeSelect from "../../components/pump-selection/ProductCodeSelect";
import { DRIVE_GROUP_LABEL, type CommercialTag } from "../../lib/commercial";
import {
  CODE_SEGMENTS,
  EMPTY_PARTS,
  SEGMENT_DB,
  buildPumpCode,
  fieldsFromParts,
  missingParts,
  partsFromHints,
  usesSubSealing,
  type CodeOption,
  type CodeParts,
  type CodeSegmentKey,
} from "../../lib/pump-code";
import EnquiryDocumentModal from "../../components/reports/EnquiryDocumentModal";
import { listProductPumps } from "../../services/productPumpService";
import { addPumpCodeOption, listPumpCodeOptions } from "../../services/pumpCodeService";
import { saveWizardInput } from "../../services/wizardInputService";

// Commercial step 1 — Pump & Qty: per tag the ERP pump product code and the
// number of pumps. The code is BUILT from its parts (lib/pump-code.ts — series,
// sub-category, size, stage, model, MOC, rubber, sealing, housing; prefilled
// from the pump selection) or PICKED from the existing product_pump list. A
// built code that isn't in product_pump yet is added on save. Saved to
// pump_model_qty_input (product_code + the parts).

type Mode = "build" | "pick";
type Row = { mode: Mode; parts: CodeParts; picked: string; quantity: string };

const ADD = "__add__";

const errorsOf = (r: Row) => {
  const missing = r.mode === "build" ? missingParts(r.parts) : [];
  return {
    code:
      r.mode === "build"
        ? missing.length
          ? `Pick: ${missing.map((k) => CODE_SEGMENTS.find((s) => s.key === k)!.label).join(", ")}.`
          : ""
        : r.picked
          ? ""
          : "Pick the pump product code.",
    quantity: /^[1-9]\d*$/.test(r.quantity.trim()) ? "" : "Enter a whole number, 1 or more.",
  };
};

const codeOf = (r: Row) => (r.mode === "build" ? buildPumpCode(r.parts) : r.picked);

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const selectCls =
  "w-full rounded-lg border bg-paper px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-50";

// The code options + known product codes, shared between an early start (the
// Commercial page calls loadPumpQtyLists() on open, alongside the summary)
// and this step's mount. Kept 30 s; dropped on failure or when an option is added.
let lists: { at: number; p: Promise<[CodeOption[], { productCode: string }[]]> } | null = null;
export function loadPumpQtyLists() {
  if (!lists || Date.now() - lists.at > 30_000) {
    const p = Promise.all([listPumpCodeOptions(), listProductPumps()]);
    lists = { at: Date.now(), p };
    p.catch(() => {
      if (lists?.p === p) lists = null;
    });
  }
  return lists.p;
}

export default function PumpQtyStep({
  projectId,
  projectCode,
  projectName,
  tags,
  onSaved,
  onNext,
}: {
  projectId: string;
  /** For the Technical Data Sheet button. */
  projectCode: string;
  projectName: string | null;
  tags: CommercialTag[];
  /** A tag's saved code, quantity and parts, so the page's data follows. */
  onSaved: (tagId: string, productCode: string, quantity: number, codeParts: CodeParts | null) => void;
  onNext: () => void;
}) {
  const [options, setOptions] = useState<CodeOption[] | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadPumpQtyLists()
      .then(([opts, pumps]) => {
        if (cancelled) return;
        setOptions(opts);
        setKnown(new Set(pumps.map((p) => p.productCode.toUpperCase())));
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the pump code options."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) return <p className="rounded-xl border border-line bg-paper p-5 text-[13px] text-neg">{loadError}</p>;
  if (!options) return <p className="rounded-xl border border-line bg-paper p-5 text-center text-[13px] text-fg-3">Loading…</p>;
  return (
    <Editor
      techSource={{ projectId, projectCode, projectName }}
      projectId={projectId}
      tags={tags}
      options={options}
      known={known}
      onOptionAdded={(o) => {
        lists = null;
        setOptions((list) => [...(list ?? []), o]);
      }}
      onSaved={onSaved}
      onNext={onNext}
    />
  );
}

function Editor({
  techSource,
  projectId,
  tags,
  options,
  known,
  onOptionAdded,
  onSaved,
  onNext,
}: {
  techSource: { projectId: string; projectCode: string; projectName: string | null };
  projectId: string;
  tags: CommercialTag[];
  options: CodeOption[];
  known: Set<string>;
  onOptionAdded: (o: CodeOption) => void;
  onSaved: (tagId: string, productCode: string, quantity: number, codeParts: CodeParts | null) => void;
  onNext: () => void;
}) {
  // What is saved now, per tag — the baseline for "changed".
  const saved = useMemo(
    () =>
      Object.fromEntries(
        tags.map((t) => [
          t.tagId,
          { code: t.productCode ?? "", quantity: t.quantity === null ? "" : String(t.quantity), parts: t.codeParts },
        ]),
      ),
    [tags],
  );
  // Built parts when saved that way; a code picked from the list opens on
  // "pick"; a new tag opens on "build", prefilled from the pump selection.
  const startRow = (t: CommercialTag): Row => ({
    mode: t.codeParts || !t.productCode ? "build" : "pick",
    parts: t.codeParts ?? { ...EMPTY_PARTS, ...partsFromHints(t.codeHints, options) },
    picked: t.productCode ?? "",
    quantity: t.quantity === null ? "1" : String(t.quantity),
  });
  const [rowState, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(tags.map((t) => [t.tagId, startRow(t)])));
  const rows: Record<string, Row> = Object.fromEntries(tags.map((t) => [t.tagId, rowState[t.tagId] ?? startRow(t)]));
  const [showErrors, setShowErrors] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedOnce, setSavedOnce] = useState(false);
  const [adding, setAdding] = useState<{ tagId: string; segment: CodeSegmentKey; text: string; error: string } | null>(null);

  const set = (id: string, patch: Partial<Row>) => {
    setRows((m) => ({ ...m, [id]: { ...rows[id], ...m[id], ...patch } }));
    setSavedOnce(false);
  };
  const setPart = (id: string, key: CodeSegmentKey, value: string) => {
    setSavedOnce(false);
    setRows((m) => {
      const base = m[id] ?? rows[id];
      const parts = { ...base.parts, [key]: value };
      if (key === "sealing" && value !== "MS") parts.subSealing = "";
      return { ...m, [id]: { ...base, parts } };
    });
  };

  const ids = tags.map((t) => t.tagId);
  const dirtyIds = ids.filter((id) => {
    const r = rows[id];
    const s = saved[id];
    const partsNow = r.mode === "build" ? JSON.stringify(r.parts) : "null";
    const partsSaved = s.parts ? JSON.stringify(s.parts) : "null";
    return codeOf(r) !== s.code || r.quantity.trim() !== s.quantity || partsNow !== partsSaved;
  });
  const invalidIds = ids.filter((id) => Object.values(errorsOf(rows[id])).some(Boolean));

  /** Saves every changed, valid row. Returns true when nothing is left invalid. */
  const save = async (): Promise<boolean> => {
    setSaveError("");
    if (invalidIds.length > 0) setShowErrors(true);
    const toSave = dirtyIds.filter((id) => !invalidIds.includes(id));
    if (toSave.length === 0) return invalidIds.length === 0;
    setSaving(true);
    try {
      for (const id of toSave) {
        const r = rows[id];
        // A built code is saved on the tag only — never added to the product
        // code list (that list is for picking existing codes; user 2026-10-07).
        const code = codeOf(r);
        const parts = r.mode === "build" ? r.parts : null;
        const quantity = r.quantity.trim();
        await saveWizardInput(
          "pump-model-qty",
          projectId,
          { productCode: code, pumpFamily: "PCP", quantity, ...fieldsFromParts(parts) },
          id,
        );
        onSaved(id, code, Number(quantity), parts);
      }
      setSavedOnce(true);
      return invalidIds.length === 0;
    } catch {
      setSaveError("Couldn't save — check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addOption = async () => {
    if (!adding) return;
    const text = adding.text.trim();
    if (!text) return;
    try {
      const o = await addPumpCodeOption(SEGMENT_DB[adding.segment], text);
      if (!options.some((x) => x.segment === o.segment && x.code === o.code)) onOptionAdded(o);
      setPart(adding.tagId, adding.segment, o.code);
      setAdding(null);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAdding((a) => (a ? { ...a, error: msg || "Couldn't add it." } : a));
    }
  };

  return (
    <section className="rounded-xl border border-line bg-paper">
      {showTech && <EnquiryDocumentModal source={techSource} onClose={() => setShowTech(false)} />}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-fg">Pump &amp; Qty</h2>
          <p className="text-[12px] text-fg-3">
            Build each tag&apos;s pump product code from its parts (prefilled from the pump selection) or pick an existing
            one, and set the number of pumps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btn}
            onClick={() => setShowTech(true)}
            title="View this enquiry's Technical Data Sheet"
          >
            Technical
          </button>
          {savedOnce && dirtyIds.length === 0 && <span className="text-[12px] font-medium text-pos">Saved</span>}
          <button type="button" className={btn} onClick={() => void save()} disabled={saving || dirtyIds.length === 0}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save().then((ok) => ok && onNext())} disabled={saving}>
            Next: Summary →
          </button>
        </div>
      </header>

      <div className="flex flex-col divide-y divide-line">
        {tags.map((t) => {
          const r = rows[t.tagId];
          const err = errorsOf(r);
          const code = codeOf(r);
          const isNew = r.mode === "build" && !err.code && !known.has(code.toUpperCase());
          return (
            <div key={t.tagId} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-fg">
                    {t.tagName}
                    <span className="ml-2 text-[12.5px] font-normal text-fg-3">
                      {t.model ?? "No pump selected"}
                      {t.model && !t.modelConfirmed ? " (not confirmed)" : ""} ·{" "}
                      {t.driveGroup ? DRIVE_GROUP_LABEL[t.driveGroup] : "No drive yet"} · Pump type PCP
                    </span>
                  </p>
                  <div className="mt-1.5 inline-flex rounded-lg border border-line bg-sunk p-0.5" role="tablist">
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
                        aria-selected={r.mode === m}
                        onClick={() => set(t.tagId, { mode: m })}
                        className={`rounded-md px-3 py-1 text-[12px] font-semibold ${
                          r.mode === m ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex w-[140px] flex-col gap-1">
                  <span className="text-[11.5px] font-semibold text-fg-3">Quantity (Nos)</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    className={`${selectCls} text-right font-mono ${showErrors && err.quantity ? "border-neg" : "border-line"}`}
                    value={r.quantity}
                    onChange={(e) => set(t.tagId, { quantity: e.target.value })}
                    aria-label={`Quantity for ${t.tagName}`}
                  />
                  {showErrors && err.quantity && <span className="text-[11.5px] text-neg">{err.quantity}</span>}
                </label>
              </div>

              {r.mode === "build" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {CODE_SEGMENTS.map((seg) => {
                      const opts = options.filter((o) => o.segment === SEGMENT_DB[seg.key]);
                      const disabled = seg.key === "subSealing" && !usesSubSealing(r.parts);
                      const missing = showErrors && !disabled && !r.parts[seg.key] && (seg.required || seg.key === "subSealing");
                      return (
                        <label key={seg.key} className="flex min-w-0 flex-col gap-1">
                          <span className="text-[11.5px] font-semibold text-fg-3">
                            {seg.label}
                            {!seg.required && seg.key !== "subSealing" && <span className="font-normal"> (optional)</span>}
                          </span>
                          <select
                            className={`${selectCls} ${missing ? "border-neg" : "border-line"}`}
                            value={r.parts[seg.key]}
                            disabled={disabled}
                            onChange={(e) =>
                              e.target.value === ADD
                                ? setAdding({ tagId: t.tagId, segment: seg.key, text: "", error: "" })
                                : setPart(t.tagId, seg.key, e.target.value)
                            }
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

                  {adding?.tagId === t.tagId && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunk p-2">
                      <span className="text-[12px] font-semibold text-fg-2">
                        New {CODE_SEGMENTS.find((s) => s.key === adding.segment)!.label.toLowerCase()}:
                      </span>
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
                    <span className="rounded-md bg-sunk px-2.5 py-1 font-mono text-[13.5px] font-semibold tracking-wide text-fg">
                      {code || "—"}
                    </span>
                    {!err.code &&
                      (isNew ? (
                        <span className="rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-[11px] font-semibold text-warn">
                          New code (not in the product code list)
                        </span>
                      ) : (
                        <span className="rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[11px] font-semibold text-pos">
                          Existing code
                        </span>
                      ))}
                    {showErrors && err.code && <span className="text-[12px] text-neg">{err.code}</span>}
                  </div>
                </>
              ) : (
                <div className="max-w-[520px]">
                  <ProductCodeSelect
                    value={r.picked}
                    invalid={showErrors && !!err.code}
                    onChange={(productCode) => set(t.tagId, { picked: productCode })}
                  />
                  {showErrors && err.code && <span className="mt-1 block text-[11.5px] text-neg">{err.code}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(saveError || (showErrors && invalidIds.length > 0)) && (
        <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-neg">
          {saveError ||
            `${invalidIds.length} tag${invalidIds.length === 1 ? " needs" : "s need"} a complete product code and quantity before the Summary.`}
        </p>
      )}
    </section>
  );
}
