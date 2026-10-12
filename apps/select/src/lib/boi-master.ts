// BOI Master — shared by every tab (VFD, DRP, …): the editable-field shape and
// the POST/PATCH body validation. Client-safe (no DB import) so the admin page
// builds its forms from the same field lists the API validates against.

export type BoiFieldDef = {
  key: string;
  label: string;
  kind: "text" | "number" | "integer" | "date";
  required?: boolean;
  max?: number;
  /** Numbers only: must stay below this (e.g. a discount below 100%). */
  below?: number;
};

/** Validates a POST (`create`: required fields must be present) or PATCH body.
 *  NUMERIC columns come back as strings, integers as numbers, blanks as null. */
export function parseBoiBody(
  fields: BoiFieldDef[],
  body: Record<string, unknown>,
  create: boolean,
): { values: Record<string, string | number | null> } | { error: string } {
  const values: Record<string, string | number | null> = {};
  for (const f of fields) {
    if (!(f.key in body)) {
      if (create && f.required) return { error: `'${f.label}' is required` };
      continue;
    }
    const raw = body[f.key];
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!text) {
      if (f.required) return { error: `'${f.label}' can't be empty` };
      values[f.key] = null;
      continue;
    }
    if (f.kind === "number" || f.kind === "integer") {
      const n = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) return { error: `'${f.label}' must be a number (0 or more)` };
      if (f.kind === "integer" && !Number.isInteger(n)) return { error: `'${f.label}' must be a whole number` };
      if (f.below !== undefined && n >= f.below) return { error: `'${f.label}' must be below ${f.below}` };
      values[f.key] = f.kind === "integer" ? n : String(n);
    } else if (f.kind === "date") {
      const d = new Date(`${text}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) {
        return { error: `'${f.label}' must be a date (YYYY-MM-DD)` };
      }
      values[f.key] = text;
    } else {
      values[f.key] = text.slice(0, f.max ?? 255);
    }
  }
  return { values };
}
