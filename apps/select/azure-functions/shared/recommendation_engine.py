"""
PCP pump recommendation engine.

Implements the flow chart in flow chart.xlsx / Formula.docx / the Amit Sharma,
Kamini and Rachna docs (see DOCUMENTS.zip audit). Only pump_family='PCP' is
supported — ROTA is out of scope for this phase.

Where the source docs left a step ambiguous (notably: exactly how the
viscosity factor VF composes with volumetric efficiency), the interpretation
used is called out in a comment at that step. This is an engineering
estimation tool, not a certified calculation — tested figures are always
preferred over calculated ones, and every calculated figure is tagged as such
in the response so a sales engineer can see what's a real test result vs an
estimate.
"""
import math
import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    DriveSelectionMatrix,
    MocMaster,
    MocSelectionGuide,
    PerformanceCurvePoint,
    PumpModelMaster,
    PumpRecommendation,
    PumpSelection,
    RpmBandMaster,
    SealingSelectionRule,
    StandardMotorKw,
    SuctionVelocityRow,
    VECorrectionRow,
)
from .ai_suggestions import apply_ai_gap_suggestions, get_ai_gap_suggestions

# --- Unit conversion -------------------------------------------------------

def to_m3_per_hr(value: float, unit: str, sg: float) -> float:
    unit = (unit or "M3/hr").strip()
    if unit == "M3/hr":
        return value
    if unit == "LPH":
        return value / 1000
    if unit == "GPM":  # US gallons/min
        return value * 0.227125
    if unit == "KLPD":  # kiloliters/day
        return value / 24
    if unit == "TPH":  # tons/hr, needs density
        return value / (sg or 1.0)
    return value


def to_mwc(value: float, unit: str, sg: float) -> float:
    unit = (unit or "MWC").strip()
    if unit == "MWC":
        return value
    if unit == "MLC":  # meters of liquid column -> meters of water column
        # Per "Backend Formulas Required" spec, Step-2: MWC = MLC / Specific Gravity.
        return value / (sg or 1.0)
    # Per spec, Step-2: "Head = Pressure * 10" for both Bar and Kg/cm2.
    if unit == "Bar":
        return value * 10.0
    if unit in ("Kg/cm2", "Kg/cm²"):
        return value * 10.0
    return value


def to_cp(value: float, unit: str, sg: float) -> float:
    unit = (unit or "cP").strip()
    if unit == "cSt":
        return value * (sg or 1.0)
    return value


# --- MOC / sealing / drive keyword matching ---------------------------------

_MOC_KEYWORDS = [
    ("food", "Food & Pharma"), ("pharma", "Food & Pharma"),
    ("corrosive", "Corrosive Chemical"), ("acid", "Corrosive Chemical"),
    ("chemical", "Chemical"), ("oil", "Oil"), ("hydrocarbon", "Oil"),
]
_STATOR_KEYWORDS = [
    ("food", "Food Products"), ("oil", "Oil & Hydrocarbon"),
    ("hydrocarbon", "Oil & Hydrocarbon"), ("chemical", "Chemicals"),
    ("water", "Water"),
]


def classify_media(media: str, keywords: list[tuple[str, str]], default: str) -> str:
    media_lower = (media or "").lower()
    for kw, category in keywords:
        if kw in media_lower:
            return category
    return default


@dataclass
class MocResult:
    category: str
    casing: str | None = None
    rotor: str | None = None
    stator: str | None = None


