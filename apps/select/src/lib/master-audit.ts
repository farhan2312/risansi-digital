/**
 * Audit entries for the admin master tables (Pump Model, Pulley, Gearbox
 * Type, Motor). One helper so every master records the same way:
 *
 *   action  master.create | master.update | master.delete
 *   entity  the table name, entityId the row id
 *   detail  "Motor Master · CGL 0.55 kW 1440 RPM IE2 ND80: final price 7097.5 → 7452.46"
 *
 * An update records only the fields whose value actually changed (numbers
 * compared as numbers, so "7097.50" vs "7097.5" is not a change); an update
 * that changes nothing is not recorded. Like logAudit, this never throws.
 */
import { logAudit } from "@/lib/audit";

export type MasterRow = Record<string, unknown>;

/** Bookkeeping columns that never belong in a change list. */
const IGNORED = new Set(["id", "createdAt", "updatedAt", "powerRatingRaw"]);

const MAX_CHANGES = 8;
const MAX_VALUE = 40;

/** "finalPrice" -> "final price", "headMwc" -> "head mwc" */
const fieldLabel = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

const show = (v: unknown): string => {
  if (isBlank(v)) return "—";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s;
};

const sameValue = (a: unknown, b: unknown): boolean => {
  if (isBlank(a) && isBlank(b)) return true;
  if (isBlank(a) || isBlank(b)) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== "" && String(b).trim() !== "") {
    return na === nb;
  }
  return show(a) === show(b);
};

/** "final price 7097.5 → 7452.46, frame size ND80 → ND90, +2 more" */
export function describeChanges(before: MasterRow, after: MasterRow): string[] {
  const out: string[] = [];
  for (const key of Object.keys(after)) {
    if (IGNORED.has(key) || !(key in before)) continue;
    if (sameValue(before[key], after[key])) continue;
    out.push(`${fieldLabel(key)} ${show(before[key])} → ${show(after[key])}`);
  }
  return out;
}

const joinChanges = (changes: string[]) =>
  changes.length > MAX_CHANGES
    ? `${changes.slice(0, MAX_CHANGES).join(", ")}, +${changes.length - MAX_CHANGES} more`
    : changes.join(", ");

export async function auditMasterChange(
  req: Request,
  opts: {
    /** Page name as users see it, e.g. "Motor Master". */
    master: string;
    /** Database table, stored as the audit entity. */
    table: string;
    op: "create" | "update" | "delete";
    /** Human name of the row, e.g. "CGL 0.55 kW 1440 RPM IE2 ND80". */
    label: string;
    id: string;
    before?: MasterRow;
    after?: MasterRow;
    /** Extra change notes that aren't column diffs (e.g. belt rows replaced). */
    notes?: string[];
  },
): Promise<void> {
  let what: string;
  if (opts.op === "create") {
    what = "added";
  } else if (opts.op === "delete") {
    what = "deleted";
  } else {
    const changes = [
      ...(opts.before && opts.after ? describeChanges(opts.before, opts.after) : []),
      ...(opts.notes ?? []),
    ];
    if (changes.length === 0) return; // saved without changing anything
    what = joinChanges(changes);
  }

  await logAudit(req, {
    action: `master.${opts.op}`,
    entity: opts.table,
    entityId: opts.id,
    detail: `${opts.master} · ${opts.label}: ${what}`,
  });
}

/** Joins the non-blank parts of a row label. */
export const rowLabel = (...parts: unknown[]): string =>
  parts
    // Parts are often written `cond && text`, so drop false as well as blanks.
    .filter((p) => p !== false && !isBlank(p))
    .map((p) => String(p).trim())
    .join(" ") || "row";
