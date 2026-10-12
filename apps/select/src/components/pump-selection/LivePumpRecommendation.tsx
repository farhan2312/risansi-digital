"use client";

import { useEffect, useState } from "react";
import "./LivePumpRecommendation.css";
import { previewRecommendations } from "../../services/recommendationService";
import { saveWizardInput } from "../../services/wizardInputService";
import type { HeadPoint, PumpRecommendation } from "../../data/Recommendations";
import {
  SIZE_COLUMN_BY_RANGE,
  sizeDefaultsFor,
  sizesOnPick,
  sizeOverride,
} from "../../lib/suction-discharge-size";
import { sealingShort } from "../../lib/sealing";
import { AG_BK_NOT_REQUIRED } from "./OperatingConditionsStep";

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFormData: any;
  /** Open project's id — lets a model confirmation persist to general_info
   * immediately, from whichever step the panel is shown on. */
  projectId?: string;
  /** The tag being edited. Wizard rows are keyed by tag; absent falls
   *  back to the project's Default tag server-side. */
  tagId?: string;
  /** Read-only mode (steps after Fluid): the confirmed pump stays visible as a
   * reference card, but it can no longer be re-picked or unconfirmed — the
   * later steps are configured for the chosen pump, and swapping it there
   * would silently invalidate that work. */
  locked?: boolean;
  /** Whether a model can be picked and confirmed here - only on the Fluid
   * step. On General Information the matches are a read-only preview (capacity
   * and head are still being entered). */
  canPick?: boolean;
};

type Status = "idle" | "loading" | "ready" | "empty" | "error";

