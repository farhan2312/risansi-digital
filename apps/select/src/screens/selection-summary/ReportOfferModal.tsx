"use client";

import { useEffect, useMemo, useState } from "react";

import CommercialOfferModal from "../commercial/CommercialOfferModal";
import TechnoCommercialModal from "../commercial/TechnoCommercialModal";
import { DRIVE_GROUP_LABEL, quoteFxOf, subTotal, unitTotal, type CommercialSummary, type DriveGroup } from "../../lib/commercial";
import type { OfferTag } from "../../lib/commercial-offer";
import { getCommercialSummary } from "../../services/commercialService";

// Reports page: opens an enquiry's Commercial Offer or Techno-Commercial sheet
// from its saved prices - the same sheets as the Commercial Summary. Both are
// per drive group, so an enquiry quoting more than one group picks one first.

export default function ReportOfferModal({
  projectId,
  projectCode,
  kind,
  readOnly,
  onClose,
}: {
  projectId: string;
  projectCode: string;
  kind: "commercial" | "techno";
  /** A worker the enquiry is not assigned to only views it. */
  readOnly: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<CommercialSummary | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<DriveGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommercialSummary(projectId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError("Couldn't load this enquiry's prices."));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Drive groups present on the enquiry (tags with no drive yet have no sheet).
  const groups = useMemo(
    () => [...new Set((data?.tags ?? []).map((t) => t.driveGroup).filter((g): g is DriveGroup => Boolean(g)))],
    [data],
  );
  const picked = group ?? (groups.length === 1 ? groups[0] : null);

  const tags: OfferTag[] = useMemo(
    () =>
      (data?.tags ?? [])
        .filter((t) => t.driveGroup === picked)
        .map((t) => ({
          tagId: t.tagId,
          tagName: t.tagName,
          tech: t.tech,
          pumpModel: t.productCode ?? t.model,
          prices: t.prices,
          quantity: t.quantity,
          unit: unitTotal(t.prices),
          sub: subTotal(t.prices, t.quantity),
        })),
    [data, picked],
  );

  if (data && picked) {
    const fx = quoteFxOf(data.project);
    return kind === "commercial" ? (
      <CommercialOfferModal projectId={projectId} group={picked} tags={tags} fx={fx} readOnly={readOnly} onClose={onClose} />
    ) : (
      <TechnoCommercialModal projectId={projectId} group={picked} tags={tags} fx={fx} readOnly={readOnly} onClose={onClose} />
    );
  }

  const title = kind === "commercial" ? "Commercial Offer" : "Techno-Commercial";
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(10,22,40,0.55)] p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-2xl border border-line bg-paper p-5 shadow-[0_24px_64px_rgba(10,22,40,0.28)]"
      >
        <h2 className="text-[16px] font-semibold text-title">{title}</h2>
        <p className="mt-0.5 font-mono text-[12px] text-fg-3">{projectCode}</p>
        <div className="mt-4">
          {error && <p className="text-[13px] text-neg">{error}</p>}
          {!error && !data && <p className="text-[13px] text-fg-3">Loading…</p>}
          {data && groups.length === 0 && (
            <p className="text-[13px] text-fg-3">No tag on this enquiry has a drive system yet, so there is no sheet to show.</p>
          )}
          {data && groups.length > 1 && (
            <>
              <p className="mb-2.5 text-[12.5px] text-fg-3">This enquiry is quoted per drive system - pick one:</p>
              <div className="flex flex-col gap-2">
                {groups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroup(g)}
                    className="flex items-center justify-between rounded-lg border border-line bg-paper px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-fg transition hover:border-accent hover:bg-accent-soft hover:text-accent"
                  >
                    {DRIVE_GROUP_LABEL[g]}
                    <span className="text-[12px] font-medium text-fg-3">
                      {data.tags.filter((t) => t.driveGroup === g).length} tag(s)
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-line-strong bg-paper px-4 text-[13px] font-semibold text-fg-2 hover:bg-elev"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
