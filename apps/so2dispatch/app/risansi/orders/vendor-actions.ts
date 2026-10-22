"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { canEditChild } from "@/lib/roles";
import { BOI_ITEM_OPTIONS } from "@/lib/order-schema";
import type { BoiVendor } from "@/lib/orders";

type Result = { ok: true; vendor: BoiVendor } | { ok: false; error: string };

/**
 * Add a vendor to Purchase's list, or change one: its name, code and the
 * bought-out items it supplies. Purchase, Central Visibility and Admin.
 */
export async function saveVendorAction(input: {
  id?: string | null;
  name: string;
  vendor_code?: string;
  items: string[];
}): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_boi_items")) {
    return { ok: false, error: "You don't have permission to change vendors." };
  }
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Enter the vendor's name." };
  const known = new Set(BOI_ITEM_OPTIONS.map((o) => o.value));
  const items = [...new Set(input.items.filter((i) => known.has(i)))];
  if (items.length === 0) return { ok: false, error: "Pick at least one item the vendor supplies." };
  const code = (input.vendor_code ?? "").trim() || null;

  try {
    const r = input.id
      ? await query<BoiVendor>(
          `UPDATE boi_vendors SET name = $2, items = $3, vendor_code = $4, updated_at = now()
            WHERE id = $1 RETURNING id, name, items, vendor_code`,
          [input.id, name, items, code]
        )
      : await query<BoiVendor>(
          `INSERT INTO boi_vendors (name, items, vendor_code, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id, name, items, vendor_code`,
          [name, items, code, user.id]
        );
    const vendor = r.rows[0];
    if (!vendor) return { ok: false, error: "Vendor not found." };
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: name,
      details: `${input.id ? "Updated" : "Added"} vendor ${name} — ${items.join(", ")}`,
    });
    revalidatePath("/risansi/departments/purchase");
    return { ok: true, vendor };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "A vendor with this name is already on the list." };
    }
    console.error("saveVendorAction failed:", error);
    return { ok: false, error: "Could not save the vendor." };
  }
}

/** Take a vendor off the list. Items already ordered from it keep the name. */
export async function deleteVendorAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_boi_items")) {
    return { ok: false, error: "You don't have permission to change vendors." };
  }
  const r = await query<{ name: string }>(`DELETE FROM boi_vendors WHERE id = $1 RETURNING name`, [id]);
  if (r.rows[0]) {
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: r.rows[0].name,
      details: `Removed vendor ${r.rows[0].name}`,
    });
  }
  revalidatePath("/risansi/departments/purchase");
  return { ok: true };
}
