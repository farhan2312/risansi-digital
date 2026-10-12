"use client";

import { useCallback, useEffect, useState } from "react";

import "./GeneralInformationStep.css";
import Stepper from "./Stepper";
import { actions, btnGhost } from "./formStyles";
import PumpQtyStep from "../../screens/commercial/PumpQtyStep";
import { getCommercialSummary } from "../../services/commercialService";
import type { CommercialTag } from "../../lib/commercial";

type Props = {
  onNext: () => void;
  onPrevious: () => void;
  onStepClick?: (step: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  projectId?: string;
  tagId?: string;
  projectCode?: string;
  projectName?: string | null;
  /** Resolves once the step-leave saves in flight have landed. */
  savesSettled?: () => Promise<unknown>;
};

/**
 * Wizard step 8 — Pump & Qty (after Drive): the open tag's pump product code
 * (built from its parts, prefilled from the selection, or picked from the
 * list) and the number of pumps. Same editor the Commercial page used to have
 * (screens/commercial/PumpQtyStep.tsx), for this one tag; it saves the tag's
 * pump_model_qty_input itself. Read from the saved wizard data, so the steps
 * before it are already saved when it opens.
 */
const PumpQtyWizardStep = ({
  onNext,
  onPrevious,
  onStepClick,
  formData,
  projectId,
  tagId,
  projectCode,
  projectName,
  savesSettled,
}: Props) => {
  const [tag, setTag] = useState<CommercialTag | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!projectId || !tagId) return;
    setError("");
    // Wait for the Drive step's save (just left) so the prefill reads it.
    Promise.resolve(savesSettled?.())
      .catch(() => {})
      .then(() => getCommercialSummary(projectId))
      .then((s) => {
        const t = s.tags.find((x) => x.tagId === tagId);
        if (t) setTag(t);
        else setError("This tag could not be found on the enquiry.");
      })
      .catch(() => setError("Couldn't load this tag's pump details. Try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tagId]);
  useEffect(load, [load]);

  return (
    <div className="step-container">
      <Stepper currentStep={8} maxStep={formData.wizardMaxStep} onStepClick={onStepClick} />

      <div className="step-card">
        <h2>Pump &amp; Qty</h2>
        <p>
          Build this tag&apos;s pump product code from its parts (prefilled from the selection) or pick an existing
          one, and set the number of pumps. The Commercial Summary prices it from here.
        </p>

        {!projectId || !tagId ? (
          <p className="text-[13px] text-fg-3">No tag is open.</p>
        ) : error ? (
          <p className="text-[13px] text-neg">
            {error}{" "}
            <button type="button" className="font-semibold text-accent hover:underline" onClick={load}>
              Retry
            </button>
          </p>
        ) : !tag ? (
          <p className="py-6 text-center text-[13px] text-fg-3">Loading…</p>
        ) : (
          <PumpQtyStep
            projectId={projectId}
            projectCode={projectCode ?? ""}
            projectName={projectName ?? null}
            tags={[tag]}
            nextLabel="Save & Next →"
            onSaved={(_, productCode, quantity, codeParts) => setTag((t) => (t ? { ...t, productCode, quantity, codeParts } : t))}
            onNext={onNext}
          />
        )}

        <div className={actions}>
          <button className={btnGhost} onClick={onPrevious}>
            Previous
          </button>
        </div>
      </div>
    </div>
  );
};

export default PumpQtyWizardStep;
