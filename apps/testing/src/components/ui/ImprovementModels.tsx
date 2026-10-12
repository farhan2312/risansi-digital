"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ChartCard from "@/components/charts/ChartCard";
import { getImprovementModels } from "@/services/testingService";
import { normalizeModelKey } from "@/lib/modelKey";
import type { ImprovementModelRow, ImprovementModelsResult } from "@/types/testing";

/** Loads the models that are on the Improvement Projects list (see GET /api/performance?view=improvement-models):
 * models with reports below their VE / ME acceptance, none of whose reports meets both. `enabled` lets a caller
 * that only sometimes needs it (the drill-down pop-up) skip the request. */
export const useImprovementModels = (enabled = true) => {
  const [data, setData] = useState<ImprovementModelsResult | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    setError("");
    getImprovementModels()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the improvement models. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, isLoading, error };
};

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
const tone = (meets: boolean | null) =>
  meets === false ? "font-semibold text-neg-strong" : meets === true ? "font-semibold text-pos-strong" : "text-text-muted";

/** One row per model: how many of its reports are below acceptance, what is required, and where its latest test stands. */
export const ImprovementModelRows = ({ models }: { models: ImprovementModelRow[] }) => (
  <ul className="m-0 flex list-none flex-col p-0">
    {models.map((m) => (
      <li key={m.model} className="border-b border-border last:border-b-0">
        <Link
          href={`/pumps/${encodeURIComponent(m.model)}`}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 no-underline transition-colors hover:bg-surface-hover hover:no-underline"
        >
          <div className="min-w-0">
            <div className="text-sm font-bold text-accent">{m.model}</div>
            <div className="text-[11px] text-text-muted">
              {m.improvement_reports} report{m.improvement_reports === 1 ? "" : "s"} below acceptance · {m.report_count} tested
            </div>
          </div>
          <div className="text-right text-[11px] text-text-muted">
            {m.acceptance && (
              <div>
                Required: VE ≥ {m.acceptance.ve}% · ME ≥ {m.acceptance.me}%
              </div>
            )}
            <div>
              Latest {m.latest_report_no ?? "–"}: <span className={tone(m.latest_ve_meets)}>VE {pct(m.latest_ve)}</span> ·{" "}
              <span className={tone(m.latest_me_meets)}>ME {pct(m.latest_me)}</span>
            </div>
          </div>
        </Link>
      </li>
    ))}
  </ul>
);

/** The Dashboard's view for "Against Improvement Project": just the models, not requisition figures. */
const ImprovementModelsPanel = ({ modelFilter = "" }: { modelFilter?: string }) => {
  const { data, isLoading, error } = useImprovementModels();

  const rows = useMemo(() => {
    const all = data?.models ?? [];
    const key = modelFilter ? normalizeModelKey(modelFilter) : "";
    return key ? all.filter((m) => normalizeModelKey(m.model) === key) : all;
  }, [data, modelFilter]);

  return (
    <ChartCard
      variant="panel"
      title="Improvement Projects"
      icon={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </svg>
      }
      subtitle={
        isLoading ? "Loading…" : `${rows.length} model${rows.length === 1 ? "" : "s"} with reports below VE / ME acceptance and none that meets both yet`
      }
      actions={
        <Link href="/performance" className="rounded-md px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft">
          Open VE &amp; ME Performance &rarr;
        </Link>
      }
    >
      <div className="-m-5">
        {error && <p className="m-0 px-5 py-6 text-sm font-medium text-neg">{error}</p>}
        {!error && isLoading && <p className="m-0 px-5 py-6 text-sm text-text-muted">Loading the improvement models…</p>}
        {!error && !isLoading && rows.length === 0 && (
          <p className="m-0 px-5 py-8 text-center text-sm text-text-muted">
            {modelFilter ? `${modelFilter} is not an improvement model.` : "No model needs improvement right now."}
          </p>
        )}
        {!error && rows.length > 0 && <ImprovementModelRows models={rows} />}
        {!error && !isLoading && (
          <p className="m-0 border-t border-border px-5 py-3 text-xs text-text-muted">
            A model leaves this list once any one of its reports meets both its VE and ME acceptance value.
            {data && data.not_listed.length > 0 && (
              <>
                {" "}
                <span className="font-semibold text-text">Not listed ({data.not_listed.length}):</span> {data.not_listed.join(", ")}.
              </>
            )}{" "}
            This view uses every test report, so the date range, scope and status filters above do not apply.
          </p>
        )}
      </div>
    </ChartCard>
  );
};

export default ImprovementModelsPanel;
