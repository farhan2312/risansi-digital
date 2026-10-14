import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { getUsdInrSetting } from "@/lib/app-settings";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// PUT /api/commercial/currency {projectId, currency: "INR" | "USD", refreshRate?}
// The Commercial page's Quote in USD toggle. Switching USD on fixes the
// current Admin > USD to INR rate on the enquiry (projects.usd_inr_rate);
// refreshRate re-takes the current rate. INR clears it. Prices stay in INR.
// Audited.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return error("'projectId' is required", 400);
  const currency = body.currency === "USD" ? "USD" : body.currency === "INR" ? "INR" : null;
  if (!currency) return error("'currency' must be INR or USD", 400);

  const [p] = await db
    .select({ code: projects.projectCode, currency: projects.quoteCurrency, rate: projects.usdInrRate })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p) return error("Enquiry not found", 404);
  const oldRate = p.rate === null ? null : Number(p.rate);

  if (currency === "INR") {
    if (p.currency === "INR") return json({ ok: true, changed: false, quoteCurrency: "INR", usdInrRate: null });
    await db.update(projects).set({ quoteCurrency: "INR", usdInrRate: null }).where(eq(projects.id, projectId));
    await logAudit(req, {
      action: "commercial.currency",
      entity: "projects",
      entityId: projectId,
      detail: `${p.code}: quote in INR (was USD at ${oldRate ?? "—"})`,
    });
    return json({ ok: true, changed: true, quoteCurrency: "INR", usdInrRate: null });
  }

  // Already USD and no refresh asked: keep the fixed rate.
  if (p.currency === "USD" && oldRate && !body.refreshRate)
    return json({ ok: true, changed: false, quoteCurrency: "USD", usdInrRate: oldRate });

  const { rate } = await getUsdInrSetting();
  if (rate === null) return error("Set the USD to INR rate first (Admin > USD to INR)", 409);
  if (p.currency === "USD" && oldRate === rate)
    return json({ ok: true, changed: false, quoteCurrency: "USD", usdInrRate: rate });

  await db.update(projects).set({ quoteCurrency: "USD", usdInrRate: String(rate) }).where(eq(projects.id, projectId));
  await logAudit(req, {
    action: "commercial.currency",
    entity: "projects",
    entityId: projectId,
    detail:
      p.currency === "USD"
        ? `${p.code}: USD rate ${oldRate ?? "—"} → ${rate}`
        : `${p.code}: quote in USD at 1 USD = ₹${rate}`,
  });
  return json({ ok: true, changed: true, quoteCurrency: "USD", usdInrRate: rate });
}
