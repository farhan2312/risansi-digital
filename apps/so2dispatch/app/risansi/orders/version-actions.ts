"use server";

import { revalidatePath } from "next/cache";
import { query, withTransaction } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { canMakeVersions } from "@/lib/roles";
import { isClosedStatus } from "@/lib/dept-view";
import type { DeptKey } from "@/lib/dept-completion";
import { deptInvolvedInOrder } from "@/lib/orders";
import { logAudit } from "@/lib/audit";
import { emitNotification } from "@/lib/notifications";
import { freezeVersion, isVersionedType, VERSION_DEPT_ROLES } from "@/lib/order-versions";

export type NewVersionResult = { ok: true; version: number } | { ok: false; error: string };

/**
 * Order Making PO, Central Visibility or Admin saves a Pump SO as it stands as a read-only version; the SO
 * goes on as the next version, a copy of it, which they then edit as usual.
 * The departments working on it hear of the new version.
 */
export async function createOrderVersionAction(orderId: string, reason: string): Promise<NewVersionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canMakeVersions(user.role)) return { ok: false, error: "Only Order Making PO, Central Visibility or Admin makes a new version of an SO." };
  const why = reason.trim().slice(0, 1000);
  if (!why) return { ok: false, error: "Say why the new version is made." };

  try {
    const o = (
      await query<{ so_no: string | null; sl_no: number; order_type: string | null; status_override: string | null }>(
        `SELECT so_no, sl_no::int AS sl_no, order_type, status_override FROM orders WHERE id = $1`,
        [orderId]
      )
    ).rows[0];
    if (!o) return { ok: false, error: "Order not found." };
    if (!isVersionedType(o.order_type)) return { ok: false, error: "Only a Pump SO has versions." };
    if (isClosedStatus(o.status_override)) return { ok: false, error: "This SO is cancelled or diverted." };
    const label = o.so_no ?? `#${o.sl_no}`;

    const { frozen, current } = await withTransaction((client) =>
      freezeVersion(client, { orderId, reason: why, userId: user.id, userName: user.full_name.trim() || user.email })
    );

    // Who works on it: each of them hears of the new version.
    const depts = Object.keys(VERSION_DEPT_ROLES) as DeptKey[];
    const involved = (await Promise.all(depts.map((d) => deptInvolvedInOrder(d, orderId).then((yes) => (yes ? d : null))))).filter(
      (d): d is DeptKey => d !== null
    );
    const roles = [...involved.map((d) => VERSION_DEPT_ROLES[d]), "central_visibility"];
    await Promise.all([
      logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "order.update",
        category: "activity",
        target: label,
        details: `New version: v${frozen} saved read-only, the SO is now v${current} — reason: ${why}`,
        subject: { orderId, soNo: label },
      }),
      emitNotification({
        roles,
        orderId,
        type: "dept_update",
        message: `${label} revised to v${current} · ${why} · v${frozen} is kept read-only under the SO's Versions`,
      }),
    ]);
    revalidatePath("/risansi/departments/order-making");
    revalidatePath(`/risansi/orders/${orderId}`);
    revalidatePath(`/risansi/orders/${orderId}/versions`);
    return { ok: true, version: current };
  } catch (error) {
    console.error("createOrderVersion failed:", error);
    return { ok: false, error: "Could not make the new version." };
  }
}
