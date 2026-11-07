import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { DRIVE_GROUPS, MAX_DISCOUNT_PCT, isDriveGroup, parsePct } from "@/lib/commercial";
import { discountFields, discountOf, normalizeOfferConfigs } from "@/lib/commercial-offer";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { workDenied } from "@/lib/enquiry-access";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// PUT /api/commercial-offer/discount {projectId, group, paPct, boiPct}
// The quotation discount typed in the Commercial Summary table's P&A and BOI Items
// headings (user, 2026-11-07): one % each for every tag of the drive group, "" / 0 =
// none. Kept with the group's Commercial Offer edits (paDiscountPct /
// boiDiscountPct), so a saved version freezes it; nothing else there changes.
// Audited.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  const group = String(body.group ?? "");
  if (!UUID.test(projectId)) return error("'projectId' is required", 400);
  const noWork = await workDenied(req, { projectId });
  if (noWork) return noWork;
  if (!isDriveGroup(group)) return error("'group' must be GM, GB, VB or DD", 400);
  const paPct = parsePct(body.paPct, MAX_DISCOUNT_PCT);
  const boiPct = parsePct(body.boiPct, MAX_DISCOUNT_PCT);
  if (paPct === undefined || boiPct === undefined) return error("A discount must be 0 or more and below 100%", 400);
  const next = { paPct: paPct ?? 0, boiPct: boiPct ?? 0 };

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ config: projects.commercialOfferConfig, code: projects.projectCode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (!row) return null;
    const all = normalizeOfferConfigs(row.config, [...DRIVE_GROUPS]);
    const was = discountOf(all[group]);
    if (was.paPct === next.paPct && was.boiPct === next.boiPct) return { code: row.code, was, changed: false };
    const { paDiscountPct: _pa, boiDiscountPct: _boi, ...rest } = all[group];
    all[group] = { ...rest, ...discountFields(next) };
    await tx
      .update(projects)
      .set({ commercialOfferConfig: { groups: all } as unknown as Record<string, unknown> })
      .where(eq(projects.id, projectId));
    return { code: row.code, was, changed: true };
  });
  if (!result) return error("Enquiry not found", 404);
  if (result.changed) {
    await logAudit(req, {
      action: "commercial.discount",
      entity: "projects",
      entityId: projectId,
      detail: `${result.code} (${group}): discount P&A ${result.was.paPct}% → ${next.paPct}%, BOI ${result.was.boiPct}% → ${next.boiPct}%`,
    });
  }
  return json(next);
}
