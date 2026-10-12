import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { describeTag, logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { commercialTagPrice, enquiryTags } from "@/lib/db/schema";
import {
  BOI_ITEMS,
  type BoiAdjust,
  type BoiKey,
  type CommercialOther,
  MAX_DISCOUNT_PCT,
  MAX_MARKUP_PCT,
  parsePct,
  type CommercialPrices,
  MAX_OTHER_ITEMS,
  formatInr,
  parsePrice,
} from "@/lib/commercial";

export const dynamic = "force-dynamic";

// PUT /api/commercial/[tagId] — saves one tag's manually entered prices
// (replace-all: the body is the tag's full price set). Audited with the fields
// that actually changed; an unchanged save writes nothing to the trail.

const PRICE_FIELDS = [{ key: "paPrice", label: "Pump & Accessories" }, ...BOI_ITEMS] as const;

const numOrNull = (v: string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function PUT(req: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(tagId)) return error("Invalid tag id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const [tag] = await db
    .select({ projectId: enquiryTags.projectId })
    .from(enquiryTags)
    .where(eq(enquiryTags.id, tagId))
    .limit(1);
  if (!tag) return error("Tag not found", 404);

  // --- validate ------------------------------------------------------------
  const next = {} as CommercialPrices;
  for (const f of PRICE_FIELDS) {
    const v = parsePrice(body[f.key]);
    if (v === undefined) return error(`${f.label}: enter a valid amount (0 or more).`, 400);
    next[f.key] = v;
  }
  const rawOthers = Array.isArray(body.others) ? body.others : [];
  if (rawOthers.length > MAX_OTHER_ITEMS) {
    return error(`At most ${MAX_OTHER_ITEMS} other items per tag.`, 400);
  }
  const others: CommercialOther[] = [];
  for (const o of rawOthers) {
    const item = (o ?? {}) as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 100) : "";
    const price = parsePrice(item.price);
    if (price === undefined) return error(`Other item "${name || "unnamed"}": enter a valid amount.`, 400);
    if (!name && price === null) continue; // an empty row the user never filled
    if (!name) return error("Every other item with a price needs a name.", 400);
    const discountPct = parsePct(item.discountPct, MAX_DISCOUNT_PCT);
    const markupPct = parsePct(item.markupPct, MAX_MARKUP_PCT);
    if (discountPct === undefined || markupPct === undefined) {
      return error(`Other item "${name}": discount must be 0–99 % and markup 0–999 %.`, 400);
    }
    others.push({ name, price, discountPct: discountPct ?? 0, markupPct: markupPct ?? 0 });
  }
  next.others = others;
  // Vendor discount % and markup % per fixed BOI row (blank = 0; the page
  // fills 25 % markup by default).
  const rawAdjust = (body.adjust && typeof body.adjust === "object" ? body.adjust : {}) as Record<string, unknown>;
  const adjust: Partial<Record<BoiKey, BoiAdjust>> = {};
  for (const it of BOI_ITEMS) {
    const a = (rawAdjust[it.key] ?? {}) as Record<string, unknown>;
    const discountPct = parsePct(a.discountPct, MAX_DISCOUNT_PCT);
    const markupPct = parsePct(a.markupPct, MAX_MARKUP_PCT);
    if (discountPct === undefined || markupPct === undefined) {
      return error(`${it.label}: discount must be 0–99 % and markup 0–999 %.`, 400);
    }
    adjust[it.key] = { discountPct: discountPct ?? 0, markupPct: markupPct ?? 0 };
  }
  next.adjust = adjust;
  // The BOI Master VFD picked for the VFD price (a label only; the price is
  // whatever was entered). Dropped when there is no VFD price.
  const vfdModel = typeof body.vfdModel === "string" ? body.vfdModel.trim().slice(0, 100) : "";
  next.vfdModel = next.vfdPrice !== null && vfdModel ? vfdModel : null;
  const mechSealModel = typeof body.mechSealModel === "string" ? body.mechSealModel.trim().slice(0, 200) : "";
  next.mechSealModel = next.mechSealPrice !== null && mechSealModel ? mechSealModel : null;
  const drpModel = typeof body.drpModel === "string" ? body.drpModel.trim().slice(0, 200) : "";
  next.drpModel = next.drpPrice !== null && drpModel ? drpModel : null;
  // What a used L1–L4 suggestion was based on (a label; the price is whatever
  // was entered). Dropped when there is no P&A price.
  const paBasis = typeof body.paBasis === "string" ? body.paBasis.trim().slice(0, 300) : "";
  next.paBasis = next.paPrice !== null && paBasis ? paBasis : null;
  next.remarks = typeof body.remarks === "string" ? body.remarks.trim().slice(0, 2000) : "";

  // --- diff against what's stored, for the audit trail ----------------------
  const [prev] = await db
    .select()
    .from(commercialTagPrice)
    .where(eq(commercialTagPrice.tagId, tagId))
    .limit(1);
  const changes: string[] = [];
  for (const f of PRICE_FIELDS) {
    const before = prev ? numOrNull(prev[f.key]) : null;
    if (before !== next[f.key]) changes.push(`${f.label} ${formatInr(before)} → ${formatInr(next[f.key])}`);
  }
  const othersText = (list: CommercialOther[]) =>
    list.map((o) => `${o.name} ${formatInr(o.price)}`).join(", ") || "none";
  const prevOthers = prev?.others ?? [];
  if (JSON.stringify(prevOthers) !== JSON.stringify(others)) {
    changes.push(`Others ${othersText(prevOthers)} → ${othersText(others)}`);
  }
  if ((prev?.vfdModel ?? null) !== next.vfdModel) {
    changes.push(`VFD model ${prev?.vfdModel ?? "—"} → ${next.vfdModel ?? "—"}`);
  }
  if ((prev?.paBasis ?? null) !== next.paBasis) {
    changes.push(`P&A basis ${prev?.paBasis ?? "—"} → ${next.paBasis ?? "—"}`);
  }
  if ((prev?.mechSealModel ?? null) !== (next.mechSealModel ?? null)) {
    changes.push(`Mechanical seal ${prev?.mechSealModel ?? "—"} → ${next.mechSealModel ?? "—"}`);
  }
  if ((prev?.drpModel ?? null) !== next.drpModel) {
    changes.push(`DRP ${prev?.drpModel ?? "—"} → ${next.drpModel ?? "—"}`);
  }
  const pctText = (a: Partial<Record<string, BoiAdjust>> | null | undefined, key: string) => {
    const x = a?.[key];
    return x ? `-${x.discountPct ?? 0}% / +${x.markupPct ?? 0}%` : "default";
  };
  for (const it of BOI_ITEMS) {
    const before = pctText(prev?.boiAdjust, it.key);
    const after = pctText(adjust, it.key);
    if (before !== after) changes.push(`${it.label} disc/markup ${before} → ${after}`);
  }
  if ((prev?.remarks ?? "") !== next.remarks) changes.push("Remarks updated");

  const claims = tryDecodeToken(req);
  const updatedBy = claims?.sub && /^[0-9a-f-]{36}$/i.test(claims.sub) ? claims.sub : null;
  const values = {
    paPrice: next.paPrice?.toString() ?? null,
    motorPrice: next.motorPrice?.toString() ?? null,
    gearboxPrice: next.gearboxPrice?.toString() ?? null,
    vfdPrice: next.vfdPrice?.toString() ?? null,
    mechSealPrice: next.mechSealPrice?.toString() ?? null,
    mechSealModel: next.mechSealModel ?? null,
    vfdModel: next.vfdModel,
    drpModel: next.drpModel,
    paBasis: next.paBasis ?? null,
    strainerPrice: next.strainerPrice?.toString() ?? null,
    prvPrice: next.prvPrice?.toString() ?? null,
    drpPrice: next.drpPrice?.toString() ?? null,
    others,
    boiAdjust: adjust as Record<string, BoiAdjust>,
    remarks: next.remarks || null,
  };

  if (prev && changes.length === 0) return json({ ok: true, changed: false });

  const now = new Date();
  await db
    .insert(commercialTagPrice)
    .values({ projectId: tag.projectId, tagId, ...values, updatedBy, updatedAt: now })
    .onConflictDoUpdate({
      target: commercialTagPrice.tagId,
      set: { ...values, updatedBy, updatedAt: now },
    });

  if (changes.length > 0) {
    const where = (await describeTag(tagId)) ?? "tag";
    await logAudit(req, {
      action: "commercial.update",
      entity: "commercial_tag_price",
      entityId: tagId,
      detail: `Updated commercial prices for ${where}: ${changes.join("; ")}`.slice(0, 2000),
    });
  }
  return json({ ok: true, changed: changes.length > 0 });
}
