"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  PAYMENT_AGAINST_DOCUMENTS,
  PAYMENT_DOCUMENT_OPTIONS,
  PAYMENT_TERM_OPTIONS,
  TERMS_WITH_DAYS,
} from "@/lib/order-schema";

/** One payment term line on a new SO, before it is saved. */
export type NewTermLine = { term: string; percent: string; days: string; documents: string[] };

export const blankTermLine = (): NewTermLine => ({ term: "", percent: "", days: "", documents: [] });

/** The first thing wrong with the lines, or null. A line with no term is ignored. */
export function termLinesError(lines: NewTermLine[]): string | null {
  for (const [i, l] of lines.entries()) {
    if (!l.term) continue;
    if (l.term === PAYMENT_AGAINST_DOCUMENTS && l.documents.length === 0) {
      return `Term ${i + 1}: choose the required documents.`;
    }
  }
  const total = lines.filter((l) => l.term).reduce((n, l) => n + (Number(l.percent) || 0), 0);
  if (total > 100) return `The payment terms add up to ${total}% — more than 100%.`;
  return null;
}

/** A line as saved: days only where the term takes days, documents only for Payment Against Documents. */
export function termLineValues(l: NewTermLine): Record<string, string> {
  return {
    term: l.term,
    percent: l.percent,
    days: TERMS_WITH_DAYS.includes(l.term) ? l.days : "",
    // In the list's own order, whatever order they were ticked in.
    documents:
      l.term === PAYMENT_AGAINST_DOCUMENTS
        ? PAYMENT_DOCUMENT_OPTIONS.map((o) => o.value).filter((d) => l.documents.includes(d)).join(", ")
        : "",
  };
}

const control =
  "h-10 rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * The new SO's payment terms as lines — the same lines the SO's own page
 * keeps (term, %, days, documents) — instead of a free-text box. They are
 * saved with the SO.
 */
export function NewOrderTerms({
  lines,
  onChange,
}: {
  lines: NewTermLine[];
  onChange: (next: NewTermLine[]) => void;
}) {
  const set = (i: number, patch: Partial<NewTermLine>) =>
    onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const total = lines.filter((l) => l.term).reduce((n, l) => n + (Number(l.percent) || 0), 0);
  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const needsDays = TERMS_WITH_DAYS.includes(l.term);
        const needsDocs = l.term === PAYMENT_AGAINST_DOCUMENTS;
        return (
          <div key={i} className="rounded-xl border border-card-border bg-background/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Term ${i + 1}`}
                value={l.term}
                onChange={(e) => set(i, { term: e.target.value })}
                className={`${control} min-w-[14rem] flex-1 cursor-pointer`}
              >
                <option value="">Choose a term…</option>
                {PAYMENT_TERM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-sm text-muted">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  aria-label={`Term ${i + 1} percent`}
                  value={l.percent}
                  onChange={(e) => set(i, { percent: e.target.value })}
                  placeholder="%"
                  className={`${control} w-20`}
                />
                %
              </label>
              {needsDays && (
                <label className="inline-flex items-center gap-1.5 text-sm text-muted">
                  <input
                    type="number"
                    min={0}
                    aria-label={`Term ${i + 1} days`}
                    value={l.days}
                    onChange={(e) => set(i, { days: e.target.value })}
                    placeholder="Days"
                    className={`${control} w-24`}
                  />
                  days
                </label>
              )}
              <button
                type="button"
                onClick={() => onChange(lines.length > 1 ? lines.filter((_, k) => k !== i) : [blankTermLine()])}
                aria-label={`Remove term ${i + 1}`}
                className="ml-auto rounded-lg p-2 text-rose-500 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {needsDocs && (
              <div className="mt-2">
                <p className="mb-1 text-[12px] font-medium text-brand-label">Required documents</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {PAYMENT_DOCUMENT_OPTIONS.map((o) => (
                    <label key={o.value} className="inline-flex items-center gap-1.5 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={l.documents.includes(o.value)}
                        onChange={(e) =>
                          set(i, {
                            documents: e.target.checked
                              ? [...l.documents, o.value]
                              : l.documents.filter((d) => d !== o.value),
                          })
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange([...lines, blankTermLine()])}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Add term
        </button>
        <span className={`text-sm font-medium ${total === 100 ? "text-emerald-700" : total > 100 ? "text-danger" : "text-muted"}`}>
          Total {total}%
        </span>
      </div>
    </div>
  );
}