// Hover text for a size cell the user has overridden on the Fluid step — the
// "*" on the label alone doesn't say what the model actually recommends.
const overrideTitle = (shown: number | null, recommended: number | null) =>
  shown === recommended
    ? undefined
    : `Overridden on the Fluid step — this model's size is ${
        recommended === null ? "unknown" : `${recommended}"`
      }`;

// Only the fields the engine actually uses — re-query when any of these
// change, including selectedModel (a pick must be re-evaluated fresh).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engineKey = (f: any) =>
  JSON.stringify({
    capacity: f.capacity,
    capacityUnit: f.capacityUnit,
    head: f.head,
    headUnit: f.headUnit,
    sg: f.sg,
    rpmRange: f.rpmRange,
    selectedModel: f.selectedModel,
    solidSize: f.solidSize,
    solidType: f.solidType,
  });

const LivePumpRecommendation = ({
  formData,
  setFormData,
  projectId,
  tagId,
  locked = false,
  canPick = true,
}: Props) => {
  const [recs, setRecs] = useState<PumpRecommendation[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  // Local "re-pick" mode: after a model is confirmed, "Change model" re-opens
  // the full list without dropping the confirmation (so step navigation stays
  // unlocked while the user swaps their pick).
  const [editing, setEditing] = useState(false);
  const key = engineKey(formData);

  useEffect(() => {
    const cap = parseFloat(formData.capacity);
    const head = parseFloat(formData.head);
    if (!(cap > 0) || !(head > 0)) {
      setStatus("idle");
      setRecs([]);
      return;
    }

    const controller = new AbortController();
    // Debounce so typing doesn't fire a request per keystroke.
    const timer = setTimeout(() => {
      setStatus("loading");
      previewRecommendations(formData, controller.signal)
        .then((res) => {
          setRecs(res.recommendations);
          setStatus(res.recommendations.length ? "ready" : "empty");
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.code === "ERR_CANCELED") return;
          setStatus("error");
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const confirmed = Boolean(formData.modelConfirmed);
  const confirmedRec =
    recs.find((r) => r.model === formData.selectedModel) ?? null;
  const hasConfirmedRec = confirmedRec !== null;

  // If a confirmed model stops matching the inputs (e.g. capacity/head edited
  // on a later visit to step 1), drop the confirmation so the user must pick
  // again — this also re-locks step navigation past the Fluid step.
  useEffect(() => {
    // Never while locked: after the Fluid step the later steps are already
    // built on this pump, so silently dropping the confirmation there would
    // unlock navigation and invalidate that work rather than helping.
    if (!locked && confirmed && status === "ready" && formData.selectedModel && !hasConfirmedRec) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFormData((f: any) => ({ ...f, modelConfirmed: false }));
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, confirmed, status, formData.selectedModel, hasConfirmedRec]);

  // The head point the user picked for a given model, or null. Selection is
  // per (model + head) — there's no nearest-to-input fallback; the user must
  // pick an explicit head, and that head's values drive everything downstream.
  const selectedPointFor = (r: PumpRecommendation): HeadPoint | null => {
    if (r.model !== formData.selectedModel || !formData.selectedHead) return null;
    return (
      (r.headPoints ?? []).find(
        (p) => String(p.headMwc) === String(formData.selectedHead),
      ) ?? null
    );
  };

  // Pick a specific head of a model. Re-clicking the already-selected head
  // clears the selection.
  const selectHead = (model: string, headMwc: number) => {
    if (locked || !canPick) return;
    const already =
      formData.selectedModel === model &&
      String(formData.selectedHead) === String(headMwc);
    // Sizes are per-model: picking a pump fills suction & discharge with that
    // model's size and makes it the baseline (unpinning leaves no baseline and
    // clears the auto-filled sizes). Remarks explaining a deviation from the
    // old baseline are cleared too.
    const rec = recs.find((r) => r.model === model) ?? null;
    const recommended = already || !rec ? null : perModelSize(rec);
    setFormData({
      ...formData,
      selectedModel: already ? "" : model,
      selectedHead: already ? "" : String(headMwc),
      ...(sizeDefaultsFor(formData.recommendedSize, recommended) ?? {}),
      ...sizesOnPick(!already, recommended, formData.recommendedSize, formData),
      ...(already ? {} : { sizeRemarks: "" }),
    });
  };

  const confirmModel = () => {
    setFormData({ ...formData, modelConfirmed: true });
    setEditing(false);
    // Persist the pick to general_info right away — the panel can be confirmed
    // from any step, so we can't rely on leaving step 1 to save it.
    if (projectId) {
      saveWizardInput("general-info", projectId, {
        selectedModel: formData.selectedModel,
        selectedHead: formData.selectedHead,
        modelConfirmed: true,
      }, tagId).catch(() => {
        // Best-effort — the in-memory formData still gates navigation; the
        // step-1 save will pick it up as a fallback.
      });
    }
  };

  const changeModel = () => setEditing(true);

  // Per-model suction/discharge pipe size — looked up from the pump's own
  // pump_model_master.size_visc_* column matching the chosen viscosity range.
  // Null when the range isn't chosen yet or the model has no size for it.
  const perModelSize = (r: PumpRecommendation): number | null => {
    const col = SIZE_COLUMN_BY_RANGE[formData.viscosityRange as string];
    if (!col) return null;
    return r[col] ?? null;
  };

  // Keep the size baseline in step with the picked pump. A pump can be picked
  // before the viscosity range is chosen (both are on the Fluid step), and the
  // range can change after picking - either way the baseline must be the
  // model's size for the current range, not the flat viscosity-band size.
  // Sizes that are blank or still hold the previous auto-filled value follow
  // the new size; a size the user typed is kept (and still needs a remark if
  // it differs).
  const pickedSize = confirmedRec ? perModelSize(confirmedRec) : null;
  useEffect(() => {
    if (locked || !formData.selectedModel || !confirmedRec) return;
    const patch = sizeDefaultsFor(formData.recommendedSize, pickedSize);
    if (!patch) return;
    const prev = parseFloat((formData.recommendedSize ?? "").trim());
    const follow = (v: string | null | undefined) => {
      const t = (v ?? "").trim();
      return !t || parseFloat(t) === prev ? patch.recommendedSize : t;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setFormData((f: any) => ({
      ...f,
      ...patch,
      suctionSize: follow(f.suctionSize),
      dischargeSize: follow(f.dischargeSize),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, formData.selectedModel, pickedSize, formData.recommendedSize, !!confirmedRec]);
  const seal = sealingShort(formData.sealingType);
  // "Not Required" is an explicit omission, not a feed option, so it is kept
  // out of the terse spec code line below.
  const agBkCode =
    formData.agBk === AG_BK_NOT_REQUIRED ? "" : formData.agBk;

  // `point` is the head the user picked (or the confirmed head). Head-specific
  // figures (Head, VOLE, Mech Eff, RPM) come from it; when no head is picked
  // yet they read "—" and the Head cell falls back to the stage band. Qth and
  // Size are head-independent, so they always show.
  const cardInner = (
    r: PumpRecommendation,
    showAction: boolean,
    confirmedBadge: boolean,
    point: HeadPoint | null,
    // Cards are one-per (model + head), so "selected" is a model+head match,
    // not just the model. Callers that only know the model omit this.
    selectedOverride?: boolean,
  ) => {
    const isSelected =
      selectedOverride ?? r.model === formData.selectedModel;
    const size = perModelSize(r);
    // The picked pump's card shows the sizes actually being quoted, so an
    // override entered on the Fluid step is reflected here. Every other card
    // keeps showing its own model's size — that is what picking it would fill
    // in, and the override belongs to the picked pump, not to a candidate.
    const suction = isSelected ? sizeOverride(formData.suctionSize, size) : size;
    const discharge = isSelected ? sizeOverride(formData.dischargeSize, size) : size;
    return (
      <>
        <div className="live-rec-card-badges">
          {confirmedBadge && <span className="live-rec-badge confirmed">Confirmed</span>}
          {!confirmedBadge && isSelected && (
            <span className="live-rec-badge picked">Your Pick</span>
          )}
          {!r.isTested && <span className="live-rec-badge warn">Not Tested</span>}
        </div>
        <strong className="live-rec-card-model">{r.model}</strong>
        <div className="live-rec-card-meta">
          <div>
            <span>Stage</span>
            <b className="mono">{r.stage ?? "—"}</b>
          </div>
          <div>
            <span>Head</span>
            <b className="mono">
              {point
                ? `${point.headMwc} MWC`
                : r.headBandMwc
                  ? `${r.headBandMwc} MWC`
                  : "—"}
            </b>
          </div>
          <div>
            <span>Qth</span>
            <b className="mono">{r.qth != null ? r.qth : "—"}</b>
          </div>
          <div>
            <span>RPM</span>
            <b className="mono">{point ? point.rpmRange : "—"}</b>
          </div>
          <div>
            <span>VOLE</span>
            <b className="mono">
              {point && point.voleMin != null && point.voleMax != null
                ? `${point.voleMin}–${point.voleMax}%`
                : "—"}
            </b>
          </div>
          <div>
            <span>Mech Eff</span>
            <b className="mono">
              {point && point.mechEff != null ? `${point.mechEff}%` : "—"}
            </b>
          </div>
          {/* Suction and discharge are one figure per model in the master
              sheet, but they are separate line sizes on the job and the user
              can size them apart on the Fluid step, so the card lists both.
              An overridden size is flagged so the card never looks like the
              model's own recommendation when it isn't. */}
          <div title={overrideTitle(suction, size)}>
            <span>Suction{suction !== size && " *"}</span>
            <b className="mono">{suction !== null ? `${suction}"` : "—"}</b>
          </div>
          <div title={overrideTitle(discharge, size)}>
            <span>Discharge{discharge !== size && " *"}</span>
            <b className="mono">{discharge !== null ? `${discharge}"` : "—"}</b>
          </div>
        </div>
        {/* Spec selections (same for every model), combined into one line like
            "Vertical · BK · MS" — Pump Type · AG/BK · Seal. Each part appears
            as it's chosen on its step. */}
        {(formData.pumpType || agBkCode || seal) && (
          <span className="live-rec-card-type">
            {[formData.pumpType, agBkCode, seal].filter(Boolean).join(" · ")}
          </span>
        )}
        {showAction && (
          <span className="live-rec-card-action">
            {isSelected ? "Click to unpin" : "Click to pin this pump"}
          </span>
        )}
      </>
    );
  };

  // One flat card per (model + head). The result set is small enough now that
  // grouping by model added a level of nesting without adding information —
  // every figure that differs between cards is on the card itself.
  // A model with no computed head points still gets one card so it isn't
  // silently dropped from the list.
  type CardOption = { rec: PumpRecommendation; point: HeadPoint | null };
  const options: CardOption[] = recs.flatMap((rec): CardOption[] => {
    const points = rec.headPoints ?? [];
    return points.length > 0
      ? points.map((point) => ({ rec, point }))
      : [{ rec, point: null }];
  });

  const isSelectedOption = (rec: PumpRecommendation, point: HeadPoint | null): boolean =>
    rec.model === formData.selectedModel &&
    point !== null &&
    String(point.headMwc) === String(formData.selectedHead);

  const confirmedView = confirmed && (locked || !editing) && hasConfirmedRec;

  return (
    <div className="live-rec">
      <div className="live-rec-head">
        <span className="section-label">
          {confirmedView ? "Selected Pump" : "Live Recommendation"}
        </span>
        {status === "loading" && <span className="live-rec-status">Updating…</span>}
        {status === "ready" && <span className="live-dot" title="Live" />}
      </div>

      {status === "idle" && !confirmedView && !locked && (
        <p className="live-rec-hint">
          Enter <strong>capacity</strong> and <strong>head</strong> to see live pump
          matches. You&apos;ll pick one and confirm it on the Fluid step.
        </p>
      )}

      {status === "error" && (
        <p className="live-rec-hint">Couldn&apos;t update — check your connection.</p>
      )}

      {status === "empty" && !confirmedView && !locked && (
        <p className="live-rec-hint">
          No model in the master data can reach this head at this capacity. Try
          adjusting capacity or head.
        </p>
      )}

      {confirmedView && confirmedRec ? (
        <>
          <p className="live-rec-hint">
            {locked
              ? "Locked in — the later steps are configured for this pump. Go back to the Fluid step to change it."
              : "Model confirmed — the rest of the wizard is configured for this pump."}
          </p>
          <div className="live-rec-cards live-rec-cards--single">
            <div className="live-rec-card is-locked">
              {cardInner(confirmedRec, false, true, selectedPointFor(confirmedRec))}
            </div>
          </div>
          {!locked && canPick && (
            <button type="button" className="live-rec-change" onClick={changeModel}>
              Change model
            </button>
          )}
        </>
      ) : locked ? (
        /* Locked, but the confirmed card isn't resolved yet (still fetching)
           or the saved model isn't in the current result set. Either way the
           pickable list below must not render here — show the saved pick as
           plain text instead. */
        <p className="live-rec-hint">
          {status === "loading" ? (
            "Loading the selected pump…"
          ) : formData.selectedModel ? (
            <>
              Selected pump: <strong>{formData.selectedModel}</strong>. Go back to
              the Fluid step to change it.
            </>
          ) : (
            "No pump model was confirmed for this enquiry."
          )}
        </p>
      ) : (
        <>
          {options.length > 0 && (
            <p className="live-rec-hint">
              {options.length} matching {options.length === 1 ? "option" : "options"} —
              each card is a model at one head, with its own figures.{" "}
              {canPick
                ? "Click the one you want, then confirm."
                : "Preview only — you'll pick and confirm a model on the Fluid step."}
            </p>
          )}

          {(status === "ready" || (status === "loading" && recs.length > 0)) &&
            options.length > 0 && (
              <div className="live-rec-cards">
                {options.map(({ rec, point }) => {
                  const selected = isSelectedOption(rec, point);
                  const key = `${rec.id}-${point ? point.headMwc : "na"}`;
                  // Preview (General Information): the same card, not clickable.
                  if (!canPick) {
                    return (
                      <div key={key} className={`live-rec-card is-preview${selected ? " is-selected" : ""}`}>
                        {cardInner(rec, true, false, point, selected)}
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`live-rec-card${selected ? " is-selected" : ""}`}
                      onClick={() => point && selectHead(rec.model, point.headMwc)}
                      aria-pressed={selected}
                    >
                      {cardInner(rec, true, false, point, selected)}
                    </button>
                  );
                })}
              </div>
            )}

          {canPick && hasConfirmedRec && formData.selectedHead && (
            <div className="live-rec-confirm-bar">
              <span>
                Confirm <strong>{formData.selectedModel}</strong> at{" "}
                <strong>{formData.selectedHead} MWC</strong> as your pump?
              </span>
              <button type="button" className="live-rec-confirm-btn" onClick={confirmModel}>
                Confirm
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LivePumpRecommendation;
