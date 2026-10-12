"""AI-assisted suggestions for the handful of report fields with no charted
master data anywhere in the project's source tables (Stator Sleeve, Sleeve
Ring, Seal Ring, Boot Seal MOC, Gear Box Type).

These are advisory suggestions from Claude, not verified specifications —
kept structurally separate from tested/calculated/standard-default fields
via the `aiSuggestion` key, which the frontend renders as a distinct
"AI Suggestion" badge rather than folding it into the System Recommendation
column. `available` on these fields stays False; the AI value is a bonus
hint on top, not a substitute for real master data.

Requires ANTHROPIC_API_KEY. If it's unset, still the local placeholder, or
the request fails for any reason, suggestions are skipped entirely and the
caller falls back to the existing "Not available" state — never raises.
"""
from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

_GAP_KEYS = ["stator_sleeve", "sleeve_ring", "seal_ring", "boot_seal", "gear_box_type"]

_LABEL_TO_KEY = {
    "Stator Sleeve": "stator_sleeve",
    "Sleeve Ring": "sleeve_ring",
    "Seal Ring": "seal_ring",
    "Boot Seal": "boot_seal",
    "Gear Box Type": "gear_box_type",
}

_SCHEMA = {
    "type": "object",
    "properties": {
        "stator_sleeve": {"type": "string", "description": "Suggested MOC for the stator sleeve"},
        "sleeve_ring": {"type": "string", "description": "Suggested MOC for the sleeve ring"},
        "seal_ring": {"type": "string", "description": "Suggested MOC for the seal ring"},
        "boot_seal": {"type": "string", "description": "Suggested elastomer for the boot seal"},
        "gear_box_type": {
            "type": "string",
            "description": "Suggested gearbox type (e.g. Helical, Worm, Bevel-Helical), or "
                            "'Not applicable' if the drive system doesn't use a gearbox",
        },
    },
    "required": _GAP_KEYS,
    "additionalProperties": False,
}


def get_ai_gap_suggestions(context: dict) -> dict | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key or api_key.startswith("REPLACE_"):
        return None

    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed; skipping AI gap suggestions")
        return None

    prompt = (
        "You are assisting a progressive cavity pump (PCP) engineering team. "
        "The fields below have no charted master data in our internal system, "
        "so we need a plausible, standard-PCP-engineering-practice suggestion "
        "for each one — not a verified specification, just an informed estimate "
        "grounded in the duty context given.\n\n"
        f"Pump model: {context.get('model')}\n"
        f"Media / application: {context.get('media')}\n"
        f"Service classification: {context.get('casing_category')}\n"
        f"MOC code already resolved for the wetted parts: {context.get('moc_code')}\n"
        f"Viscosity: {context.get('viscosity_cp')} cP\n"
        f"Solids: {context.get('solid_pct')}%\n"
        f"Drive system: {context.get('drive_system')}\n"
        f"Uses gearbox: {context.get('uses_gearbox')}\n\n"
        "Suggest a Stator Sleeve MOC, Sleeve Ring MOC, Seal Ring MOC, and Boot "
        "Seal elastomer consistent with the resolved MOC code above, plus a "
        "Gear Box Type (Helical / Worm / Bevel-Helical / etc). For gear_box_type, "
        "reply 'Not applicable' if the drive system does not use a gearbox."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            thinking={"type": "adaptive"},
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": _SCHEMA},
            },
            messages=[{"role": "user", "content": prompt}],
        )
        if response.stop_reason == "refusal":
            logger.warning("AI gap-suggestion request was refused")
            return None
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            return None
        return json.loads(text)
    except Exception:
        logger.exception("AI gap-suggestion request failed")
        return None


def apply_ai_gap_suggestions(sections: list[dict], suggestions: dict | None) -> None:
    if not suggestions:
        return
    for section in sections:
        for f in section.get("fields", []):
            key = _LABEL_TO_KEY.get(f.get("label"))
            if key is None or f.get("available"):
                continue
            value = suggestions.get(key)
            if not value or value.strip().lower() == "not applicable":
                continue
            f["aiSuggestion"] = value.strip()
