"use client";

import { useState } from "react";
import { customKey, type TechDocRow } from "../../lib/tech-doc";

// Edit mode of a Risansi sheet (Technical Data Sheet, Commercial Offer): every
// row, per section, as editable cells. For this document only — the wizard
// data / saved prices are never changed. Catalogue rows: rename the parameter,
// edit a tag's value (reset brings back the automatic value), remove /
// restore. Manual rows: name and values typed in, deleted outright. A "span"
// row has one value across all tags (keyed "all").

/** The editable part of a sheet's config (TechDocConfig, OfferConfig). */
export type EditableDocConfig = {
  hidden: string[];
  labels: Record<string, string>;
  values: Record<string, Record<string, string>>;
  custom: { id: string; section: string; label: string; values: Record<string, string> }[];
};

const cellCls =
  "w-full rounded-md border bg-paper px-2 py-1 text-[12.5px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-50";
const linkBtn = "text-[11.5px] font-semibold whitespace-nowrap hover:underline disabled:cursor-not-allowed disabled:opacity-50";

const newId = () => Math.random().toString(36).slice(2, 10);

/** One header line in the editor. `onChange` absent = shown, not editable. */
export type DocHeaderField = {
  key: string;
  label: string;
  /** The typed text ("" = automatic). */
  value: string;
  /** The automatic value (prefilled into the box). */
  auto: string;
  onChange?: (v: string) => void;
};

/** The sheet header's lines: each can be removed / restored; the editable
 *  ones (quotation / ERP) are prefilled with their automatic value — typing
 *  replaces it, Reset brings it back. For this document only. */
