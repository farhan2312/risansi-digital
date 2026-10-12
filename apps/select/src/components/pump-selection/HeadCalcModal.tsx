"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { HeadCalculatorView, type CalcMode } from "../../screens/head-calculator/HeadCalculatorPage";
import { calculateHead, type HeadCalcInput } from "../../lib/head-calculator";
import { calculateDischarge, type DischargeCalcInput } from "../../lib/discharge-calculator";
import type { SavedHeadCalc } from "../../lib/head-calc-store";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90";

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

/**
 * The Head Calculator (suction NPSH + discharge head) for one enquiry tag,
 * opened from the General Information step. Saving keeps the inputs with the
 * tag; "Save & use head" also puts the discharge head into the Head field (MWC).
 * Rendered on document.body: inside the wizard's .step-card every <h2> would
 * pick up the step's banner style (GeneralInformationStep.css).
 */
export default function HeadCalcModal({
  initial,
  onClose,
  onSave,
}: {
  /** The tag's saved calculation, else one seeded from the step. */
  initial: SavedHeadCalc;
  onClose: () => void;
  /** `headMwc` set = also use the discharge head as the duty head. */
  onSave: (calc: SavedHeadCalc, headMwc: number | null) => void;
}) {
  const [mode, setMode] = useState<CalcMode>("discharge");
  const [suction, setSuction] = useState<HeadCalcInput>(initial.suction);
  const [discharge, setDischarge] = useState<DischargeCalcInput>(initial.discharge);
  const dischargeHead = useMemo(() => calculateDischarge(discharge).totalHead, [discharge]);
  const npsh = useMemo(() => calculateHead(suction), [suction]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const calc = { suction, discharge };
  const usable = Number.isFinite(dischargeHead) && dischargeHead > 0;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">Head Calculator</h3>
            <p className="text-[12.5px] text-fg-3">Suction (NPSH) and discharge head for this tag — saved with the tag.</p>
          </div>
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-sunk px-4 pb-4">
          <HeadCalculatorView
            mode={mode}
            setMode={setMode}
            suction={suction}
            setSuction={setSuction}
            discharge={discharge}
            setDischarge={setDischarge}
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-[12.5px] text-fg-2">
            Discharge head <b className="font-mono text-fg">{fmt(dischargeHead)} MWC</b>
            <span className="mx-2 text-fg-4">·</span>
            NPSH margin <b className="font-mono text-fg">{fmt(npsh.margin)} MWC</b>
            <span className={`ml-1.5 ${npsh.status === "ok" ? "text-pos" : npsh.status === "caution" ? "text-warn" : "text-neg"}`}>
              ({npsh.statusText})
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => onSave(calc, null)}>
              Save calculation
            </button>
            <button
              type="button"
              className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-50`}
              onClick={() => onSave(calc, dischargeHead)}
              disabled={!usable}
              title="Save, and set Head = the discharge head in MWC"
            >
              Save &amp; use head {fmt(dischargeHead)} MWC
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