def resolve_moc(db: Session, media: str, temperature: float, solid_pct: float) -> MocResult:
    casing_category = classify_media(media, _MOC_KEYWORDS, "Water")
    rotor_category = "Abrasive Slurry" if solid_pct and solid_pct > 0 else classify_media(
        media, [kw for kw in _MOC_KEYWORDS if kw[1] != "Food & Pharma"] + [("food", "Food & Pharma")], "Water"
    )
    stator_category = "High Temperature" if temperature and temperature > 100 else classify_media(
        media, _STATOR_KEYWORDS, "Water"
    )

    casing = db.scalar(select(MocSelectionGuide).where(
        MocSelectionGuide.service_type == casing_category, MocSelectionGuide.casing_moc.is_not(None)
    ))
    rotor = db.scalar(select(MocSelectionGuide).where(
        MocSelectionGuide.service_type == rotor_category, MocSelectionGuide.rotor_moc.is_not(None)
    ))
    stator = db.scalar(select(MocSelectionGuide).where(
        MocSelectionGuide.service_type == stator_category, MocSelectionGuide.stator_material.is_not(None)
    ))
    return MocResult(
        category=casing_category,
        casing=casing.casing_moc if casing else None,
        rotor=rotor.rotor_moc if rotor else None,
        stator=stator.stator_material if stator else None,
    )


# moc_master (MOC Details.xlsx) uses its own 6-code nomenclature (AAAN/AABN/ABBN/
# BBBN/CCCN/XXXN) with no documented mapping to the service-type categories used
# above — the two are separate systems in the source data. This maps casing
# category -> moc_code by severity as a clearly-flagged heuristic (not from any
# source document), pending SME confirmation of the real mapping.
_MOC_CODE_BY_SEVERITY = {
    "Water": "AAAN", "Oil": "AAAN",
    "Chemical": "ABBN",
    "Food & Pharma": "CCCN",
    "Corrosive Chemical": "XXXN",
}


def resolve_moc_master_code(casing_category: str) -> str:
    return _MOC_CODE_BY_SEVERITY.get(casing_category, "AAAN")


def classify_rpm(rpm: float) -> str:
    if rpm < 200:
        return "Low (<200)"
    if rpm <= 320:
        return "Medium (200-320)"
    if rpm <= 400:
        return "High (320-400)"
    return "Very High (>400)"


def resolve_sealing(db: Session, preferred: str | None, hazardous: bool, high_pressure: bool) -> str:
    if preferred in ("Mechanical Seal", "Gland Packing"):
        return preferred
    rules = db.scalars(select(SealingSelectionRule)).all()
    msa_score = sum(1 for r in rules if r.recommendation == "MSA" and (
        (hazardous and "hazardous" in r.condition.lower())
        or (hazardous and "toxic" in r.condition.lower())
        or (high_pressure and "pressure" in r.condition.lower())
    ))
    return "Mechanical Seal" if msa_score > 0 else "Gland Packing"


def reduction_ratio(motor_rpm: float | None, rpm_required: float) -> float | None:
    if not motor_rpm or rpm_required <= 0:
        return None
    return motor_rpm / rpm_required


def resolve_drive(rpm_required: float, motor_rpm: float | None) -> str:
    ratio = reduction_ratio(motor_rpm, rpm_required)
    if ratio is None:
        return "Geared Motor"
    if 0.9 <= ratio <= 1.1:
        return "Direct Drive"
    # V-belt/pulley reduction is practical up to roughly 6:1 (per the pulley
    # selection sheets, which only cover motor RPM classes 960/1440 down to a
    # few hundred RPM); beyond that a gearbox is the realistic option. Not an
    # exact figure from the source docs — a standard engineering rule of thumb,
    # flagged for SME confirmation like the other unstated thresholds.
    if 1 < ratio <= 6:
        return "V-Belt Drive"
    return "Geared Motor"


# --- Suction / discharge sizing ---------------------------------------------
# D = sqrt(4Q / (pi * V)) — from the "Backend Formulas Required" spec, Step-5.
# Standard NB (nominal bore) series in mm.
NB_SERIES = [25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400]


def classify_media_for_velocity(viscosity_cp: float, solid_pct: float) -> str:
    if solid_pct and solid_pct >= 5:
        return "Slurry"
    if viscosity_cp and viscosity_cp > 500:
        return "Viscous Liquid"
    return "Clean Liquid"


def recommended_velocity(db: Session, media_type: str) -> float:
    row = db.scalar(select(SuctionVelocityRow).where(SuctionVelocityRow.media_type == media_type))
    return float(row.recommended_velocity) if row else 1.0


