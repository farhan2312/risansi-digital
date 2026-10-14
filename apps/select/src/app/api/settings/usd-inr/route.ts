import { error, json } from "@/lib/api";
import { getUsdInrSetting, setUsdInrRate } from "@/lib/app-settings";
import { logAudit } from "@/lib/audit";
import { AuthError, requireAdmin } from "@/lib/auth";
import { parseUsdRate } from "@/lib/commercial";

export const dynamic = "force-dynamic";

// GET /api/settings/usd-inr — the current USD -> INR rate (any signed-in user;
// the Commercial page shows it next to Quote in USD).
export async function GET() {
  return json(await getUsdInrSetting());
}

// PUT /api/settings/usd-inr {rate} — admins only. Audited with before -> after.
export async function PUT(req: Request) {
  let userId: string;
  try {
    userId = (await requireAdmin(req)).sub;
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const rate = parseUsdRate(body.rate);
  if (rate === undefined) return error("Enter a rate above 0 and up to 1000 (₹ for 1 USD)", 400);

  const before = await getUsdInrSetting();
  if (before.rate === rate) return json({ ok: true, changed: false, setting: before });

  await setUsdInrRate(rate, userId);
  await logAudit(req, {
    action: "settings.usd_inr",
    entity: "app_settings",
    entityId: null,
    detail: `USD to INR rate ${before.rate === null ? "set to" : `${before.rate} →`} ${rate}`,
  });
  return json({ ok: true, changed: true, setting: await getUsdInrSetting() });
}
