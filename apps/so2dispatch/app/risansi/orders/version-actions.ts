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
import {
  freezeVersion,
  getDeptVersionsData,
  getVersionsData,
  isVersionedType,
  VERSION_DEPT_ROLES,
  type DeptVersionsData,
  type VersionsData,
} from "@/lib/order-versions";
import { ecChangeDept } from "@/lib/ec-version-changes";
import { CHOICE_DEPTS, CHOICE_LABEL, chooseOnVersion, type VersionChoice } from "@/lib/version-choice";
import { subjectForOrder } from "@/lib/audit-subject";

export type NewVersionResult = { ok: true; version: number } | { ok: false; error: string };

/** The SO's versions for the pop-up, at the version asked (the current one when null). */
export async function loadOrderVersionsAction(
  orderId: string,
  version: number | null
): Promise<{ ok: true; data: VersionsData } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  try {
    const data = await getVersionsData(orderId, version === null ? null : Math.trunc(version), user);
    return data ? { ok: true, data } : { ok: false, error: "Only Order Making, Central Visibility or Admin opens an SO's versions." };
  } catch (error) {
    console.error("loadOrderVersions failed:", error);
    return { ok: false, error: "Could not load the versions." };
  }
}

/** A department's earlier versions of the SO, its own work only, at the version asked (the one before the current when null). */
export async function loadDeptVersionsAction(
  orderId: string,
  version: number | null
): Promise<{ ok: true; data: DeptVersionsData } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const dept = ecChangeDept(user.role);
  if (!dept || !CHOICE_DEPTS[dept]) return { ok: false, error: "Only Drawing, Purchase, Quality, Planning and Assembly & Packing open their earlier versions here." };
  try {
    const data = await getDeptVersionsData(orderId, version === null ? null : Math.trunc(version), dept);
    return data ? { ok: true, data } : { ok: false, error: "This SO has no earlier version." };
  } catch (error) {
    console.error("loadDeptVersions failed:", error);
    return { ok: false, error: "Could not load the earlier version." };
  }
}

/**
 * A department's choice on the SO's new version: Not needed, or Acknowledge
 * with Copy (its work carried over) or Flush (its work on the ECs changed in
 * this version cleared; the version before keeps it). Once per version.
 */
export async function chooseOnVersionAction(orderId: string, choice: VersionChoice): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const dept = ecChangeDept(user.role);
  if (!dept || !CHOICE_DEPTS[dept]) return { ok: false, error: "Only Drawing, Purchase, Quality, Planning and Assembly & Packing choose on a version." };
  try {
    const name = user.full_name.trim() || user.email;
    const res = await chooseOnVersion(orderId, dept, choice, { id: user.id, name });
    if (!res.ok) return res;
    const subject = await subjectForOrder(orderId);
    const label = subject?.soNo ?? orderId;
    const flushed = res.flushedEcs.length ? ` — cleared on ${res.flushedEcs.map((e) => e || "EC").join(", ")}` : "";
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: label,
      details: `v${res.version}: ${CHOICE_DEPTS[dept]} — ${CHOICE_LABEL[choice]}${flushed}`,
      subject,
    });
    // Central Visibility hears what each department chose.
    await emitNotification({
      roles: ["central_visibility"],
      orderId,
      type: "dept_update",
      message: `${label} v${res.version}: ${CHOICE_DEPTS[dept]} — ${CHOICE_LABEL[choice]}${flushed}`,
    });
    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("chooseOnVersion failed:", error);
    return { ok: false, error: "Could not save your choice." };
  }
}

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