def nearest_nb(diameter_mm: float) -> int:
    for nb in NB_SERIES:
        if nb >= diameter_mm:
            return nb
    return NB_SERIES[-1]


def size_suction_discharge(db: Session, capacity_m3hr: float, viscosity_cp: float,
                            solid_pct: float) -> tuple[int, int, str]:
    media_type = classify_media_for_velocity(viscosity_cp, solid_pct)
    velocity = recommended_velocity(db, media_type)
    q_m3s = capacity_m3hr / 3600
    suction_diam_mm = math.sqrt((4 * q_m3s) / (math.pi * velocity)) * 1000
    discharge_diam_mm = math.sqrt((4 * q_m3s) / (math.pi * velocity * 1.2)) * 1000
    return nearest_nb(suction_diam_mm), nearest_nb(discharge_diam_mm), media_type


# --- Core formulas -----------------------------------------------------------

def round_up_to_standard_kw(db: Session, kw: float) -> float:
    row = db.scalar(select(StandardMotorKw).where(StandardMotorKw.kw >= kw).order_by(StandardMotorKw.kw).limit(1))
    return float(row.kw) if row else kw


def viscosity_correction_factor(db: Session, viscosity_cp: float) -> tuple[float, bool]:
    """Returns (VF, is_exact_match). VF defaults to 1.0 (no correction) if out of table range."""
    row = db.scalar(
        select(VECorrectionRow)
        .where(VECorrectionRow.pump_family == "PCP", VECorrectionRow.viscosity_min <= viscosity_cp)
        .order_by(VECorrectionRow.viscosity_min.desc())
        .limit(1)
    )
    if row is None:
        return 1.0, False
    return float(row.ve_correction), float(row.viscosity_min) == viscosity_cp


def rpm_band_for(viscosity_cp: float, solid_pct: float, db: Session) -> RpmBandMaster | None:
    bands = db.scalars(select(RpmBandMaster)).all()
    for b in bands:
        v_ok = (b.viscosity_min is None or viscosity_cp >= float(b.viscosity_min)) and \
               (b.viscosity_max is None or viscosity_cp <= float(b.viscosity_max))
        s_ok = b.max_solid_pct is None or solid_pct <= float(b.max_solid_pct)
        # A band with no viscosity bound at all (both min and max None) is keyed
        # purely by solids severity — e.g. "Magma/Sludge/Abrasive (solids<=20%)".
        # Without this guard it silently matches every viscosity, including
        # plain water at 0% solids, making a slurry-duty RPM window (160-240)
        # the default "optimum band" for ordinary low-viscosity duty and
        # incorrectly tanking rpm_fit for any model whose naturally-required
        # RPM (which scales with capacity/head/model size) falls outside it.
        if b.viscosity_min is None and b.viscosity_max is None and b.max_solid_pct is not None:
            s_ok = s_ok and solid_pct > 0
        if v_ok and s_ok:
            return b
    # No genuinely applicable band for this viscosity/solids combination —
    # better to leave RPM-fit unconstrained than to force-fit a mismatched
    # band (the old `bands[0]` fallback always returned the slurry band here).
    return None


@dataclass
class Candidate:
    model: str
    head_mwc: float
    ve_min: float
    ve_max: float
    mech_efficiency: float
    is_tested: bool
    q_theoretical: float
    rpm_required: float
    bkw: float
    installed_kw: float
    kw_source: str
    score: float
    drive_ratio: float | None = None
    rejection_reasons: list[str] = field(default_factory=list)


