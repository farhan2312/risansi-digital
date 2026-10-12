import { error, json, toFloat } from "@/lib/api";
import { db } from "@/lib/db";
import { findCandidates, headBandLabel, toM3PerHr, toMwc } from "@/lib/recommendation-engine";
import { rpmBandByKey, rpmBandOverlaps } from "@/lib/rpm-bands";

export const dynamic = "force-dynamic";

// Step-3 model screening: capacity + head in, every model from
// pump_model_master that physically satisfies the duty point out (see
// findCandidates in recommendation-engine.ts for the formula and eligibility
// rules). No ranking/limit — selection is manual, per the spec: "system
// should give all the model that satisfy the inputs... recommendation can be
// manual selection."
//
// Nothing is persisted yet (pump_selections / pump_recommendations don't
// exist in the DB), and there are no MOC/sealing/suction-sizing/drive/motor
// fields yet either — those depend on master tables (moc_selection_guide,
// sealing_selection_rule, suction_velocity, standard_motor_kw, ve_correction,
// rpm_band_master) that haven't been built. Those parts of the wizard stay
// disabled until that data exists.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const sg = toFloat(body.sg, 1.0) || 1.0;
  const capacityRaw = toFloat(body.capacity);
  const headRaw = toFloat(body.head);
  if (capacityRaw <= 0 || headRaw <= 0) {
    return error("'capacity' and 'head' are required and must be > 0", 400);
  }

  const capacityUnit = (body.capacityUnit as string) ?? null;
  const headUnit = (body.headUnit as string) ?? null;
  const capacityM3hr = toM3PerHr(capacityRaw, capacityUnit, sg);
  const headMwc = toMwc(headRaw, headUnit, sg);

  // Solid-handling filter (Fluid Properties step: Solid Size (mm) + Solid
  // Type) — only engages when both are present; see findCandidates for the
  // exclude-if-unrecorded rule.
  const solidSizeRaw = toFloat(body.solidSize, 0);
  const solidSizeMm = solidSizeRaw > 0 ? solidSizeRaw : null;
  const solidType = typeof body.solidType === "string" && body.solidType ? body.solidType : null;

  const allCandidates = await findCandidates(db, capacityM3hr, headMwc, solidSizeMm, solidType);

  // Optional manual RPM-band filter from the General Information step (spec
  // Step-3: "final RPM selection is manual on the basis of RPM range, then
  // system will scan the pump model master for model suggestions"). A model
  // qualifies when its achievable RPM window OVERLAPS the requested band.
  const rpmBand = rpmBandByKey((body.rpmRange as string) || "");
  const inBand = (lo: number | null, hi: number | null): boolean => {
    // No band chosen ⇒ every stage model passes (including ones with no
    // computable RPM). When a band IS chosen, a model with no RPM can't be
    // classified, so it's excluded for that filtered view only.
    if (rpmBand === null) return true;
    if (lo === null && hi === null) return false;

    // Match on the model's whole achievable WINDOW, not one endpoint. The two
    // RPMs bound the same window: rpmAtVoleMax is the best-case low speed and
    // rpmAtVoleMin the high one, and the pump can be driven anywhere between.
    // Classifying only the low end used to drop models that plainly cover the
    // requested band — e.g. a 158–500 window was called "low" and hidden from
    // a "medium" search despite running happily at 250 rpm.
    const windowLo = lo ?? hi!;
    const windowHi = hi ?? lo!;
    return rpmBandOverlaps(rpmBand, windowLo, windowHi);
  };
  // Screened on the window across the heads the card actually offers - a
  // model qualifies when ANY of them reaches the band. Screening on the
  // nearest head alone hid models whose other offered head covered it (e.g.
  // H60L6 at 20 MWC runs 161-218, a Medium match, while its 30 MWC head is
  // 196 and looked Low-only).
  const candidates = allCandidates.filter((c) => inBand(c.screenRpmLo, c.screenRpmHi));

  const selectedModel = typeof body.selectedModel === "string" ? body.selectedModel : null;

  const recommendations = candidates.map((c, i) => {
    const rpmLow = c.rpmAtVoleMax !== null ? Math.round(c.rpmAtVoleMax) : null;
    const rpmHigh = c.rpmAtVoleMin !== null ? Math.round(c.rpmAtVoleMin) : null;
    return {
      id: i,
      model: c.model,
      headMwc: c.headMwc,
      headBandMwc: headBandLabel(c.stage),
      voleMin: c.voleMin,
      voleMax: c.voleMax,
      mechEff: c.mechEff,
      qth: c.qth,
      isTested: c.isTested,
      testingRemarks: c.testingRemarks,
      rpmAtVoleMin: rpmHigh,
      rpmAtVoleMax: rpmLow,
      rpmClassAtVoleMin: c.rpmClassAtVoleMin,
      rpmClassAtVoleMax: c.rpmClassAtVoleMax,
      // "2 output RPMs as per VE": VOLE MAX speed (low) .. VOLE MIN speed
      // (high). Blank when the model has no computable RPM (missing VOLE/QTH).
      rpmRange:
        rpmLow === null
          ? "—"
          : rpmHigh !== null && rpmHigh > rpmLow
            ? `${rpmLow}–${rpmHigh}`
            : `${rpmLow}`,
      isSelected: selectedModel !== null && c.model === selectedModel,
      hardSolidMm: c.hardSolidMm,
      softSolidMm: c.softSolidMm,
      stage: c.stage,
      sizeVisc0To1000In: c.sizeVisc0To1000In,
      sizeVisc1000To3000In: c.sizeVisc1000To3000In,
      sizeVisc3000To5000In: c.sizeVisc3000To5000In,
      sizeVisc5000To10000In: c.sizeVisc5000To10000In,
      sizeViscGt10000In: c.sizeViscGt10000In,
      headPoints: c.headPoints,
    };
  });

  return json({
    input: {
      capacity: `${capacityRaw} ${capacityUnit ?? ""}`.trim(),
      head: `${headRaw} ${headUnit ?? ""}`.trim(),
    },
    recommendations,
  });
}