export function DocHeaderEditor({
  fields,
  hidden,
  onHiddenChange,
}: {
  fields: DocHeaderField[];
  hidden: string[];
  onHiddenChange: (next: string[]) => void;
}) {
  return (
    <section className="rounded-lg border border-line">
      <h4 className="bg-[#dcebfb] px-3 py-1.5 text-center text-[12.5px] font-semibold text-[#0b3d7e]">Header</h4>
      <div className="flex flex-col divide-y divide-line">
        {fields.map((f) => {
          const removed = hidden.includes(f.key);
          const edited = !!f.value && f.value !== f.auto;
          return (
            <div
              key={f.key}
              className={`grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[200px_1fr_auto] ${removed ? "bg-sunk" : ""}`}
            >
              <span className={`text-[12.5px] font-semibold ${removed ? "text-fg-4 line-through" : "text-fg"}`}>{f.label}</span>
              {f.onChange && !removed ? (
                <input
                  className={`${cellCls} ${edited ? "border-accent" : "border-line"}`}
                  value={f.value || f.auto}
                  maxLength={300}
                  placeholder="—"
                  onChange={(e) => f.onChange?.(e.target.value === f.auto ? "" : e.target.value)}
                  aria-label={f.label}
                />
              ) : (
                <span className={`px-2 text-[12.5px] ${removed ? "text-fg-4" : "text-fg-2"}`}>
                  {removed ? "Removed from the sheet" : f.value || f.auto || "—"}
                </span>
              )}
              <span className="flex items-center gap-3">
                {f.onChange && !removed && (
                  <button
                    type="button"
                    className={`${linkBtn} text-fg-3 hover:text-accent`}
                    onClick={() => f.onChange?.("")}
                    disabled={!edited}
                    title={f.auto ? `Automatic: ${f.auto}` : "Back to the automatic value"}
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  className={`${linkBtn} ${removed ? "text-accent" : "text-neg"}`}
                  onClick={() => onHiddenChange(removed ? hidden.filter((k) => k !== f.key) : [...hidden, f.key])}
                >
                  {removed ? "Restore" : "Remove"}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function TechDocEditor<C extends EditableDocConfig>({
  tags,
  blocks,
  config,
  onChange: emit,
  valueHint = "Wizard value",
}: {
  tags: { tagId: string; tagName: string }[];
  /** The sheet's rows, built with removed rows included. */
  blocks: { title: string; rows: TechDocRow[] }[];
  config: C;
  onChange: (next: C) => void;
  /** Tooltip prefix on a cell's Reset ("Wizard value", "Saved price"). */
  valueHint?: string;
}) {
  const onChange = (next: EditableDocConfig) => emit(next as C);

  // --- config updates ---------------------------------------------------------
  const setLabel = (row: TechDocRow, label: string) => {
    if (row.kind === "custom") {
      onChange({ ...config, custom: config.custom.map((c) => (customKey(c.id) === row.key ? { ...c, label } : c)) });
      return;
    }
    const labels = { ...config.labels };
    if (!label.trim() || label === row.autoLabel) delete labels[row.key];
    else labels[row.key] = label;
    onChange({ ...config, labels });
  };

  const setValue = (row: TechDocRow, tagIndex: number, value: string) => {
    const tagId = row.span ? "all" : tags[tagIndex].tagId;
    if (row.kind === "custom") {
      onChange({
        ...config,
        custom: config.custom.map((c) =>
          customKey(c.id) === row.key ? { ...c, values: { ...c.values, [tagId]: value } } : c,
        ),
      });
      return;
    }
    const perTag = { ...(config.values[row.key] ?? {}) };
    // Typing the wizard value back is the same as no edit.
    if (value === row.autoValues[tagIndex]) delete perTag[tagId];
    else perTag[tagId] = value;
    const values = { ...config.values };
    if (Object.keys(perTag).length) values[row.key] = perTag;
    else delete values[row.key];
    onChange({ ...config, values });
  };

  const setHidden = (row: TechDocRow, hide: boolean) =>
    onChange({
      ...config,
      hidden: hide ? [...config.hidden, row.key] : config.hidden.filter((k) => k !== row.key),
    });

  const deleteCustom = (row: TechDocRow) => {
    const values = { ...config.values };
    delete values[row.key];
    onChange({ ...config, values, custom: config.custom.filter((c) => customKey(c.id) !== row.key) });
  };

  const addCustom = (section: string, label: string) =>
    onChange({ ...config, custom: [...config.custom, { id: newId(), section, label, values: {} }] });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-fg-3">
        Changes here apply to this enquiry&apos;s document only — the pump selection itself is not changed.{" "}
        <span className="rounded bg-[var(--warn-soft)] px-1 text-warn">Highlighted</span> cells were edited by hand.
      </p>
      {blocks.map((block) => (
        <section key={block.title} className="overflow-hidden rounded-lg border border-line">
          <h4 className="bg-[#dcebfb] px-3 py-1.5 text-center text-[12.5px] font-semibold text-[#0b3d7e]">{block.title}</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-sunk text-left text-[11px] font-semibold tracking-[0.06em] text-fg-3 uppercase">
                  <th className="w-[26%] px-2 py-1.5">Parameter</th>
                  {tags.map((t) => (
                    <th key={t.tagId} className="px-2 py-1.5">
                      {t.tagName}
                    </th>
                  ))}
                  <th className="w-[96px] px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.key} className={`border-b border-line last:border-b-0 ${row.hidden ? "bg-sunk/60" : ""}`}>
                    <td className="px-2 py-1 align-top">
                      <input
                        className={`${cellCls} font-semibold ${row.hidden ? "line-through" : ""} ${
                          row.kind !== "custom" && row.label !== row.autoLabel ? "border-warn bg-[var(--warn-soft)]" : "border-line"
                        }`}
                        value={row.label}
                        disabled={row.hidden}
                        onChange={(e) => setLabel(row, e.target.value)}
                        aria-label="Parameter name"
                      />
                      {row.kind !== "custom" && row.label !== row.autoLabel && !row.hidden && (
                        <button type="button" className={`${linkBtn} mt-0.5 text-accent`} onClick={() => setLabel(row, row.autoLabel)}>
                          Reset name ({row.autoLabel})
                        </button>
                      )}
                      {row.kind === "custom" && <span className="mt-0.5 block text-[10.5px] text-fg-3">Added by hand</span>}
                    </td>
                    {row.values.map((v, i) => (
                      <td
                        key={row.span ? "all" : tags[i].tagId}
                        colSpan={row.span ? Math.max(tags.length, 1) : undefined}
                        className="px-2 py-1 align-top"
                      >
                        <input
                          className={`${cellCls} ${row.edited[i] && row.kind !== "custom" ? "border-warn bg-[var(--warn-soft)]" : "border-line"}`}
                          value={v}
                          placeholder="-"
                          disabled={row.hidden}
                          onChange={(e) => setValue(row, i, e.target.value)}
                          aria-label={row.span ? row.label : `${row.label} — ${tags[i].tagName}`}
                        />
                        {row.edited[i] && row.kind !== "custom" && !row.hidden && (
                          <button
                            type="button"
                            className={`${linkBtn} mt-0.5 text-accent`}
                            onClick={() => setValue(row, i, row.autoValues[i])}
                            title={`${valueHint}: ${row.autoValues[i] || "-"}`}
                          >
                            Reset
                          </button>
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right align-top">
                      {row.kind === "custom" ? (
                        <button type="button" className={`${linkBtn} text-neg`} onClick={() => deleteCustom(row)}>
                          Delete
                        </button>
                      ) : row.hidden ? (
                        <button type="button" className={`${linkBtn} text-accent`} onClick={() => setHidden(row, false)}>
                          Restore
                        </button>
                      ) : (
                        <button type="button" className={`${linkBtn} text-neg`} onClick={() => setHidden(row, true)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <AddRow onAdd={(label) => addCustom(block.title, label)} colSpan={tags.length + 2} />
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function AddRow({ onAdd, colSpan }: { onAdd: (label: string) => void; colSpan: number }) {
  const [label, setLabel] = useState("");
  const add = () => {
    if (!label.trim()) return;
    onAdd(label.trim());
    setLabel("");
  };
  return (
    <tr className="bg-sunk/40">
      <td colSpan={colSpan} className="px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${cellCls} max-w-[280px] border-line`}
            value={label}
            maxLength={300}
            placeholder="New parameter name, e.g. Test Pressure"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            aria-label="New parameter name"
          />
          <button
            type="button"
            onClick={add}
            disabled={!label.trim()}
            className="rounded-md border border-line bg-paper px-2.5 py-1 text-[12px] font-semibold text-accent hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Add row
          </button>
          <span className="text-[11px] text-fg-3">then type its value for each tag above</span>
        </div>
      </td>
    </tr>
  );
}