def find_candidates(db: Session, capacity_m3hr: float, head_mwc: float, viscosity_cp: float,
                     solid_pct: float, motor_rpm: float | None = None) -> list[Candidate]:
    vf, _ = viscosity_correction_factor(db, viscosity_cp)
    band = rpm_band_for(viscosity_cp, solid_pct, db)

    curve_rows = db.scalars(
        select(PerformanceCurvePoint).where(PerformanceCurvePoint.pump_family == "PCP")
    ).all()
    by_model: dict[str, list[PerformanceCurvePoint]] = {}
    for r in curve_rows:
        by_model.setdefault(r.model, []).append(r)

    models = {m.model: m for m in db.scalars(select(PumpModelMaster).where(PumpModelMaster.pump_family == "PCP"))}

    candidates: list[Candidate] = []
    for model_name, points in by_model.items():
        pm = models.get(model_name)
        if not pm or pm.q_theoretical is None:
            continue
        nearest = min(points, key=lambda p: abs(float(p.head_mwc) - head_mwc))
        if nearest.ve_min is None or nearest.ve_max is None or nearest.mech_efficiency is None:
            continue

        # Stage-tier constraint: PCP models come in non-overlapping head bands by
        # stage count — single-stage (head_max=60), 2-stage/"2H" (head_max=120),
        # 4-stage/"4H" (head_max=240) — reflected directly in the master data's
        # head_max column. A single-stage model can't be recommended for a 90 MWC
        # duty just because 90 is within some loose margin of 60; it physically
        # needs the 2-stage casing. Only applied to rows that actually carry a
        # head_max classification — legacy rows with no head_min/head_max are left
        # to the existing nearest-point matching rather than rejected outright.
        if pm.head_max is not None:
            head_max = float(pm.head_max)
            if head_max <= 60:
                tier_lo, tier_hi = 0.0, 60.0
            elif head_max <= 120:
                tier_lo, tier_hi = 60.0, 120.0
            else:
                tier_lo, tier_hi = 120.0, 240.0
            if not (tier_lo < head_mwc <= tier_hi):
                continue

        q_theoretical = float(pm.q_theoretical)
        ve_avg = (float(nearest.ve_min) + float(nearest.ve_max)) / 2 / 100  # percentage -> fraction
        # Interpretation: VF (from PCP Viscosity sheet) scales the base volumetric
        # efficiency for the requested viscosity. Not explicitly spelled out in the
        # source docs for this exact composition — flagged for SME review. Clamped
        # below 1.0 since a >100% volumetric efficiency is not physically meaningful.
        ve_corrected = min(ve_avg * vf, 0.98)
        if ve_corrected <= 0:
            continue

        # RPM = 100 x Capacity / (QTH x VE). QTH ("Q Theoretical") in pump_model_master
        # is the model's theoretical flow at a 100 RPM reference speed, NOT a per-
        # revolution displacement — verified against two worked rows in "NEW PCP
        # SLECTION" (model 2H48/50: 100x50/(3x0.8774)=1899.6; model H40L6:
        # 100x5/(3.7x0.762548)=177.2), both matching the sheet's own REQ. RPM columns
        # exactly. (An earlier version of this formula wrongly assumed QTH was in
        # L/rev and applied a x1000/60 unit conversion — that was the actual bug
        # behind the invalid recommendations.)
        rpm_required = (100 * capacity_m3hr) / (q_theoretical * ve_corrected)

        # Step-3/4: "IF RPM > allowable limit -> Reject Model, Try Next Model." The
        # source sheet itself still surfaces results like the 1899.6 RPM example above
        # (flagged "NOT TESTED AT THIS HEAD" rather than hidden), so this is a wide
        # sanity ceiling for physically-impossible values only — the optimum-band
        # check below (rpm_fit / rejection_reasons) is what actually differentiates
        # a good match from a technically-possible-but-extreme one.
        if rpm_required > 5000 or rpm_required < 20:
            continue

        # Motor RPM (960 or 1440 — the two speeds covered by the pulley selection
        # sheets) drives the reduction ratio, which in turn is what actually
        # determines whether a model is a practical match: a model whose required
        # RPM implies an unrealistic reduction from the chosen motor is a worse
        # recommendation even if its head/capacity fit looks fine.
        ratio = reduction_ratio(motor_rpm, rpm_required)
        drive_fit = 1.0
        if ratio is not None:
            if ratio > 50 or ratio < 0.2:
                # Effectively impossible with any standard drive train.
                continue
            if ratio < 0.9:
                reasons_drive = (
                    f"Required pump RPM ({rpm_required:.0f}) exceeds the {motor_rpm:.0f} RPM "
                    f"motor speed — would need a step-up drive, uncommon for this application"
                )
                drive_fit = 0.0
            elif ratio <= 1.1:
                drive_fit = 1.0  # direct drive, simplest option
                reasons_drive = None
            elif ratio <= 6:
                drive_fit = 1.0 - 0.3 * (ratio - 1.1) / (6 - 1.1)  # V-belt range
                reasons_drive = None
            elif ratio <= 15:
                drive_fit = 0.6 - 0.3 * (ratio - 6) / (15 - 6)  # geared range
                reasons_drive = None
            else:
                reasons_drive = (
                    f"Reduction ratio {ratio:.1f}:1 from the {motor_rpm:.0f} RPM motor is "
                    f"impractically high for a V-belt or standard gearbox"
                )
                drive_fit = 0.1

        mech_eff_fraction = float(nearest.mech_efficiency) / 100
        reasons = []
        if ratio is not None and reasons_drive:
            reasons.append(reasons_drive)
        if mech_eff_fraction <= 0:
            reasons.append("No mechanical efficiency data at this head — BKW not calculable")
            bkw = None
            installed_kw = None
            kw_source = None
        else:
            bkw = (capacity_m3hr * head_mwc) / (367 * mech_eff_fraction)
            bkw_with_margin = bkw * 1.2
            if pm.min_kw_tested is not None and float(pm.min_kw_tested) >= bkw_with_margin:
                installed_kw = float(pm.min_kw_tested)
                kw_source = "tested"
            else:
                installed_kw = round_up_to_standard_kw(db, bkw_with_margin)
                kw_source = "calculated"

        if band and not (band.rpm_min <= rpm_required <= band.rpm_max):
            reasons.append(
                f"Required RPM {rpm_required:.0f} outside optimum band "
                f"{band.rpm_min}-{band.rpm_max} for this application"
            )

        head_span = float(pm.head_max or head_mwc) - float(pm.head_min or head_mwc)
        head_fit = 1 - min(abs(float(nearest.head_mwc) - head_mwc) / max(head_span, 1), 1) if head_span > 0 else 1.0

        rpm_fit = 1.0
        if band:
            band_center = (band.rpm_min + band.rpm_max) / 2
            band_half_width = (band.rpm_max - band.rpm_min) / 2
            rpm_fit = max(0.0, 1 - abs(rpm_required - band_center) / max(band_half_width, 1))
        else:
            # No severity-specific band applies (see rpm_band_for) — fall back to
            # a continuous preference for lower RPM, matching the Step-3 RPM
            # Classification thresholds already used elsewhere (classify_rpm):
            # Low <200 best, Medium 200-320, High 320-400, Very High >400 least
            # preferred. Lower RPM means less rotor/stator elastomer wear over
            # the pump's life — a soft ranking preference, not a hard reject,
            # since real catalog models legitimately span this whole range.
            if rpm_required <= 200:
                rpm_fit = 1.0
            elif rpm_required <= 320:
                rpm_fit = 1.0 - 0.15 * (rpm_required - 200) / (320 - 200)
            elif rpm_required <= 400:
                rpm_fit = 0.85 - 0.25 * (rpm_required - 320) / (400 - 320)
            else:
                rpm_fit = max(0.15, 0.60 - 0.45 * min((rpm_required - 400) / 400, 1))

        score = 20 + 20 * head_fit + 25 * rpm_fit + 15 * drive_fit
        if nearest.is_tested:
            score += 10
        if not reasons:
            score += 10
        score = max(0.0, min(100.0, score))

        candidates.append(Candidate(
            model=model_name, head_mwc=float(nearest.head_mwc),
            ve_min=float(nearest.ve_min), ve_max=float(nearest.ve_max),
            mech_efficiency=float(nearest.mech_efficiency), is_tested=nearest.is_tested,
            q_theoretical=q_theoretical, rpm_required=rpm_required,
            bkw=bkw, installed_kw=installed_kw, kw_source=kw_source,
            score=score, drive_ratio=ratio, rejection_reasons=reasons,
        ))

    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates


# --- Selection report ---------------------------------------------------
# Structure matches PCP Model Selection Portal DEMO.pdf: sections of
# {label, value, available} rows. `available: False` marks fields with no
# backing master data in the current dataset (see recommendation_engine.py
# module docstring and the project plan for what's in/out of scope) — the
# frontend renders these as "Not available" rather than blank, so gaps are
# visible rather than silently missing.


def _field(label: str, value, available: bool = True, note: str | None = None) -> dict:
    return {"label": label, "value": value if available else None, "available": available, "note": note}


def build_selection_report(db: Session, recommendation: PumpRecommendation, selection: PumpSelection) -> dict:
    temperature = float(selection.temperature) if selection.temperature else 0.0
    solid_pct = float(selection.solid_percentage) if selection.solid_percentage else 0.0
    sg = float(selection.sg) if selection.sg else None

    casing_category = classify_media(selection.media or "", _MOC_KEYWORDS, "Water")
    moc_code = resolve_moc_master_code(casing_category)
    moc = db.get(MocMaster, moc_code)

    try:
        rpm_value = float(recommendation.rpm)
    except (TypeError, ValueError):
        rpm_value = None

    def moc_field(label: str, attr: str | None) -> dict:
        if attr is None or moc is None:
            return _field(label, None, available=False)
        value = getattr(moc, attr)
        return _field(label, value, available=value is not None)

    # Wetted housing components (End Plate, Suction Housing material, Pressure
    # Check Arrangement, Stuffing Box, Seal Plate) and the non-wettable Bearing
    # Housing aren't individually charted anywhere in the source data — but
    # standard PC-pump construction practice is to cast/machine the whole
    # housing assembly from one material spec, so defaulting them to the same
    # grade as Pump Housing is a defensible engineering default, not a guess
    # from nothing. Flagged with a note rather than presented as independently
    # verified.
    housing_moc = moc.pump_housing if moc else None
    housing_note = "Assumed same as Pump Housing — standard matched-casting practice, not independently charted"

    def housing_field(label: str) -> dict:
        return _field(label, housing_moc, available=housing_moc is not None, note=housing_note if housing_moc else None)

    # Cardan Joint's own internal parts list (per the Design Selection notes in
    # the INPUT-OUTPUT spec) includes "pin" among its wetted components, so its
    # MOC defaults to the same grade as Pin rather than being left blank.
    cardan_moc = moc.pin if moc else None

    # Base-Plate is a non-wetted structural/mounting item, virtually always
    # mild steel across every MOC code in the source chart (all 6 codes use MS
    # for the equivalent low-stress structural members) — a standard default,
    # not media-dependent like the wetted parts above.
    base_plate_default = "MS"

    drive_system = recommendation.drive_system or ""
    uses_gearbox = drive_system == "Geared Motor"
    uses_shaft_coupling = drive_system in ("Geared Motor", "Direct Drive")

    # Starter type follows standard LV motor-starting practice by kW rating —
    # not stated as a formula anywhere in the source docs, but a well
    # established electrical convention, applied to the KW we already
    # calculated rather than introduced from nothing.
    kw_match = re.search(r"[\d.]+", recommendation.motor or "")
    installed_kw = float(kw_match.group()) if kw_match else None
    if installed_kw is None:
        starter_type = None
    elif installed_kw < 7.5:
        starter_type = "DOL"
    elif installed_kw <= 37:
        starter_type = "Star-Delta"
    else:
        starter_type = "VFD"

    # ASF (Application Service Factor) band from the "Backend Masters Required"
    # spec (1.4-2 / 2.1-3 / 3.1+), selected by duty severity — solids and
    # viscosity are the two inputs Rachna's drive-selection doc names as
    # pushing a service toward the heavier end (High Viscosity Fluid, Sludge
    # Service -> favour Geared/higher service factor).
    try:
        viscosity_raw = float(selection.viscosity) if selection.viscosity else 0.0
    except (TypeError, ValueError):
        viscosity_raw = 0.0
    viscosity_for_asf = to_cp(viscosity_raw, selection.viscosity_unit, sg or 1.0)
    if solid_pct > 15 or viscosity_for_asf > 10000:
        asf_band = "3.1+"
    elif solid_pct > 5 or viscosity_for_asf > 5000:
        asf_band = "2.1-3"
    else:
        asf_band = "1.4-2"

    sections = [
        {
            "title": "Summary — Duty Point & Media",
            "fields": [
                _field("Media / Application", selection.media),
                _field("Capacity", f"{selection.capacity} {selection.capacity_unit or ''}".strip()),
                _field("Head / Pressure", f"{selection.head} {selection.head_unit or ''}".strip()),
                _field("Viscosity", f"{selection.viscosity} {selection.viscosity_unit or ''}".strip()
                       if selection.viscosity else None, available=bool(selection.viscosity)),
                _field("Temperature", f"{selection.temperature} °C" if selection.temperature else None,
                       available=bool(selection.temperature)),
                _field("PH Value", selection.ph, available=bool(selection.ph)),
                _field("Density", f"{sg * 1000:.0f} kg/m³" if sg else None, available=bool(sg),
                       note=None if sg else "Requires Specific Gravity input"),
            ],
        },
        {
            "title": "Pump Model Selection",
            "fields": [
                _field("Pump Model", recommendation.model),
                _field("Pump Type", selection.pump_type, available=bool(selection.pump_type)),
                _field("Bearing Housing", recommendation.bearing_housing, available=bool(recommendation.bearing_housing)),
                _field("Suction Housing", recommendation.suction_housing, available=bool(recommendation.suction_housing)),
                _field("Joint Type", recommendation.joint_type, available=bool(recommendation.joint_type)),
                _field("Sealing Type", recommendation.sealing_type),
                _field("RPM Range", classify_rpm(rpm_value) if rpm_value is not None else None,
                       available=rpm_value is not None),
                _field("Pump RPM (Final — record manually)", recommendation.rpm),
            ],
        },
        {
            "title": "MOC — Non-Wettable Parts",
            "fields": [
                housing_field("Bearing Housing / Close Coupled"),
            ],
        },
        {
            "title": "MOC — Wettable Housing",
            "fields": [
                moc_field("Pump Housing", "pump_housing"),
                housing_field("End Plate"),
                housing_field("Suction Housing"),
                housing_field("Pressure Check Arrangement"),
                housing_field("Stuffing Box"),
                housing_field("Seal Plate"),
            ],
        },
        {
            "title": "MOC — Wettable Internals",
            "fields": [
                moc_field("Shaft", "shaft"),
                moc_field("Shaft Head", "shd"),
                moc_field("Coupling Rod", "c_rod"),
                moc_field("Sleeve", "slv"),
                moc_field("Pin", "pin"),
                moc_field("Bush", "bush"),
                moc_field("Protector", "protector"),
                _field("Cardan Joint", cardan_moc, available=cardan_moc is not None,
                       note="Assumed same as Pin — Cardan Joint's own wetted parts list includes the pin" if cardan_moc else None),
                moc_field("Rotor", "rotor"),
                _field("Stator Sleeve", None, available=False,
                       note="Not independently charted — distinct from the Sleeve (SLV) component above"),
                _field("Base-Plate", base_plate_default,
                       note="Standard structural default — all MOC codes use MS for equivalent non-wetted members"),
            ],
        },
        {
            "title": "MOC — Elastomers",
            "fields": [
                moc_field("Stator", "stator_rubber"),
                _field("Sleeve Ring", None, available=False),
                _field("Seal Ring", None, available=False),
                _field("Boot Seal", None, available=False),
            ],
        },
        {
            "title": "Suction & Discharge Details",
            "fields": [
                _field("Suction Size", recommendation.suction_size, available=bool(recommendation.suction_size)),
                _field("Delivery Size", recommendation.delivery_size, available=bool(recommendation.delivery_size)),
            ],
        },
        {
            "title": "Drive System",
            "fields": [
                _field("Drive Systems Type", recommendation.drive_system, available=bool(recommendation.drive_system)),
                _field("Drive Motor Rating", recommendation.motor, available=bool(recommendation.motor)),
                _field("Drive Motor Speed", selection.motor_rpm, available=bool(selection.motor_rpm)),
                _field("Motor Type", "TEFC (Totally Enclosed Fan Cooled)",
                       note="Standard default for industrial pump duty — revise if the site has hazardous-area classification"),
                _field("Motor Make", selection.motor_make or "Standard (Kirloskar / Siemens / ABB)",
                       note=None if selection.motor_make else "No make specified — showing acceptable standard makes"),
                _field("Motor Mounting", "Foot Mounted (B3)", note="Standard mounting default"),
                _field("Starter Type", starter_type, available=starter_type is not None,
                       note=f"By installed rating: <7.5kW DOL / 7.5-37kW Star-Delta / >37kW VFD" if starter_type else None),
                _field("Power Supply", "415 V / 50 Hz", note="Standard Indian industrial supply default"),
                _field("Gear Box Type", None, available=False,
                       note="HISO vs SISO depends on shaft/mounting fitment, not process inputs — needs engineering selection"
                       if uses_gearbox else "Not applicable for this drive type"),
                _field("Gear Box Model", None, available=False,
                       note="No gearbox selection catalog in source data — only gearbox test sheets exist"
                       if uses_gearbox else "Not applicable for this drive type"),
                _field("ASF", asf_band if uses_gearbox else None, available=uses_gearbox,
                       note="By duty severity (solids/viscosity) per the Backend Masters ASF bands" if uses_gearbox
                       else "Not applicable for this drive type"),
                _field("Coupling Type", "Flexible Coupling" if uses_shaft_coupling else None,
                       available=uses_shaft_coupling,
                       note="Standard default — accommodates minor shaft misalignment" if uses_shaft_coupling
                       else "Not applicable for V-Belt drive"),
                _field("Coupling Make", "Fenner / Lovejoy / Rexnord" if uses_shaft_coupling else None,
                       available=uses_shaft_coupling,
                       note="Acceptable standard makes, not a specific pick" if uses_shaft_coupling
                       else "Not applicable for V-Belt drive"),
                _field("Gear Box Mounting", "Foot Mount (B3)" if uses_gearbox else None, available=uses_gearbox,
                       note="Standard mounting default" if uses_gearbox else "Not applicable for this drive type"),
            ],
        },
        {
            "title": "Price Recommendation",
            "fields": [
                _field("Price Band", "Standard",
                       note="Populate Gearbox/Motor price masters for an exact value — no pricing data in source docs"),
            ],
        },
    ]

    # AI-suggested values for the fields with zero source data anywhere in the
    # project's masters (Stator Sleeve, Sleeve Ring, Seal Ring, Boot Seal,
    # Gear Box Type). Best-effort: no-ops silently if ANTHROPIC_API_KEY isn't
    # configured or the request fails, leaving those fields "Not available"
    # as before. See ai_suggestions.py for why these stay structurally
    # separate from tested/calculated/standard-default fields.
    ai_suggestions = get_ai_gap_suggestions({
        "model": recommendation.model,
        "media": selection.media,
        "casing_category": casing_category,
        "moc_code": moc_code,
        "viscosity_cp": viscosity_for_asf,
        "solid_pct": solid_pct,
        "drive_system": drive_system,
        "uses_gearbox": uses_gearbox,
    })
    apply_ai_gap_suggestions(sections, ai_suggestions)

    return {
        "recommendationId": str(recommendation.id),
        "model": recommendation.model,
        "mocCodeUsed": moc_code,
        "sections": sections,
    }
