"use server";

import { revalidatePath } from "next/cache";
import { query, withTransaction } from "@/lib/db";
import type { NewBoiItem } from "@/lib/orders";
import { getCurrentUser } from "@/lib/session";
import {
  addChildRow,
  createItemWithBoiItems,
  setItemOrderCopy,
  setInvoiceLrFile,
  createOrder,
  deleteChildRow,
  deleteItem,
  deleteOrder,
  deleteQcDocument,
  getChildOrderId,
  getItemDetail,
  getOrderDetail,
  insertBillingDocs,
  lockFactsForChild,
  lockFactsForOrder,
  getOrderRep,
  moveTermPaymentToPi,
  addAccountsHoldReason,
  listAccountsHoldReasons,
  setAccountsHold,
  orderHasPi,
  savePiPayment,
  saveTermPayment,
  lockFactsForItem,
  getOrderLabel,
  recomputeDispatchStatus,
  insertQcDocument,
  listQcDocuments,
  addTargetRevision,
  completeDept,
  deleteLatestTargetRevision,
  deptInvolvedInOrder,
  saveReadyLots,
  syncPumpEcStatus,
  syncReadyQtyFromLots,
  inheritSparePlanning,
  saveLotPacking,
  logReadinessChange,
  listReadyLotHistory,
  type ReadyLotEvent,
  listSoEcsForSection,
  applyUsdConversion,
  getOrderStatusState,
  setOrderStatus,
  fillFirstTargets,
  listTargetRevisions,
  uncompleteDept,
  updateChildRow,
  updateOrderSection,
  packingSlipReady,
  createDispatchFromSlips,
  type OrderDetail as OrderDetailData,
  type NewItemInput,
  type NewOrderInput,
  type QcDocTable,
  type QcDocumentMeta,
} from "@/lib/orders";
import {
  CHILD_FIELDS,
  ORDER_STATUS_OPTIONS,
  splitHoldReason,
  PAYMENT_HOLD_VALUE,
  PAYMENT_STATUS_OPTIONS,
  SECTION_BY_TABLE,
  BILL_TYPE_FOR_MODE,
  FR_PAYMENT_TERMS_REMARKS,
  ORDER_MAKING_EDITABLE,
  ORDER_MAKING_FIELDS,
  ORDER_MAKING_SO_EDITABLE,
  firstOrderMakingMissing,
  firstAfterOperationMissing,
  ADD_ON_PUMP_FIELDS,
  ADD_ON_SPARE_FIELDS,
  firstMissingAddOnField,
  paymentTermsText,
  type ChildTable,
  type OrderTable,
  withoutBarePrefix,
  ONLY_BILLING,
  isOnlyBilling,
} from "@/lib/order-schema";
import {
  getClientByCode,
  searchClients,
  type MarketIntellClient,
} from "@/lib/market-intell";
import {
  canAccessDepartment,
  canCreateOrders,
  canManageEcs,
  isOrderMaking,
  isOrderMakingAny,
  isOrderMakingSo,
  canEditChild,
  canEditQcDocuments,
  canEditQcRequirementDocs,
  canEditSection,
  canViewAll,
  isCentral,
  isRep,
  isReadOnlyViewer,
} from "@/lib/roles";
import { parsePiWorkbook } from "@/lib/pi-import";
import { isAssignedTo, markSoDetails } from "@/lib/so-assignment";
import { DEPT_FILTER_KEYS } from "@/lib/dept-status";
import { isClosedStatus, repMatches } from "@/lib/dept-view";
import {
  describeDays,
  DEPT_LABELS,
  type DeptCompletion,
  type DeptKey,
} from "@/lib/dept-completion";
import {
  isTargetKey,
  TARGET_BY_KEY,
  type TargetRevision,
} from "@/lib/target-dates";
import { logAudit } from "@/lib/audit";
import {
  PACKING_LOTS_FIELD,
  LOT_NOS_FIELD,
  parseLotNos,
  READY_LOTS_FIELD,
  lotsError,
  lotsFromRows,
  packingError,
  packingLotsFromRows,
  type ReadyLot,
} from "@/lib/ready-lots";
import { getUsdInrRate } from "@/lib/settings";
import { lockReason } from "@/lib/order-lock";
import {
  checkFieldBounds,
  cleanBoiRows,
} from "@/lib/order-validation";
import {
  childLabel,
  childValues,
  describeChanges,
  qcDocumentSubject,
  subjectForChild,
  subjectForItem,
  subjectForOrder,
} from "@/lib/audit-subject";
import {
  drawingHandoffDetail,
  drawingHandoffEvents,
  emitNotification,
  notifySectionSaved,
  paymentTermNotice,
  targetDateRecipients,
  type DrawingHandoffs,
} from "@/lib/notifications";

export type CreateOrderResult =
  | { ok: true; slNo: number; id: string }
  | { ok: false; error: string };

export async function createOrderAction(
  input: NewOrderInput,
  /** From Order Making's own form: its Purchase Order details must all be in. */
  opts?: { orderMakingForm?: boolean }
): Promise<CreateOrderResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canCreateOrders(user.role)) {
    return { ok: false, error: "You don't have permission to create orders." };
  }

  // Order Making fills Client and Purchase Order details only; anything else
  // in the request (an import column, a crafted call) is not theirs to set.
  if (isOrderMaking(user.role)) {
    const own = new Set(ORDER_MAKING_EDITABLE.map((f) => f.column));
    input = Object.fromEntries(
      Object.entries(input).filter(([k]) => own.has(k))
    ) as NewOrderInput;
    if (input.order_type === "Spare") input = { ...input, boi: "No", qc_required: "No" };
  }
  if (!(input.client_code ?? "").trim()) {
    return { ok: false, error: "Client Code is required." };
  }
  if (opts?.orderMakingForm && isOrderMaking(user.role)) {
    const given = input as Record<string, unknown>;
    const missing = firstOrderMakingMissing("po", (c) => String(given[c] ?? ""));
    if (missing) return { ok: false, error: `${missing.label} is required.` };
  }
  // The bill type follows the Bill Mode.
  if (input.bill_mode) input = { ...input, bill_type: BILL_TYPE_FOR_MODE[input.bill_mode] ?? input.bill_type };
  if (input.clearance_status === "Hold" && !(input.clearance_hold_reason ?? "").trim()) {
    return { ok: false, error: "Choose a Hold Reason." };
  }
  // Order value and quantity cannot be negative — the form says so, but this
  // is also how the Excel import creates orders.
  const bounds = checkFieldBounds(
    SECTION_BY_TABLE.get("orders")!.fields,
    input as Record<string, unknown>
  );
  if (bounds) return { ok: false, error: bounds };

  try {
    const { id, sl_no } = await createOrder(input);
    // An FR order is a replacement: no payment terms, and its remarks say so.
    await markReplacementTerms(id);
    const label = (input.so_no ?? `#${sl_no}`).trim();
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.create",
      category: "activity",
      target: label,
      details: `Created order ${label} (Sl. No. ${sl_no})`,
      subject: { orderId: id, soNo: label },
    });

    // Creating an order doesn't notify anyone by itself, but the trigger
    // fields (payment terms, target dates) count as being set if they're
    // filled in on the create form — otherwise those departments would never
    // hear about them. `before: null` makes every filled field a transition.
    await notifySectionSaved({
      orderId: id,
      orderLabel: label,
      table: "orders",
      actorRole: user.role,
      before: null,
      after: input as Record<string, unknown>,
    });
    // A delivery or hand-over date on the new order gives its first targets,
    // and a USD value its INR conversion.
    await Promise.all([
      autoFillTargets(id, user),
      getUsdInrRate().then((rate) => applyUsdConversion(id, rate)),
    ]);
    // Order Making hands the SO over once its SO details are in: Central
    // Visibility then fills its terms, targets and ECs.
    await markSoDetails(id, { id: user.id, role: user.role, name: user.full_name });

    revalidatePath("/risansi/orders");
    revalidatePath("/risansi/departments/order-making");
    return { ok: true, slNo: sl_no, id };
  } catch (error) {
    console.error("createOrder failed:", error);
    return { ok: false, error: "Could not create the order. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Client lookup from the Market Intell database (READ-ONLY — see
// lib/market-intell.ts). Powers the debounced client search on the orders page.
// ---------------------------------------------------------------------------

export type ClientSearchResult =
  | { ok: true; clients: MarketIntellClient[] }
  | { ok: false; error: string };

/** Debounced type-ahead over Market Intell clients (code or legal name). */
export async function searchClientsAction(
  term: string
): Promise<ClientSearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canCreateOrders(user.role)) {
    return { ok: false, error: "You don't have permission to create orders." };
  }
  try {
    return { ok: true, clients: await searchClients(term) };
  } catch (error) {
    console.error("searchClients failed:", error);
    return { ok: false, error: "Could not reach the client directory." };
  }
}

/**
 * Create an SO seeded from a Market Intell client. Only the client CODE comes
 * from the browser — the stored details are re-read server-side, so a tampered
 * request can't inject arbitrary client data.
 */
export async function createOrderFromClientAction(
  clientCode: string
): Promise<CreateOrderResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canCreateOrders(user.role)) {
    return { ok: false, error: "You don't have permission to create orders." };
  }

  let client: MarketIntellClient | null;
  try {
    client = await getClientByCode(clientCode);
  } catch (error) {
    console.error("getClientByCode failed:", error);
    return { ok: false, error: "Could not reach the client directory." };
  }
  if (!client) return { ok: false, error: "That client was not found." };

  return createOrderAction({
    client_code: client.code,
    client_name: client.legal_name ?? undefined,
    market_type: client.market_type ?? undefined,
    client_type: client.client_type ?? undefined,
    industry_type: client.industry ?? undefined,
    zone: client.zone ?? undefined,
    reps: client.rep_name ?? undefined,
  });
}

export type ViewPisPayload = {
  bill_type: string | null;
  // For Tax Invoice: the PI list. For Challan: a single flat row (or null).
  pis: Record<string, unknown>[];
  challan: Record<string, unknown> | null;
};

/** Read-only PI (or Challan) view for the Accounts workspace. */
export async function getOrderPisAction(
  orderId: string
): Promise<ViewPisPayload> {
  const user = await getCurrentUser();
  if (!user || isOrderMakingAny(user.role)) return { bill_type: null, pis: [], challan: null };
  if (!(await repMaySee(user, orderId))) return { bill_type: null, pis: [], challan: null };
  const detail = await getOrderDetail(orderId);
  if (!detail) return { bill_type: null, pis: [], challan: null };
  return {
    bill_type: (detail.order.bill_type as string | null) ?? null,
    pis: detail.order_billing_docs ?? [],
    challan: (detail.order_billing as Record<string, unknown> | null) ?? null,
  };
}

/** An SO and its ECs (every EC field), for the Orders page's EC pop-up. */
/** Another SO already carrying this SO No., as "#<Sl. No.>" — for a warning on the form; null when none. */
export async function soNoTakenAction(soNo: string, exceptOrderId: string | null): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const v = withoutBarePrefix("so_no", soNo);
  if (!v) return null;
  const r = await query<{ sl_no: number }>(
    `SELECT sl_no::int AS sl_no FROM orders
      WHERE upper(btrim(so_no)) = upper($1) AND ($2::uuid IS NULL OR id <> $2::uuid)
      ORDER BY sl_no LIMIT 1`,
    [v, exceptOrderId && UUID_RE_ACTION.test(exceptOrderId) ? exceptOrderId : null]
  );
  return r.rows[0] ? `Sl. ${r.rows[0].sl_no}` : null;
}

export async function getOrderEcsAction(
  orderId: string
): Promise<{ order: Record<string, unknown>; items: Record<string, unknown>[] } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await repMaySee(user, orderId))) return null;
  const detail = await getOrderDetail(orderId);
  if (!detail) return null;
  const o = detail.order;
  return {
    order: { id: o.id, sl_no: o.sl_no, so_no: o.so_no, client_name: o.client_name, order_type: o.order_type, boi: o.boi },
    items: [...detail.items].sort((a, b) => String(a.ec_no ?? "").localeCompare(String(b.ec_no ?? ""), undefined, { numeric: true })),
  };
}

/** An EC's bought-out items in full (stock, vendor, received), for the EC pop-up. */
export async function ecBoiListAction(itemId: string): Promise<Record<string, unknown>[]> {
  const user = await getCurrentUser();
  if (!user || !UUID_RE_ACTION.test(itemId)) return [];
  const owner = await query<{ order_id: string }>(`SELECT order_id FROM order_items WHERE id = $1`, [itemId]);
  const orderId = owner.rows[0]?.order_id;
  if (!orderId || !(await repMaySee(user, orderId))) return [];
  const r = await query<Record<string, unknown>>(
    `SELECT * FROM order_boi_items WHERE item_id = $1 ORDER BY created_at`,
    [itemId]
  );
  return r.rows;
}

/** The SO's core "Order details" row, for a read-only popup. Any signed-in
 *  user with a workspace can view it (billing/accounts "View order details"). */
export async function getOrderCoreAction(
  orderId: string
): Promise<Record<string, unknown> | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await repMaySee(user, orderId))) return null;
  const detail = await getOrderDetail(orderId);
  if (!detail) return null;
  if (isOrderMakingAny(user.role)) {
    // An SO member: only the SOs assigned to them.
    if (isOrderMakingSo(user.role) && !(await isAssignedTo(orderId, user.id))) return null;
    return Object.fromEntries(
      ["id", "sl_no", ...ORDER_MAKING_FIELDS.map((f) => f.column)].map((c) => [c, detail.order[c] ?? null])
    );
  }
  // The terms live in their lines; the popup reads them as one.
  return {
    ...detail.order,
    payment_terms: paymentTermsText(detail.order_payment_terms, detail.order.payment_terms) || null,
  };
}

export type CreateItemResult =
  | { ok: true; itemId: string }
  | { ok: false; error: string };

/**
 * Add an EC/pump item to an SO (the Add-On form). Central Visibility only.
 * `boi` are the bought-out items listed on the form: Central Visibility says
 * what is bought out, Purchase records what happens to each afterwards.
 */
export async function createItemAction(
  orderId: string,
  input: NewItemInput,
  boi?: unknown
): Promise<CreateItemResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const denied = await ecDenied(user, orderId);
  if (denied) return { ok: false, error: denied };

  const order = await getOrderDetail(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isOnlyBilling(order.order)) return { ok: false, error: "An Only Billing SO has no ECs." };

  // Every EC inherits the SO's Order Type (Pump/Spare) — the Add-On is of that
  // type, not re-selected per EC.
  const itemInput: NewItemInput = {
    ...input,
    item_type: (order.order.order_type as string | null) ?? input.item_type,
  };

  // Every Add-On field is mandatory (the Spare's Order Copy file aside). The
  // form checks this too; repeated here so a crafted request can't create a
  // half-filled EC.
  const missing = firstMissingAddOnField(
    itemInput.item_type,
    itemInput as Record<string, unknown>
  );
  if (missing) return { ok: false, error: `${missing.label} is required.` };

  // Each bought-out row filled in full (item, make, qty, description).
  const boiRows = cleanBoiRows(boi);
  if (!boiRows.ok) return { ok: false, error: boiRows.error };
  // The list belongs to a pump whose own BOI is Yes: the form offers it only
  // then, and this is the same rule on the endpoint. BOI Yes needs an item.
  const ecBoi = String(itemInput.boi ?? "").trim();
  if (ecBoi === "Yes" && boiRows.rows.length === 0 && itemInput.item_type !== "Spare") {
    return { ok: false, error: "BOI is Yes: add the bought-out items." };
  }
  if (boiRows.rows.length > 0 && ecBoi !== "Yes") {
    return {
      ok: false,
      error: "This EC's BOI is not set to Yes, so it cannot list bought-out items.",
    };
  }
  // A pump with bought-out items brings Purchase in on the SO: Purchase's
  // queue is keyed on the SO's BOI.
  if (ecBoi === "Yes" && String(order.order.boi ?? "") !== "Yes") {
    await query(`UPDATE orders SET boi = 'Yes', updated_at = now() WHERE id = $1`, [orderId]);
  }

  try {
    const { id: itemId } = await createItemWithBoiItems(
      orderId,
      itemInput,
      boiRows.rows
    );
    const soLabel = String(order.order.so_no ?? `#${order.order.sl_no}`);
    const ecLabel = (input.ec_no ?? "").trim();
    const label = ecLabel ? `${soLabel} · ${ecLabel}` : soLabel;
    // Everything after the EC exists — its audit lines, Purchase's notice and
    // any first targets it settles — is independent, so it runs together.
    // All of it is awaited before the Add answers; none of it throws.
    const follow: Promise<unknown>[] = [
      logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "order.update",
        category: "activity",
        target: label,
        details: ecLabel ? `Added EC ${ecLabel} to ${soLabel}` : `Added an EC to ${soLabel}`,
        subject: { orderId, itemId, soNo: soLabel, ecNo: ecLabel || null },
      }),
      // A new EC can settle Drawing's target: its quantity may be the one the
      // SO did not state, and it may be the first EC that is not a Spare.
      autoFillTargets(orderId, user),
      // A Spare SO is planned as one: the new EC joins it where it stands.
      inheritSparePlanning(itemId, { id: user.id, role: user.role }).catch((error) =>
        console.error("inheritSparePlanning failed:", error)
      ),
    ];

    // Bought-out items listed with the EC are Purchase's work, so they hear
    // about them rather than having to find them.
    if (boiRows.rows.length > 0) {
      const named = boiRows.rows
        .map((r) => (r.boi_item === "Others" ? r.boi_item_other || "Others" : r.boi_item))
        .join(", ");
      const roles = ["purchase"];
      if (user.role !== "central_visibility") roles.push("central_visibility");
      follow.push(
        logAudit({
          actor: { id: user.id, email: user.email, role: user.role },
          action: "order.update",
          category: "activity",
          target: label,
          details: `Listed ${boiRows.rows.length} bought-out item(s) on ${
            ecLabel || "the EC"
          } — ${named}`,
          subject: { orderId, itemId, soNo: soLabel, ecNo: ecLabel || null },
        }),
        emitNotification({
          roles,
          orderId,
          itemId,
          type: "dept_update",
          message: `Bought-out items to purchase — ${label} · ${named}`,
        })
      );
    }

    // No target-date notifications here: target dates are SO-level and fire
    // on order create/update, not on adding an EC.
    await Promise.all(follow);
    revalidatePath("/risansi/orders");
    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true, itemId };
  } catch (error) {
    console.error("createItem failed:", error);
    return { ok: false, error: "Could not add the EC item. Please try again." };
  }
}

const MAX_ORDER_COPY_BYTES = 8 * 1024 * 1024; // stay under the action-body cap

/**
 * Add a Spare EC — like createItemAction but takes FormData so it can carry
 * the Order Copy file. Fields: ec_no, ec_date, quantity, and optional
 * `order_copy` file input.
 */
export async function createSpareItemAction(
  orderId: string,
  formData: FormData
): Promise<CreateItemResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const denied = await ecDenied(user, orderId);
  if (denied) return { ok: false, error: denied };

  const file = formData.get("order_copy");
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile && file.size > MAX_ORDER_COPY_BYTES) {
    return { ok: false, error: `"${file.name}" is larger than 8MB.` };
  }

  const input: NewItemInput = {
    ec_no: (formData.get("ec_no") as string | null) ?? undefined,
    ec_date: (formData.get("ec_date") as string | null) ?? undefined,
    model_no: (formData.get("model_no") as string | null) ?? undefined,
    internal_model: (formData.get("internal_model") as string | null) ?? undefined,
    version: (formData.get("version") as string | null) ?? undefined,
    quantity: (formData.get("quantity") as string | null) ?? undefined,
    // A Spare even before the SO's Order Type is set — Planning reads it off the EC.
    item_type: "Spare",
  };

  // The bought-out items ride along as JSON — FormData carries only strings.
  let boi: unknown = [];
  const boiRaw = formData.get("boi");
  if (typeof boiRaw === "string" && boiRaw.trim() !== "") {
    try {
      boi = JSON.parse(boiRaw);
    } catch {
      return { ok: false, error: "Bought-out items are malformed." };
    }
  }

  const result = await createItemAction(orderId, input, boi);
  if (!result.ok) return result;

  if (hasFile) {
    try {
      const data = Buffer.from(await file.arrayBuffer());
      await setItemOrderCopy(result.itemId, {
        name: file.name,
        mimeType: file.type || null,
        size: file.size,
        data,
      });
      revalidatePath(`/risansi/orders/${orderId}`);
    } catch (error) {
      // The EC is already saved — surface the upload failure so the user knows
      // to retry the file (via edit later, once wired), but keep the EC row.
      console.error("setItemOrderCopy failed:", error);
      return {
        ok: false,
        error: "EC added, but the Order Copy file failed to upload. Retry the upload.",
      };
    }
  }

  return result;
}

/** Attach or replace a Spare EC's Order Copy after creation. */
export async function uploadItemOrderCopyAction(
  itemId: string,
  orderId: string,
  formData: FormData
): Promise<ChildActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const denied = await ecDenied(user, orderId);
  if (denied) return { ok: false, error: denied };
  const file = formData.get("order_copy");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to attach." };
  }
  if (file.size > MAX_ORDER_COPY_BYTES) {
    return { ok: false, error: `"${file.name}" is larger than 8MB.` };
  }
  try {
    const data = Buffer.from(await file.arrayBuffer());
    await setItemOrderCopy(itemId, {
      name: file.name,
      mimeType: file.type || null,
      size: file.size,
      data,
    });
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "Order Copy",
      details: `Attached Order Copy "${file.name}"`,
      subject: await subjectForItem(itemId),
    });
    revalidatePath(`/risansi/orders/${orderId}/items/${itemId}`);
    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("uploadItemOrderCopy failed:", error);
    return { ok: false, error: "Could not attach the file. Please try again." };
  }
}

export type DeleteItemResult = { ok: true } | { ok: false; error: string };

/** Delete an EC item (cascades to its department detail + lots). */
export async function deleteItemAction(itemId: string): Promise<DeleteItemResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canManageEcs(user.role)) {
    return { ok: false, error: "You don't have permission to delete EC items." };
  }
  try {
    const detail = await getItemDetail(itemId);
    const orderId = detail ? String(detail.order.id) : null;
    const denied = orderId ? await ecDenied(user, orderId) : null;
    if (denied) return { ok: false, error: denied };
    await deleteItem(itemId);
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: detail ? String(detail.item.ec_no ?? "EC item") : "EC item",
      details: detail
        ? `Deleted ${detail.item.ec_no ? `EC ${String(detail.item.ec_no)}` : "an EC"} from ${String(detail.order.so_no ?? `#${detail.order.sl_no}`)}`
        : "Deleted an EC",
      subject: detail
        ? {
            orderId: String(detail.order.id),
            itemId,
            soNo: String(detail.order.so_no ?? `#${detail.order.sl_no}`),
            ecNo: (detail.item.ec_no as string | null) ?? null,
          }
        : { itemId },
    });
    revalidatePath("/risansi/orders");
    if (orderId) revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("deleteItem failed:", error);
    return { ok: false, error: "Could not delete the EC item. Please try again." };
  }
}

/**
 * Why this user may not add, edit or delete the ECs of this SO, or null when
 * they may: Order Making PO, Central Visibility and Admin on any SO, an Order
 * Making SO member on the SOs assigned to them.
 */
async function ecDenied(user: { id: string; role: string }, orderId: string): Promise<string | null> {
  if (!canManageEcs(user.role)) return "You don't have permission to change EC items.";
  if (isOrderMakingSo(user.role) && !(await isAssignedTo(orderId, user.id))) {
    return "This SO is not assigned to you.";
  }
  return null;
}

export type DeleteOrderResult = { ok: true } | { ok: false; error: string };

export async function deleteOrderAction(
  orderId: string
): Promise<DeleteOrderResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  // Same roles that create orders may delete them (Central Visibility / Admin).
  if (!canCreateOrders(user.role)) {
    return { ok: false, error: "You don't have permission to delete orders." };
  }

  try {
    const detail = await getOrderDetail(orderId);
    const label = detail
      ? String(detail.order.so_no ?? `#${detail.order.sl_no}`)
      : orderId;
    await deleteOrder(orderId);
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.delete",
      category: "activity",
      target: label,
      details: `Deleted order ${label}`,
      subject: { orderId, soNo: detail ? label : null },
    });
    revalidatePath("/risansi/orders");
    return { ok: true };
  } catch (error) {
    console.error("deleteOrder failed:", error);
    return { ok: false, error: "Could not delete the order. Please try again." };
  }
}

export type UpdateSectionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Save one section. `id` is the SO's order_id for SO-scope sections
 * (orders/billing/accounts) or the EC's item_id for item-scope sections
 * (order_items + drawing/purchase/qc/planning/dispatch).
 */
export async function updateOrderSectionAction(
  id: string,
  table: string,
  values: Record<string, string>
): Promise<UpdateSectionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  const section = SECTION_BY_TABLE.get(table as OrderTable);
  if (!section) {
    return { ok: false, error: "Unknown section." };
  }

  const orderMaker = isOrderMakingAny(user.role) && table === "orders";
  // Order Making fills the EC form (Pump or Spare Add-On), so it may correct
  // those fields on an EC — nothing else; an SO member only on its own SOs.
  const omEc = isOrderMakingAny(user.role) && table === "order_items";
  if (omEc) {
    const ec = await getItemDetail(id);
    const denied = ec ? await ecDenied(user, String(ec.order.id)) : "EC not found.";
    if (denied) return { ok: false, error: denied };
  }
  if (orderMaker && isOrderMakingSo(user.role) && !(await isAssignedTo(id, user.id))) {
    return { ok: false, error: "This SO is not assigned to you." };
  }
  if (!canEditSection(user.role, table as OrderTable) && !orderMaker && !omEc) {
    return {
      ok: false,
      error: "You don't have permission to edit this section.",
    };
  }

  // Non-central users can't edit fields marked centralOnly (filled by Mitali).
  let allowedValues = values;
  // Order Making PO: Client, Purchase Order and Sales Order details. Order
  // Making SO: the Sales Order details only.
  if (orderMaker) {
    const own = new Set((isOrderMakingSo(user.role) ? ORDER_MAKING_SO_EDITABLE : ORDER_MAKING_EDITABLE).map((f) => f.column));
    allowedValues = Object.fromEntries(Object.entries(values).filter(([k]) => own.has(k)));
    if (allowedValues.order_type === "Spare") {
      allowedValues = { ...allowedValues, boi: "No", qc_required: "No" };
    }
    // Its own details all in: the PO's Purchase Order, an SO member's Sales Order — as they stand once saved.
    const now = (await getOrderDetail(id))?.order ?? {};
    const after = (c: string) => String((c in allowedValues ? allowedValues[c] : now[c]) ?? "");
    const soMemberHere = isOrderMakingSo(user.role);
    // Order Making PO on an SO assigned to themself fills its Sales Order details too.
    const selfAssigned = !soMemberHere && String(now.so_assignee_id ?? "") === user.id;
    const missing =
      firstOrderMakingMissing(soMemberHere ? "so" : "po", after, (c) => String(now[c] ?? "")) ??
      (selfAssigned ? firstOrderMakingMissing("so", after) : null);
    if (missing) return { ok: false, error: `${missing.label} is required.` };
  }
  if (omEc) {
    const own = new Set([...ADD_ON_PUMP_FIELDS, ...ADD_ON_SPARE_FIELDS].map((f) => f.column));
    allowedValues = Object.fromEntries(Object.entries(allowedValues).filter(([k]) => own.has(k)));
  }
  if (!isCentral(user.role)) {
    const centralOnly = new Set(
      section.fields.filter((f) => f.centralOnly).map((f) => f.column)
    );
    allowedValues = Object.fromEntries(
      Object.entries(allowedValues).filter(([k]) => !centralOnly.has(k))
    );
  }
  // Once the SO has a PI, Accounts records against each PI and the SO's
  // payment is their roll-up — the SO form keeps only GST %.
  if (table === "order_accounts" && (await orderHasPi(id))) {
    const rolledUp = new Set(PI_ROLLED_UP);
    allowedValues = Object.fromEntries(Object.entries(allowedValues).filter(([k]) => !rolledUp.has(k)));
  }

  // Gone to Operation: Central's Order details carry its terms, documents,
  // target dates and the day it went to PPC — as they stand once saved.
  if (table === "orders" && !orderMaker) {
    const detail = await getOrderDetail(id);
    const now = detail?.order ?? {};
    const after = (c: string) => String((c in allowedValues ? allowedValues[c] : now[c]) ?? "");
    const missing = firstAfterOperationMissing(after, (detail?.order_payment_terms ?? []).length > 0);
    if (missing) return { ok: false, error: `Sent to Operation: ${missing.label} is required.` };
  }

  const tbl = table as OrderTable;
  const bounds = checkFieldBounds(section.fields, allowedValues);
  if (bounds) return { ok: false, error: bounds };
  // A pump EC turned to BOI Yes brings Purchase in on its SO, as when it is added.
  if (tbl === "order_items" && allowedValues.boi === "Yes") {
    await query(
      `UPDATE orders o SET boi = 'Yes', updated_at = now()
         FROM order_items i
        WHERE i.id = $1 AND o.id = i.order_id AND COALESCE(o.boi, '') <> 'Yes'`,
      [id]
    );
  }
  try {
    if (section.scope === "so") {
      const before = await getOrderDetail(id);
      if (tbl === "orders" && "clearance_status" in allowedValues && !allowedValues.clearance_status) {
        // Blank is Clear: an SO is clear unless held.
        allowedValues = { ...allowedValues, clearance_status: "Clear" };
      }
      if (tbl === "orders" && before) {
        const status = "clearance_status" in allowedValues
          ? allowedValues.clearance_status
          : String(before.order.clearance_status ?? "");
        const reason = "clearance_hold_reason" in allowedValues
          ? allowedValues.clearance_hold_reason
          : String(before.order.clearance_hold_reason ?? "");
        if (status === "Hold" && !(reason ?? "").trim()) {
          return { ok: false, error: "Choose a Hold Reason." };
        }
      }
      // Sections an order carries no work for take no entries: an order paid
      // after receipt has no payment for Accounts to record. The form hides
      // the fields; this is the same rule on the endpoint.
      const locked = lockReason(tbl, before?.order as never, user.role);
      if (locked) return { ok: false, error: locked };
      // The amount received may exceed the order value (with GST): Accounts
      // records what actually came in.
      await updateOrderSection(id, tbl, allowedValues);
      // The bill type follows the Bill Mode (it is no longer chosen on its own),
      // and so does Only Billing, the switch the departments read.
      if (tbl === "orders" && "bill_mode" in allowedValues) {
        const onlyBilling = allowedValues.bill_mode === ONLY_BILLING;
        await query(
          `UPDATE orders SET bill_type = $2, only_billing = $3,
                  so_reference = CASE WHEN $3 = 'Yes' THEN so_reference END,
                  only_billing_remarks = CASE WHEN $3 = 'Yes' THEN only_billing_remarks END
            WHERE id = $1`,
          [id, BILL_TYPE_FOR_MODE[allowedValues.bill_mode] ?? null, onlyBilling ? "Yes" : "No"]
        );
        await markReplacementTerms(id);
      }
      // An EC added before the SO had an Order Type takes it now — Planning and
      // the other departments read Pump or Spare off the EC.
      if (tbl === "orders" && allowedValues.order_type) {
        const typed = await query<{ id: string }>(
          `UPDATE order_items SET item_type = $2 WHERE order_id = $1 AND NULLIF(btrim(item_type), '') IS NULL RETURNING id`,
          [id, allowedValues.order_type]
        );
        if (allowedValues.order_type === "Spare") {
          for (const r of typed.rows) await inheritSparePlanning(r.id, { id: user.id, role: user.role });
        }
      }
      const after = before ? await getOrderDetail(id) : null;
      const pick = (d: NonNullable<typeof before>) =>
        tbl === "orders"
          ? d.order
          : ((d as Record<string, unknown>)[tbl] as Record<string, unknown> | null);
      // Named as it reads after the save, so renaming the SO logs under the
      // new number with the old one in the change list.
      const current = (after ?? before)?.order;
      const label = current ? String(current.so_no ?? `#${current.sl_no}`) : null;
      const changes =
        before && after ? describeChanges(section.fields, pick(before), pick(after)) : null;
      // Three independent writes that follow the save — its audit line, the
      // notices, and any first targets the new dates give. None needs another,
      // so they run together; the save still waits for all three. None throws.
      await Promise.all([
        logAudit({
          actor: { id: user.id, email: user.email, role: user.role },
          action: "order.update",
          category: "activity",
          target: section.title,
          details: changes
            ? `Updated ${section.title} — ${changes}`
            : `Saved ${section.title} (no changes)`,
          subject: { orderId: id, soNo: label },
        }),
        before && after && label
          ? notifySectionSaved({
              orderId: id,
              orderLabel: label,
              table: tbl,
              actorRole: user.role,
              before: pick(before),
              after: pick(after),
            })
          : null,
        // Order details carry the dates the first targets are counted from.
        tbl === "orders" ? autoFillTargets(id, user) : null,
        tbl === "orders" && before && "clearance_status" in allowedValues
          ? notifyClearance(
              id,
              String(before.order.clearance_status ?? ""),
              allowedValues.clearance_status ?? "",
              allowedValues.clearance_hold_reason ?? String(before.order.clearance_hold_reason ?? "")
            )
          : null,
        // …and the value and currency its INR conversion is worked out from.
        tbl === "orders"
          ? getUsdInrRate().then((rate) => applyUsdConversion(id, rate))
          : null,
        // Whether the Sales Order details are now all in (Central hears the first time).
        tbl === "orders" ? markSoDetails(id, { id: user.id, role: user.role, name: user.full_name }) : null,
      ]);
      revalidatePath(`/risansi/orders/${id}`);
    } else {
      // Item-scope: id is the item_id.
      const before = await getItemDetail(id);
      const itemLock = lockReason(tbl, before?.order as never, user.role);
      if (itemLock) return { ok: false, error: itemLock };
      // A Spare's readiness lots ride along with Planning's form.
      let lots: ReadyLot[] | null = null;
      const lotsJson = allowedValues[READY_LOTS_FIELD];
      if (tbl === "order_planning" && typeof lotsJson === "string") {
        try {
          lots = lotsFromRows(JSON.parse(lotsJson));
        } catch {
          return { ok: false, error: "The readiness lots could not be read." };
        }
        const problem = lotsError(lots);
        if (problem) return { ok: false, error: problem };

      }
      // …and their packing dates ride along with Assembly & Packing's.
      let packing: { id: string; packed_date: string; packing_plan_date: string; packing_shift: string; pdi: string }[] | null = null;
      const packingJson = allowedValues[PACKING_LOTS_FIELD];
      if (tbl === "order_assembly_dispatch" && typeof packingJson === "string") {
        let sent: unknown;
        try {
          sent = JSON.parse(packingJson);
        } catch {
          return { ok: false, error: "The packing dates could not be read." };
        }
        // Checked against the lots as saved: only this EC's, each date on or
        // after the day its lot was ready.
        const saved = packingLotsFromRows(before?.order_ready_lots);
        const byId = new Map(packingLotsFromRows(sent).map((l) => [l.id, l]));
        const merged = saved.map((l) => {
          const s = byId.get(l.id);
          return s
            ? { ...l, packed_date: s.packed_date, packing_plan_date: s.packing_plan_date, packing_shift: s.packing_shift, pdi: s.pdi }
            : l;
        });
        const problem = packingError(merged);
        if (problem) return { ok: false, error: problem };
        packing = merged.map((l) => ({
          id: l.id,
          packed_date: l.packed_date,
          packing_plan_date: l.packing_plan_date,
          packing_shift: l.packing_shift,
          pdi: l.pdi,
        }));
      }
      if (lots && lots.length > 0) {
        delete allowedValues.actual_spare_status;
        delete allowedValues.planning_readiness_date;
      }
      await updateOrderSection(id, tbl, allowedValues);
      // A pump EC's status follows its Ready Qty.
      if (tbl === "order_planning") await syncPumpEcStatus(id);
      if (lots) {
        // A pump SO's lots name their ECs: this EC's share of each lot, and
        // never more of it than the EC has.
        const named = lots.some((l) => l.ecs);
        const withQty = lots.map((l) => ({ ...l, qty: l.ecs ? (l.ecs[id] ?? 0) : null }));
        if (named) {
          const total = withQty.reduce((n, l) => n + (l.qty ?? 0), 0);
          const qty = Number(before?.item?.quantity ?? 0) || 0;
          if (qty > 0 && total > qty) {
            return { ok: false, error: `EC ${before?.item?.ec_no ?? ""}: the lots hold ${total}, more than its quantity ${qty}.` };
          }
        }
        await saveReadyLots(id, withQty, { id: user.id, role: user.role });
        if (named) await syncReadyQtyFromLots(id);
      }
      if (packing) await saveLotPacking(id, packing, { id: user.id, role: user.role });
      const after = before ? await getItemDetail(id) : null;
      // Planning's status / readiness date on an EC without lots joins the
      // readiness history (the lots record their own changes).
      if (tbl === "order_planning" && before && after && !(lots && lots.length > 0)) {
        const read = (d: NonNullable<typeof before>) => {
          const pl = (d.order_planning ?? {}) as Record<string, unknown>;
          const s = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
          return {
            status: s(pl.actual_spare_status) ?? s(pl.actual_pump_status) ?? s(pl.planning_status),
            ready_date: s(pl.planning_readiness_date)?.slice(0, 10) ?? null,
          };
        };
        await logReadinessChange(id, read(before), read(after), { id: user.id, role: user.role });
      }
      const pick = (d: NonNullable<typeof before>) =>
        tbl === "order_items"
          ? d.item
          : ((d as Record<string, unknown>)[tbl] as Record<string, unknown> | null);
      const current = after ?? before;
      const soNo = current ? String(current.order.so_no ?? `#${current.order.sl_no}`) : null;
      const ecNo = current ? ((current.item.ec_no as string | null) ?? null) : null;
      const fieldChanges =
        before && after ? describeChanges(section.fields, pick(before), pick(after)) : null;
      // The lots, when they changed: "Lot 1 Partial ready 05-10-2026; Lot 2 …".
      const dmy = (d: string) => d.split("-").reverse().join("-");
      const lotText = (rows: unknown) =>
        packingLotsFromRows(rows)
          .map(
            (l, i) =>
              `Lot ${i + 1} ${l.status} ${dmy(l.ready_date)}${
                l.packing_plan_date ? ` · packing ${dmy(l.packing_plan_date)}${l.packing_shift ? ` ${l.packing_shift}` : ""}${l.pdi ? ` PDI ${l.pdi}` : ""}` : ""
              }${l.packed_date ? ` · packed ${dmy(l.packed_date)}` : ""}`
          )
          .join("; ") || "none";
      const lotsChange =
        (lots || packing) && before && after && lotText(before.order_ready_lots) !== lotText(after.order_ready_lots)
          ? `Readiness lots: ${lotText(after.order_ready_lots)}`
          : null;
      const changes = [fieldChanges, lotsChange].filter(Boolean).join("; ") || null;
      await logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "order.update",
        category: "activity",
        target: section.title,
        details: changes
          ? `Updated ${section.title} — ${changes}`
          : `Saved ${section.title} (no changes)`,
        subject: {
          orderId: current ? String(current.order.id) : null,
          itemId: id,
          soNo,
          ecNo,
        },
      });
      if (before && after && soNo) {
        await notifySectionSaved({
          orderId: String(before.order.id),
          itemId: id,
          orderLabel: `${soNo}${ecNo ? ` · ${ecNo}` : ""}`,
          table: tbl,
          actorRole: user.role,
          before: pick(before),
          after: pick(after),
        });
      }
      revalidatePath(`/risansi/orders/${String(before?.order.id ?? "")}/items/${id}`);
    }

    revalidatePath("/risansi/orders");
    return { ok: true };
  } catch (error) {
    console.error("updateOrderSection failed:", error);
    return { ok: false, error: "Could not save changes. Please try again." };
  }
}

/**
 * Planning / Assembly & Packing at SO level: one form, written to every EC of
 * the SO the department works on — each through the same per-EC save, so its
 * checks, locks, audit and notices are unchanged. A Spare's lots apply by
 * position (Lot 1, Lot 2…), packing dates likewise. An SO that mixes Pump and
 * Spare ECs is edited EC by EC, since their forms differ.
 */
export async function updateSectionForSoAction(
  orderId: string,
  table: string,
  values: Record<string, string>
): Promise<UpdateSectionResult> {
  if (table !== "order_planning" && table !== "order_assembly_dispatch") {
    return { ok: false, error: "This section is edited EC by EC." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, table as OrderTable)) {
    return { ok: false, error: "You don't have permission to edit this section." };
  }
  const ecs = await listSoEcsForSection(orderId, table as OrderTable);
  if (ecs.length === 0) return { ok: false, error: "This SO has no ECs to update." };
  if (new Set(ecs.map((e) => e.spare)).size > 1) {
    return { ok: false, error: "This SO has both Pump and Spare ECs — edit each EC on its own." };
  }
  // Packing dates arrive by position; each EC's own lot ids take them.
  let packed: ReturnType<typeof packingLotsFromRows> | null = null;
  if (typeof values[PACKING_LOTS_FIELD] === "string") {
    try {
      packed = packingLotsFromRows(JSON.parse(values[PACKING_LOTS_FIELD]));
    } catch {
      return { ok: false, error: "The packing dates could not be read." };
    }
  }
  for (const ec of ecs) {
    const v = packed
      ? {
          ...values,
          [PACKING_LOTS_FIELD]: JSON.stringify(
            ec.lot_ids.map((id, i) => ({
              id,
              packed_date: packed![i]?.packed_date ?? "",
              packing_plan_date: packed![i]?.packing_plan_date ?? "",
              packing_shift: packed![i]?.packing_shift ?? "",
              pdi: packed![i]?.pdi ?? "",
            }))
          ),
        }
      : values;
    const res = await updateOrderSectionAction(ec.id, table, v);
    if (!res.ok) return { ok: false, error: `${ec.ec_no ?? "An EC"}: ${res.error}` };
  }
  return { ok: true };
}

/**
 * Dispatch raises a dispatch — one invoice / challan card — for the packing
 * slips it chose on an SO (one or several). Each slip goes out once.
 */
export async function createDispatchAction(
  orderId: string,
  slipIds: string[]
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_invoices")) {
    return { ok: false, error: "Only Dispatch can raise a dispatch." };
  }
  const locked = lockReason("order_invoices", (await lockFactsForOrder(orderId)) as never, user.role);
  if (locked) return { ok: false, error: locked };
  try {
    const res = await createDispatchFromSlips(orderId, slipIds);
    if ("error" in res) return { ok: false, error: res.error };
    const label = (await getOrderLabel(orderId)) ?? orderId;
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: label,
      details: `Raised a dispatch for ${slipIds.length} packing slip(s) on ${label}`,
      subject: { orderId, soNo: label },
    });
    revalidatePath(`/risansi/orders/${orderId}`);
    revalidatePath("/risansi/departments/dispatch");
    return { ok: true, id: res.id };
  } catch (error) {
    console.error("createDispatch failed:", error);
    return { ok: false, error: "Could not raise the dispatch." };
  }
}

/**
 * An SO's readiness-lot history — Planning and Central only; Assembly &
 * Packing work from the latest lots and are not shown how they moved.
 */
export async function getReadyLotHistoryAction(
  orderId: string
): Promise<{ ok: true; events: ReadyLotEvent[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!(isCentral(user.role) || user.role === "planning")) {
    return { ok: false, error: "Only Planning and Central Visibility see the lot history." };
  }
  try {
    return { ok: true, events: await listReadyLotHistory(orderId) };
  } catch (error) {
    console.error("getReadyLotHistory failed:", error);
    return { ok: false, error: "Could not load the history." };
  }
}

/** One change to a Spare lot's packing plan (date, shift, PDI). */
export type PackingPlanEvent = {
  id: string;
  /** The EC, when the change was on one EC only; null when it was on several. */
  ec_no: string | null;
  /** How many of the SO's ECs the change was made on. */
  ecs: number;
  lot_no: number;
  plan_date: string | null;
  prev_plan_date: string | null;
  shift: string | null;
  prev_shift: string | null;
  pdi: string | null;
  prev_pdi: string | null;
  changed_by_name: string | null;
  changed_by_role: string | null;
  changed_at: string;
};

/** How an SO's packing plan moved — Assembly & Packing, Planning and Central. */
export async function getPackingPlanHistoryAction(
  orderId: string,
  // A pump lot's assembly plan is kept beside its packing plan.
  stage: string = "packing"
): Promise<{ ok: true; events: PackingPlanEvent[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!(isCentral(user.role) || user.role === "assembly" || user.role === "planning" || isReadOnlyViewer(user.role))) {
    return { ok: false, error: "You don't have access to the packing plan history." };
  }
  if (!UUID_RE_ACTION.test(orderId)) return { ok: false, error: "Order not found." };
  if (!(await repMaySee(user, orderId))) return { ok: false, error: "Order not found." };
  try {
    const r = await query<PackingPlanEvent>(
      // Assembly & Packing plans an SO as one, so the same change lands on
      // every EC within the same minute: it is shown once, with how many ECs.
      `SELECT (array_agg(h.id::text ORDER BY it.ec_no))[1] AS id,
              CASE WHEN count(*) = 1 THEN min(it.ec_no) END AS ec_no,
              count(*)::int AS ecs, h.lot_no,
              to_char(h.plan_date, 'YYYY-MM-DD') AS plan_date,
              to_char(h.prev_plan_date, 'YYYY-MM-DD') AS prev_plan_date,
              h.shift, h.prev_shift, h.pdi, h.prev_pdi,
              min(u.full_name) AS changed_by_name, h.changed_by_role,
              to_char(max(h.changed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS changed_at
         FROM order_packing_plan_history h
         JOIN order_items it ON it.id = h.item_id
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE it.order_id = $1 AND h.stage = $2
        GROUP BY h.lot_no, h.plan_date, h.prev_plan_date, h.shift, h.prev_shift, h.pdi, h.prev_pdi,
                 h.changed_by, h.changed_by_role, date_trunc('minute', h.changed_at)
        ORDER BY max(h.changed_at) DESC`,
      [orderId, stage === "assembly" ? "assembly" : "packing"]
    );
    return { ok: true, events: r.rows };
  } catch (error) {
    console.error("getPackingPlanHistory failed:", error);
    return { ok: false, error: "Could not load the history." };
  }
}

export type ChildActionResult =
  // `id` is set by addOrderChildAction, for a caller that fills the row it
  // just created rather than waiting for the list to render it.
  | { ok: true; id?: string }
  | { ok: false; error: string };

// Runtime allow-list for the `table` argument, which crosses a server-action
// boundary. Keep in sync with the ChildTable union — the `Record` type below
// makes a missing entry a compile error rather than a silent "Unknown list."
const CHILD_TABLES_SET: Record<ChildTable, true> = {
  order_payment_terms: true,
  order_lots: true,
  order_boi_items: true,
  order_billing_docs: true,
  order_packing_slips: true,
  order_invoices: true,
  order_drawing_revisions: true,
  order_ready_lots: true,
};
const CHILD_TABLES: readonly ChildTable[] = Object.keys(
  CHILD_TABLES_SET
) as ChildTable[];

function isChildTable(table: string): table is ChildTable {
  return (CHILD_TABLES as readonly string[]).includes(table);
}

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function guardChild(
  table: string
): Promise<{ ok: true; user: CurrentUser } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!isChildTable(table)) {
    return { ok: false, error: "Unknown list." };
  }
  if (!canEditChild(user.role, table)) {
    return { ok: false, error: "You don't have permission to edit this list." };
  }
  return { ok: true, user };
}

/** One audit line for a list row, on the SO / EC it belongs to. */
async function auditChild(
  user: CurrentUser,
  table: ChildTable,
  subject: Awaited<ReturnType<typeof subjectForChild>>,
  details: string
) {
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: childLabel(table, null),
    details,
    subject,
  });
}

export async function addOrderChildAction(
  orderId: string,
  table: string,
  // Packing slips only: 'tentative' (Planning) or 'actual' (Packing).
  kind?: string
): Promise<ChildActionResult> {
  const guard = await guardChild(table);
  if (!guard.ok) return guard;
  // No PI on an order that is paid after receipt — see lib/order-lock.
  const addLock = lockReason(
    table as ChildTable,
    // Per-EC lists pass the EC's id as orderId; their order is found from it.
    (await lockFactsForOrder(orderId)) ?? (await lockFactsForItem(orderId)),
    guard.user.role
  );
  if (addLock) return { ok: false, error: addLock };
  try {
    const created = await addChildRow(table as ChildTable, orderId, kind);
    if (!created && table === "order_ready_lots") {
      return { ok: false, error: "A Spare takes at most 3 readiness lots." };
    }
    // Once the row exists, its audit line and — for an actual packing slip —
    // its invoice add-on don't depend on each other, so they run together.
    // Both are awaited before the Add answers.
    await Promise.all([
      created
        ? subjectForChild(table as ChildTable, created.id).then((subject) =>
            auditChild(
              guard.user,
              table as ChildTable,
              subject,
              `Added a ${childLabel(table as ChildTable, null)} row`
            )
          )
        : null,
      // A new slip puts the SO in Dispatch's queue and can move its
      // dispatch status; Dispatch raises the dispatch itself from the slips.
      created && table === "order_packing_slips" && kind === "actual"
        ? packingSlipReady(created.id).then(() =>
            revalidatePath(`/risansi/orders/${orderId}`)
          )
        : null,
    ]);
    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true, id: created?.id };
  } catch (error) {
    console.error("addOrderChild failed:", error);
    return { ok: false, error: "Could not add the row." };
  }
}

export async function updateOrderChildAction(
  id: string,
  table: string,
  values: Record<string, string>,
  orderId: string
): Promise<ChildActionResult> {
  const guard = await guardChild(table);
  if (!guard.ok) return guard;
  const user = guard.user;
  const tbl = table as ChildTable;
  // Ignore any keys not in the child schema, and drop `centralOnly` fields
  // when the caller isn't Central Visibility — the UI renders those read-only,
  // but the action is a public endpoint so it must enforce it too.
  const allowed = new Set(
    CHILD_FIELDS[tbl]
      .filter((f) => !f.centralOnly || isCentral(user.role))
      .map((f) => f.column)
  );
  const clean = Object.fromEntries(
    Object.entries(values).filter(([k]) => allowed.has(k))
  );
  // For per-EC child tables (BOI items, packing slips) the `orderId` arg is
  // actually the item_id. The notification's order_id is a FK to orders(id),
  // so we must resolve the real SO id — otherwise the INSERT hits an FK
  // violation and the notification is silently dropped.
  const isPerEc =
    tbl === "order_boi_items" ||
    tbl === "order_drawing_revisions";

  // Everything read before the write, read together: none of these depends on
  // another, and the database is remote, so one wait instead of up to six.
  // The write itself still waits for all of them.
  let reads;
  try {
    reads = await Promise.all([
      lockFactsForChild(tbl, id),
      // For PIs: the pre-save pi_no, so Accounts is told only when it becomes
      // newly filled (empty → set), not on every later edit.
      tbl === "order_billing_docs"
        ? query<{ pi_no: string | null }>(
            `SELECT pi_no FROM order_billing_docs WHERE id = $1`,
            [id]
          )
        : null,
      // Actual packing slips: the pre-save kind, so we know whether to upsert
      // a linked invoice row afterwards — read before the update so a
      // packing_slip_no changed on the same save still gets its upsert.
      tbl === "order_packing_slips"
        ? query<{ kind: string | null }>(
            `SELECT kind FROM order_packing_slips WHERE id = $1`,
            [id]
          )
        : null,
      // Drawing revisions: the three hand-offs before the write, so we notify
      // only on the flip to Yes, not on every re-save of a row already Yes.
      tbl === "order_drawing_revisions" ? drawingHandoffs(id) : null,
      // What the row said before, and whose it is — so the audit line can say
      // what changed.
      childValues(tbl, id),
      subjectForChild(tbl, id),
      // The row's SO does not change on an update, so it can be read now.
      isPerEc ? getChildOrderId(tbl, id) : Promise.resolve(orderId),
    ]);
  } catch (error) {
    console.error("updateOrderChild failed:", error);
    return { ok: false, error: "Could not save the row." };
  }
  const [lockFacts, piBefore, slipMeta, drgBefore, rowBefore, subject, soOrderId] = reads;

  const rowLock = lockReason(tbl, lockFacts, user.role);
  if (rowLock) return { ok: false, error: rowLock };
  // A packing slip names the readiness lots it carries (Lot 1, Lot 2…).
  let slipLots: number[] | null = null;
  if (tbl === "order_packing_slips" && LOT_NOS_FIELD in values) {
    slipLots = parseLotNos(values[LOT_NOS_FIELD]);
    const facts = await query<{ max_lots: number; order_id: string | null }>(
      `SELECT ps.order_id,
              COALESCE((SELECT max(c) FROM (SELECT count(*)::int AS c FROM order_ready_lots rl
                                              JOIN order_items it ON it.id = rl.item_id
                                             WHERE it.order_id = ps.order_id GROUP BY rl.item_id) x), 0) AS max_lots
         FROM order_packing_slips ps WHERE ps.id = $1`,
      [id]
    );
    const maxLots = facts.rows[0]?.max_lots ?? 0;
    const bad = slipLots.find((n) => n > maxLots);
    if (bad) return { ok: false, error: `This SO has no Lot ${bad}.` };
    const slipNo = ("packing_slip_no" in clean ? clean.packing_slip_no : String(rowBefore?.packing_slip_no ?? "")).trim();
    if (maxLots > 0 && slipNo && slipLots.length === 0) {
      return { ok: false, error: "Tick the lot(s) this packing slip carries." };
    }
  }
  // The audit line, once the row is saved — kept outside the try so a failure
  // later in the save still waits for it before answering.
  let audited: Promise<void> | null = null;
  try {
    const piNoBefore: string | null = piBefore?.rows[0]?.pi_no ?? null;
    let actualSlipKind: "actual" | "tentative" | null = null;
    {
      const k = (slipMeta?.rows[0]?.kind ?? "").toLowerCase();
      if (k === "actual" || k === "tentative") actualSlipKind = k;
    }

    await updateChildRow(tbl, id, clean);
    if (slipLots) {
      await query(`UPDATE order_packing_slips SET lot_nos = $2 WHERE id = $1`, [id, slipLots.length ? slipLots : null]);
      // Which lots have gone out decides whether the SO is Fully dispatched.
      if (soOrderId) await recomputeDispatchStatus(soOrderId);
    }

    const rowAfter = await childValues(tbl, id);
    // A vendor's expected date keeps every change, as readiness dates do.
    if (tbl === "order_boi_items") {
      const day = (v: unknown) =>
        v instanceof Date ? v.toLocaleDateString("en-CA") : v == null ? "" : String(v).slice(0, 10);
      const prev = day(rowBefore?.expected_receipt_date);
      const next = day(rowAfter?.expected_receipt_date);
      if (prev !== next) {
        await query(
          `INSERT INTO order_boi_expected_history (boi_item_id, prev_date, new_date, changed_by, changed_by_role)
           VALUES ($1, NULLIF($2, '')::date, NULLIF($3, '')::date, $4, $5)`,
          [id, prev, next, user.id, user.role]
        );
      }
    }
    const changes = describeChanges(CHILD_FIELDS[tbl], rowBefore, rowAfter);
    // The audit line and the notices below are independent writes: the line
    // is started here and awaited once the notices are done, so the save waits
    // for both but not for one after the other. auditChild never throws.
    audited = auditChild(
      user,
      tbl,
      subject,
      changes
        ? `Updated ${childLabel(tbl, rowAfter)} — ${changes}`
        : `Saved ${childLabel(tbl, rowAfter)} (no changes)`
    );
    const notifyMuted = user.role === "central_visibility";

    if (tbl === "order_billing_docs") {
      const piNoAfter = (clean.pi_no ?? "").trim();
      const wasEmpty = !(piNoBefore ?? "").trim();
      if (wasEmpty && piNoAfter) {
        // Newly-filled PI number → tell Accounts + Central (skip Central if
        // Central is the one who saved — they already know).
        await notifyPiCreated(orderId, id, piNoAfter, user.role);
      }
    } else if (tbl === "order_packing_slips" && actualSlipKind === "actual") {
      // Actual packing slip saved → tell Dispatch + Central which slip is
      // ready; Dispatch raises the dispatch for it (alone or with others).
      const ctx = await packingSlipReady(id);
      const emitOrderId = soOrderId ?? ctx?.order_id ?? null;
      if (emitOrderId) {
        const soLabel = (await getOrderLabel(emitOrderId)) ?? emitOrderId;
        const ec = ctx?.ec_no ? ` · EC ${ctx.ec_no}` : "";
        const psn = ctx?.packing_slip_no ?? "";
        const qty = ctx?.quantity != null ? ` · Qty ${ctx.quantity}` : "";
        const detail = `${soLabel}${ec}${psn ? ` · Packing Slip ${psn}` : ""}${qty}`;
        // Packed and ready to invoice: that is Dispatch's work now.
        const dispatchRoles = ["dispatch"];
        // Only Mitali (central_visibility) herself is self-muted; admin acting
        // still notifies central_visibility (and admin's bell picks it up via
        // the admin → central_visibility recipient expansion).
        if (!notifyMuted) dispatchRoles.push("central_visibility");
        await emitNotification({
          roles: dispatchRoles,
          orderId: emitOrderId,
          type: "dept_update",
          message: `Packed and ready to dispatch — ${detail}`,
        });
      }
    } else if (tbl === "order_invoices") {
      // A dispatch recorded → Central Visibility, and Accounts, whose
      // receivable starts at the invoice.
      if (soOrderId) {
        const soLabel = (await getOrderLabel(soOrderId)) ?? soOrderId;
        const roles = ["accounts"];
        if (!notifyMuted) roles.push("central_visibility");
        await emitNotification({
          roles,
          orderId: soOrderId,
          type: "dept_update",
          message: `Dispatch updated for ${soLabel}`,
        });
      }
    } else if (tbl === "order_packing_slips" && actualSlipKind === "tentative") {
      // Tentative packing slip save (Planning) → Central Visibility.
      if (!notifyMuted && soOrderId) {
        const soLabel = (await getOrderLabel(soOrderId)) ?? soOrderId;
        await emitNotification({
          roles: ["central_visibility"],
          orderId: soOrderId,
          type: "dept_update",
          message: `Tentative packing details updated for ${soLabel}`,
        });
      }
    } else if (tbl === "order_drawing_revisions") {
      // Each hand-off tells whoever acts next: Drawing's issue to Operations
      // and to Production go up to Mitali (muted when she saves); her issue to
      // the client and the approval come back down to Drawing. A "No" reports
      // the same way a "Yes" does — see drawingHandoffEvents.
      const after = await drawingHandoffs(id);
      if (after && soOrderId) {
        const events = drawingHandoffEvents(drgBefore, after, notifyMuted);
        if (events.length > 0) {
          const soLabel = (await getOrderLabel(soOrderId)) ?? soOrderId;
          const detail = drawingHandoffDetail(soLabel, after);
          for (const event of events) {
            await emitNotification({
              roles: event.roles,
              orderId: soOrderId,
              // Per-EC child: this action's `orderId` arg is the item id, so the
              // bell can deep-link straight to the EC.
              itemId: orderId,
              type: "dept_update",
              message: `Drawing ${event.what} — ${detail}`,
            });
          }
        }
      }
    } else if (tbl === "order_payment_terms") {
      // A term being set — or changed — reaches the departments that work to
      // it; see paymentTermNotice.
      const notice = paymentTermNotice(rowAfter, notifyMuted);
      if (notice && soOrderId) {
        const soLabel = (await getOrderLabel(soOrderId)) ?? soOrderId;
        await emitNotification({
          roles: notice.roles,
          orderId: soOrderId,
          type: "payment_terms",
          message: `Payment term set for ${soLabel} — ${notice.detail}`,
        });
      }
    } else if (tbl === "order_boi_items") {
      // Purchase BOI item save → Central Visibility, and Planning: a bought-out
      // receipt date is what unblocks their schedule, so they need to hear it
      // without going looking.
      if (soOrderId) {
        const soLabel = (await getOrderLabel(soOrderId)) ?? soOrderId;
        const roles = ["planning"];
        if (!notifyMuted) roles.push("central_visibility");
        await emitNotification({
          roles,
          orderId: soOrderId,
          type: "dept_update",
          message: `Purchase BOI updated for ${soLabel}`,
        });
      }
    }
    // Refresh the parent SO detail page when the child is per-EC (its
    // `orderId` arg is the item_id), so Dispatch reflects any
    // invoice row we just upserted.
    if (isPerEc && soOrderId) {
      revalidatePath(`/risansi/orders/${soOrderId}`);
    }
    await audited;
    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("updateOrderChild failed:", error);
    // The row may already be saved: its audit line still goes in.
    await audited;
    return { ok: false, error: "Could not save the row." };
  }
}

/** Read one revision's hand-off state, before and after the write. */
async function drawingHandoffs(id: string): Promise<DrawingHandoffs | null> {
  const result = await query<DrawingHandoffs>(
    `SELECT rv.revision_no, rv.doc_type, it.ec_no, rv.issued_to_operations,
            rv.issued_to_operations_remarks, rv.issued_to_client, rv.approved,
            rv.issued_to_production
       FROM order_drawing_revisions rv
       JOIN order_items it ON it.id = rv.item_id
      WHERE rv.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/** An FR (replacement) order with blank Payment Terms Remarks gets "REPLACEMENT". */
async function markReplacementTerms(orderId: string): Promise<void> {
  await query(
    `UPDATE orders SET payment_terms_remarks = $2
      WHERE id = $1 AND bill_mode = 'FR' AND NULLIF(btrim(payment_terms_remarks), '') IS NULL`,
    [orderId, FR_PAYMENT_TERMS_REMARKS]
  );
}

/**
 * Fill the SO's first target dates from its own dates, where none has been
 * set (lib/target-rules.ts), and tell each department its date as if someone
 * had set it by hand. Never throws: a target that could not be filled is
 * still there to set by hand, and must not fail the save that prompted it.
 */
async function autoFillTargets(
  orderId: string,
  user: { id: string; email: string; role: string }
): Promise<void> {
  try {
    const filled = await fillFirstTargets(orderId, user);
    if (filled.length === 0) return;
    const label = (await getOrderLabel(orderId)) ?? orderId;
    for (const { target, date, reason } of filled) {
      await logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "order.target_date",
        category: "activity",
        target: label,
        details: `Set ${target.label} to ${formatTargetDate(date)} — ${reason}`,
        subject: { orderId, soNo: label },
      });
      const recipients = await targetRecipientsFor(target.column, orderId);
      if (recipients) {
        await emitNotification({
          roles: recipients.roles,
          orderId,
          type: "target_date",
          message: `${recipients.label} set for ${label} — ${formatTargetDate(date)} · ${reason}`,
        });
      }
    }
  } catch (error) {
    console.error("autoFillTargets failed:", error);
  }
}

/** The department roles, by the department they run — for telling them. */
/**
 * The SO was put on hold, or its hold lifted: every department with work on
 * it hears it (blank counts as Clear).
 */
async function notifyClearance(orderId: string, wasRaw: string, nowRaw: string, reason: string): Promise<void> {
  const was = wasRaw || "Clear";
  const now = nowRaw || "Clear";
  if (was === now || (now !== "Clear" && now !== "Hold")) return;
  try {
    const label = (await getOrderLabel(orderId)) ?? orderId;
    const depts = Object.keys(ROLE_BY_DEPT) as DeptKey[];
    const involved = (
      await Promise.all(depts.map((d) => deptInvolvedInOrder(d, orderId).then((yes) => (yes ? d : null))))
    ).filter((d): d is DeptKey => d !== null);
    if (involved.length === 0) return;
    await emitNotification({
      roles: involved.map((d) => ROLE_BY_DEPT[d]),
      orderId,
      type: "dept_update",
      message:
        now === "Hold"
          ? `SO ${label} put on hold by Central Visibility${reason.trim() ? ` — ${reason.trim()}` : ""}`
          : `Hold lifted on SO ${label} by Central Visibility`,
    });
  } catch (error) {
    console.error("notifyClearance failed:", error);
  }
}

/**
 * The Orders list's quick view of one SO: the SO with its sections and the
 * target dates' history — what its SO pop-ups (Order details, Dispatch, …)
 * show. Central Visibility and Admin.
 */
export async function getOrderQuickViewAction(orderId: string): Promise<
  | {
      ok: true;
      detail: OrderDetailData;
      targetRevisions: TargetRevision[];
    }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canViewAll(user.role)) return { ok: false, error: "Only Central Visibility and Admin see the quick view." };
  if (!(await repMaySee(user, orderId))) return { ok: false, error: "Order not found." };
  if (!UUID_RE_ACTION.test(orderId)) return { ok: false, error: "Order not found." };
  const [detail, targetRevisions] = await Promise.all([getOrderDetail(orderId), listTargetRevisions(orderId)]);
  if (!detail) return { ok: false, error: "Order not found." };
  return { ok: true, detail, targetRevisions };
}

/** Accounts' hold reasons, for its hold pop-up. */
export async function listAccountsHoldReasonsAction(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user || !canEditSection(user.role, "order_accounts")) return [];
  return listAccountsHoldReasons();
}

/** Accounts adds a hold reason to its list. */
export async function addAccountsHoldReasonAction(
  label: string
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_accounts")) return { ok: false, error: "Only Accounts can add hold reasons." };
  const clean = (label ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "Type the reason." };
  if (clean.length > 80) return { ok: false, error: "Keep the reason under 80 characters." };
  const saved = await addAccountsHoldReason(clean, user.email);
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "settings.update",
    category: "activity",
    target: "Accounts hold reasons",
    details: `Added hold reason "${saved}"`,
  });
  return { ok: true, label: saved };
}

/**
 * Accounts puts an SO on hold for a payment reason, or lifts it. Every
 * department working on the SO (and Central) hears of it; their work goes on.
 */
export async function setAccountsHoldAction(
  orderId: string,
  input: { status: string; reason: string; remarks: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_accounts")) return { ok: false, error: "Only Accounts can put an SO on hold." };
  if (!UUID_RE_ACTION.test(orderId)) return { ok: false, error: "Order not found." };
  const status = input.status === "Hold" ? "Hold" : "Clear";
  const reason = (input.reason ?? "").trim();
  const remarks = (input.remarks ?? "").trim();
  if (status === "Hold") {
    if (!reason) return { ok: false, error: "Choose a hold reason." };
    if (!(await listAccountsHoldReasons()).includes(reason)) return { ok: false, error: "Choose a reason from the list." };
  }
  if (remarks.length > 500) return { ok: false, error: "Keep the remarks under 500 characters." };
  const was = (await setAccountsHold(orderId, { status, reason, remarks })) || "Clear";
  const label = (await getOrderLabel(orderId)) ?? orderId;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: "Accounts",
    details: status === "Hold" ? `Accounts hold — ${reason}${remarks ? ` (${remarks})` : ""}` : `Accounts hold lifted${remarks ? ` — ${remarks}` : ""}`,
    subject: { orderId, soNo: label },
  });
  if (was !== status) {
    try {
      const depts = Object.keys(ROLE_BY_DEPT) as DeptKey[];
      const involved = (
        await Promise.all(depts.map((d) => deptInvolvedInOrder(d, orderId).then((yes) => (yes ? d : null))))
      ).filter((d): d is DeptKey => d !== null && d !== "accounts");
      await emitNotification({
        roles: [...new Set([...involved.map((d) => ROLE_BY_DEPT[d]), "central_visibility"])],
        orderId,
        type: "dept_update",
        message:
          status === "Hold"
            ? `SO ${label} put on hold by Accounts — ${reason}${remarks ? ` (${remarks})` : ""}`
            : `Accounts hold lifted on SO ${label}${remarks ? ` — ${remarks}` : ""}`,
      });
    } catch (error) {
      console.error("Accounts hold notice failed:", error);
    }
  }
  revalidatePath("/risansi/departments/accounts");
  revalidatePath(`/risansi/orders/${orderId}`);
  return { ok: true };
}

const ROLE_BY_DEPT: Record<DeptKey, string> = {
  drawing: "drawing",
  purchase: "purchase",
  quality: "qc",
  planning: "planning",
  assembly: "assembly",
  dispatch: "dispatch",
  billing: "operations",
  accounts: "accounts",
};

export type SetOrderStatusResult = { ok: true } | { ok: false; error: string };

/** The dispatch states Dispatch may set by hand. */
const DISPATCH_MANUAL_STATUSES = ["Pending", "LOT dispatch", "Fully dispatch", "Hold"];

/**
 * Central Visibility sets an order's status by hand: cancelled by the client,
 * diverted, or a dispatch state the invoices do not show. "auto" hands it back
 * to the invoices. Closing an order (cancel, divert) takes it off every
 * department's work and tells the departments that had work on it; reopening
 * tells them too. Nothing on the order is deleted.
 */
export async function setOrderStatusAction(
  orderId: string,
  status: string,
  reason: string,
  divertedTo: string
): Promise<SetOrderStatusResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const next = status === "auto" ? null : status;
  // Order Making PO may cancel an SO (its Cancel button); Dispatch may set
  // the dispatch state by hand (or hand it back to the invoices); the rest is
  // Central's.
  const omCancel = user.role === "order_making" && next === "Cancelled by client";
  const dispatchSet = user.role === "dispatch" && (next === null || DISPATCH_MANUAL_STATUSES.includes(next));
  if (!isCentral(user.role) && !omCancel && !dispatchSet) {
    return { ok: false, error: "Only Central Visibility or Admin can change an order's status." };
  }
  if (next !== null && !ORDER_STATUS_OPTIONS.some((o) => o.value === next)) {
    return { ok: false, error: "Unknown status." };
  }
  const why = reason.trim().slice(0, 1000) || null;
  // Hold says why, from Dispatch's list.
  if (next === "Hold" && !splitHoldReason(why).reason) {
    return { ok: false, error: "Choose why the dispatch is on hold." };
  }
  const closing = isClosedStatus(next);
  if (closing && !why) {
    return { ok: false, error: "Say why — a reason is needed to cancel or divert an order." };
  }

  try {
    const before = await getOrderStatusState(orderId);
    if (!before) return { ok: false, error: "Order not found." };
    const label = before.so_no ?? `#${before.sl_no}`;
    const wasClosed = isClosedStatus(before.status_override);
    // A cancelled or diverted order is Central's to reopen, not Dispatch's.
    if (dispatchSet && !isCentral(user.role) && wasClosed) {
      return { ok: false, error: "This order is cancelled or diverted — only Central Visibility can reopen it." };
    }

    // Who had work on it — read before closing it, since a closed order
    // counts for no department.
    const depts = (Object.keys(ROLE_BY_DEPT) as DeptKey[]);
    const involved = wasClosed === closing
      ? []
      : (await Promise.all(depts.map((d) => deptInvolvedInOrder(d, orderId).then((yes) => (yes ? d : null)))))
          .filter((d): d is DeptKey => d !== null);

    await setOrderStatus({
      orderId,
      status: next,
      reason: why,
      divertedTo: next === "Diverted" ? divertedTo.trim().slice(0, 300) || null : null,
      actorId: user.id,
    });

    const shownBefore = before.status_override ?? before.dispatch_status ?? "Pending";
    const shownAfter = next ?? `${before.dispatch_status ?? "Pending"} (from invoices)`;
    const follow: Promise<unknown>[] = [
      logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "order.update",
        category: "activity",
        target: label,
        details: `Order status: ${shownBefore} → ${shownAfter}${why ? ` — reason: ${why}` : ""}${
          next === "Diverted" && divertedTo.trim() ? ` — diverted to ${divertedTo.trim()}` : ""
        }`,
        subject: { orderId, soNo: label },
      }),
    ];
    if (involved.length > 0) {
      const roles = involved.map((d) => ROLE_BY_DEPT[d]);
      if (user.role !== "central_visibility") roles.push("central_visibility");
      follow.push(
        emitNotification({
          roles,
          orderId,
          type: "dept_update",
          message: closing
            ? `${label} ${next === "Diverted" ? "diverted" : "cancelled by the client"} — no further work on it${why ? ` · ${why}` : ""}`
            : `${label} reopened — back in your work${why ? ` · ${why}` : ""}`,
        })
      );
    }
    await Promise.all(follow);
    revalidatePath(`/risansi/orders/${orderId}`);
    revalidatePath("/risansi/orders");
    revalidatePath("/risansi/departments/dispatch");
    return { ok: true };
  } catch (error) {
    console.error("setOrderStatus failed:", error);
    return { ok: false, error: "Could not change the order status." };
  }
}

/**
 * Who hears about a target date on this order: the department that works to
 * it, unless the order carries no work for it — a Drawing target on an order
 * of Spares only tells nobody.
 */
async function targetRecipientsFor(
  column: string,
  orderId: string
): Promise<{ label: string; roles: string[] } | null> {
  const recipients = targetDateRecipients(column);
  if (!recipients) return null;
  if (column === "drg_target_date" && !(await deptInvolvedInOrder("drawing", orderId))) {
    return null;
  }
  return recipients;
}

/** Notify Accounts (and Central for oversight) when Billing files a new PI. */
async function notifyPiCreated(
  orderId: string,
  piId: string,
  piNo: string,
  actorRole: string
): Promise<void> {
  const detail = await getOrderDetail(orderId);
  const soLabel = detail
    ? String(detail.order.so_no ?? `#${detail.order.sl_no}`)
    : orderId;
  // Always tell Accounts; also tell Central Visibility (and by extension Admin,
  // via recipientRolesForUser) unless Mitali herself saved the PI. Admin
  // saves still notify central_visibility so admin's bell picks it up.
  const roles = ["accounts"];
  if (actorRole !== "central_visibility") roles.push("central_visibility");
  // itemId is intentionally null here: notifications.item_id is a FK to
  // order_items(id), and a PI id (order_billing_docs.id) would fail that
  // constraint. The PI goes in billingDocId instead, so the feed can show its
  // number and amount. Deep-link is by order_id — Accounts opens the SO detail.
  await emitNotification({
    roles,
    orderId,
    billingDocId: piId,
    type: "dept_update",
    message: `PI ${piNo} created for ${soLabel}`,
  });
}

const MAX_LR_BYTES = 8 * 1024 * 1024;

/** Attach (or replace) an invoice's LR document. Dispatch only. */
export async function uploadInvoiceLrAction(
  invoiceId: string,
  orderId: string,
  formData: FormData
): Promise<ChildActionResult> {
  const guard = await guardChild("order_invoices");
  if (!guard.ok) return guard;

  const file = formData.get("lr");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to attach." };
  }
  if (file.size > MAX_LR_BYTES) {
    return { ok: false, error: `"${file.name}" is larger than 8MB.` };
  }
  try {
    const data = Buffer.from(await file.arrayBuffer());
    await setInvoiceLrFile(invoiceId, {
      name: file.name,
      mimeType: file.type || null,
      size: file.size,
      data,
    });
    const [subject, row] = await Promise.all([
      subjectForChild("order_invoices", invoiceId),
      childValues("order_invoices", invoiceId),
    ]);
    await auditChild(
      guard.user,
      "order_invoices",
      subject,
      `Attached LR copy "${file.name}" to ${childLabel("order_invoices", row)}`
    );
    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("uploadInvoiceLr failed:", error);
    return { ok: false, error: "Could not attach the file. Please try again." };
  }
}

export async function deleteOrderChildAction(
  id: string,
  table: string,
  orderId: string
): Promise<ChildActionResult> {
  const guard = await guardChild(table);
  if (!guard.ok) return guard;
  try {
    const tbl = table as ChildTable;
    // Once it is gone there is nothing left to name it by.
    const [subject, row] = await Promise.all([
      subjectForChild(tbl, id),
      childValues(tbl, id),
    ]);
    await deleteChildRow(tbl, id);
    await auditChild(guard.user, tbl, subject, `Deleted ${childLabel(tbl, row)}`);
    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("deleteOrderChild failed:", error);
    return { ok: false, error: "Could not delete the row." };
  }
}

export type QcDocumentResult = { ok: true } | { ok: false; error: string };

const MAX_QC_FILE_BYTES = 8 * 1024 * 1024; // stay under the 10MB action body cap

const QC_DOC_TABLES: readonly QcDocTable[] = [
  "order_qc_documents",
  "order_qc_requirement_documents",
];

// The `table` argument crosses a Server Action boundary (a public POST
// endpoint), so re-validate it here even though the caller's TS type says
// it's already a QcDocTable.
function isQcDocTable(table: string): table is QcDocTable {
  return (QC_DOC_TABLES as readonly string[]).includes(table);
}

function canEditQcDocTable(table: QcDocTable, role: string): boolean {
  return table === "order_qc_documents"
    ? canEditQcDocuments(role)
    : canEditQcRequirementDocs(role);
}

const QC_DOC_TABLE_LABEL: Record<QcDocTable, string> = {
  order_qc_documents: "Quality",
  order_qc_requirement_documents: "Quality Requirement Docs",
};

export async function listQcDocumentsAction(
  table: QcDocTable,
  orderId: string
): Promise<QcDocumentMeta[]> {
  const user = await getCurrentUser();
  if (!user || !isQcDocTable(table)) return [];
  // Both document sets are viewable by anyone with QC section access.
  if (!canAccessDepartment(user.role, "order_qc")) return [];
  return listQcDocuments(table, orderId);
}

export async function uploadQcDocumentsAction(
  table: QcDocTable,
  orderId: string,
  formData: FormData
): Promise<QcDocumentResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!isQcDocTable(table)) {
    return { ok: false, error: "Unknown document set." };
  }
  if (!canEditQcDocTable(table, user.role)) {
    return { ok: false, error: "You don't have permission to attach documents here." };
  }

  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { ok: false, error: "Choose at least one file." };
  }
  const tooBig = files.find((f) => f.size > MAX_QC_FILE_BYTES);
  if (tooBig) {
    return { ok: false, error: `"${tooBig.name}" is larger than 8MB.` };
  }

  try {
    for (const file of files) {
      const data = Buffer.from(await file.arrayBuffer());
      await insertQcDocument(table, orderId, {
        name: file.name,
        mimeType: file.type || null,
        size: file.size,
        data,
      });
    }
    const label = QC_DOC_TABLE_LABEL[table];
    const names = files.map((f) => `"${f.name}"`).join(", ");
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: label,
      details: `Attached ${files.length} document${files.length === 1 ? "" : "s"} to ${label}: ${names}`,
      // The documents hang off the EC — this argument is its item id.
      subject: await subjectForItem(orderId),
    });
    revalidatePath("/risansi/departments/qc");
    return { ok: true };
  } catch (error) {
    console.error("uploadQcDocuments failed:", error);
    return { ok: false, error: "Could not upload the file(s). Please try again." };
  }
}

export async function deleteQcDocumentAction(
  table: QcDocTable,
  id: string
): Promise<QcDocumentResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!isQcDocTable(table)) {
    return { ok: false, error: "Unknown document set." };
  }
  if (!canEditQcDocTable(table, user.role)) {
    return { ok: false, error: "You don't have permission to delete documents here." };
  }
  try {
    const { subject, fileName } = await qcDocumentSubject(table, id);
    await deleteQcDocument(table, id);
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: QC_DOC_TABLE_LABEL[table],
      details: `Deleted ${fileName ? `"${fileName}"` : "a document"} from ${QC_DOC_TABLE_LABEL[table]}`,
      subject,
    });
    revalidatePath("/risansi/departments/qc");
    return { ok: true };
  } catch (error) {
    console.error("deleteQcDocument failed:", error);
    return { ok: false, error: "Could not delete the file. Please try again." };
  }
}


export type BoiItemsResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

/**
 * The bought-out items on one EC, read-only.
 *
 * Planning needs these to schedule around a pending receipt, so the read is
 * open to Planning and Purchase (its owner) plus Central Visibility — but it
 * is a read only: the rows themselves are written through the Purchase
 * workspace, under its own permission checks.
 */
export async function boiItemsAction(itemId: string): Promise<BoiItemsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  const allowed =
    isCentral(user.role) ||
    canManageEcs(user.role) ||
    canEditSection(user.role, "order_planning") ||
    canEditSection(user.role, "order_purchase");
  if (!allowed) {
    return { ok: false, error: "You don't have access to bought-out items." };
  }

  try {
    const result = await query<Record<string, unknown>>(
      `SELECT id, boi_item, boi_item_other, boi_make, boi_qty, boi_description,
              to_char(expected_receipt_date, 'YYYY-MM-DD') AS expected_receipt_date,
              to_char(receipt_date, 'YYYY-MM-DD') AS receipt_date, remarks
         FROM order_boi_items
        WHERE item_id = $1
        ORDER BY created_at`,
      [itemId]
    );
    return { ok: true, rows: result.rows };
  } catch (error) {
    console.error("boiItemsAction failed:", error);
    return { ok: false, error: "Could not load the bought-out items." };
  }
}


/**
 * An existing EC's bought-out items as the EC form leaves them: rows with
 * an id are changed in place (the item, make, qty, description — Purchase's
 * figures on them stay), rows without one are added, and saved rows left out
 * are removed. Each row filled in full; BOI Yes keeps at least one. Those who
 * manage ECs only (an Order Making SO member on their own SOs); Purchase is told.
 */
export async function saveEcBoiItemsAction(
  itemId: string,
  rows: (Record<string, unknown> & { id?: string | null })[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  const ec = await getItemDetail(itemId);
  if (!ec) return { ok: false, error: "EC not found." };
  const orderId = String(ec.order.id);
  const denied = await ecDenied(user, orderId);
  if (denied) return { ok: false, error: denied };
  const boiYes = String(ec.item.boi ?? "") === "Yes";

  // Each row checked as the form checks it; its id kept beside it.
  const clean: { id: string | null; row: NewBoiItem }[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const one = cleanBoiRows([r]);
    if (!one.ok) return { ok: false, error: one.error };
    if (one.rows[0]) clean.push({ id: r.id ? String(r.id) : null, row: one.rows[0] });
  }
  if (!boiYes && clean.length > 0) {
    return { ok: false, error: "This EC's BOI is not set to Yes, so it cannot list bought-out items." };
  }
  if (boiYes && clean.length === 0) return { ok: false, error: "BOI is Yes: add the bought-out items." };

  const saved = await query<{ id: string; boi_item: string | null; boi_item_other: string | null; boi_make: string | null; boi_qty: number | null; boi_description: string | null }>(
    `SELECT id, boi_item, boi_item_other, boi_make, boi_qty, boi_description FROM order_boi_items WHERE item_id = $1`,
    [itemId]
  );
  const byId = new Map(saved.rows.map((r) => [r.id, r]));
  const keep = new Set(clean.map((c) => c.id).filter((x): x is string => !!x && byId.has(x)));
  const removed = saved.rows.filter((r) => !keep.has(r.id));
  const added: NewBoiItem[] = [];
  const changed: NewBoiItem[] = [];
  const nameOf = (r: { boi_item?: string | null; boi_item_other?: string | null }) =>
    r.boi_item === "Others" ? r.boi_item_other || "Others" : r.boi_item || "Item";
  try {
    await withTransaction(async (client) => {
      if (removed.length) {
        await client.query(`DELETE FROM order_boi_items WHERE item_id = $1 AND id = ANY($2::uuid[])`, [itemId, removed.map((r) => r.id)]);
      }
      for (const { id, row } of clean) {
        const was = id ? byId.get(id) : undefined;
        const vals = [row.boi_item, row.boi_item_other || null, row.boi_make || null, row.boi_qty ?? null, row.boi_description || null];
        if (was) {
          const same =
            (was.boi_item ?? "") === row.boi_item &&
            (was.boi_item_other ?? "") === (row.boi_item_other ?? "") &&
            (was.boi_make ?? "") === (row.boi_make ?? "") &&
            Number(was.boi_qty ?? NaN) === Number(row.boi_qty ?? NaN) &&
            (was.boi_description ?? "") === (row.boi_description ?? "");
          if (same) continue;
          await client.query(
            `UPDATE order_boi_items SET boi_item = $2, boi_item_other = $3, boi_make = $4, boi_qty = $5, boi_description = $6
              WHERE id = $1 AND item_id = $7`,
            [was.id, ...vals, itemId]
          );
          changed.push(row);
        } else {
          await client.query(
            `INSERT INTO order_boi_items (item_id, boi_item, boi_item_other, boi_make, boi_qty, boi_description)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [itemId, ...vals]
          );
          added.push(row);
        }
      }
    });
  } catch (error) {
    console.error("saveEcBoiItemsAction failed:", error);
    return { ok: false, error: "Could not save the bought-out items." };
  }
  if (!added.length && !changed.length && !removed.length) return { ok: true };

  const soLabel = String(ec.order.so_no ?? `#${ec.order.sl_no}`);
  const ecLabel = String(ec.item.ec_no ?? "").trim();
  const label = ecLabel ? `${soLabel} · ${ecLabel}` : soLabel;
  const parts = [
    added.length ? `added ${added.map(nameOf).join(", ")}` : "",
    changed.length ? `changed ${changed.map(nameOf).join(", ")}` : "",
    removed.length ? `removed ${removed.map(nameOf).join(", ")}` : "",
  ].filter(Boolean);
  const roles = ["purchase"];
  if (user.role !== "central_visibility") roles.push("central_visibility");
  await Promise.all([
    logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: label,
      details: `Bought-out items on ${ecLabel || "the EC"}: ${parts.join("; ")}`,
      subject: { orderId, itemId, soNo: soLabel, ecNo: ecLabel || null },
    }),
    emitNotification({
      roles,
      orderId,
      itemId,
      type: "dept_update",
      message: `Bought-out items updated — ${label} · ${parts.join("; ")}`,
    }),
  ]);
  revalidatePath(`/risansi/orders/${orderId}`);
  return { ok: true };
}

const MAX_PI_XLSX_BYTES = 5 * 1024 * 1024;

export type ImportPiResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

/**
 * Upload a PI Excel to auto-fill an SO's Operation card. Only rows that parse
 * cleanly are inserted; rows with errors are counted as skipped and reported.
 * Same permission as adding a PI by hand (Billing & Operations).
 */
export async function importPiExcelAction(
  orderId: string,
  formData: FormData
): Promise<ImportPiResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_billing_docs")) {
    return { ok: false, error: "You don't have permission to add PIs." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an .xlsx file to upload." };
  }
  if (file.size > MAX_PI_XLSX_BYTES) {
    return { ok: false, error: "That file is larger than 5 MB." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "Only .xlsx files can be uploaded." };
  }

  const importLock = lockReason(
    "order_billing_docs",
    await lockFactsForOrder(orderId),
    user.role
  );
  if (importLock) return { ok: false, error: importLock };

  try {
    const parsed = await parsePiWorkbook(Buffer.from(await file.arrayBuffer()));
    if (parsed.missingPiNo) {
      return {
        ok: false,
        error: "No PI No. column found. Expected columns: PI No., PI Date, PI Value.",
      };
    }
    const good = parsed.rows.filter((r) => r.errors.length === 0);
    if (good.length === 0) {
      return { ok: false, error: "No valid PI rows found in that sheet." };
    }
    const created = await insertBillingDocs(
      orderId,
      good.map((r) => ({ pi_no: r.pi_no, pi_date: r.pi_date, pi_value: r.pi_value }))
    );
    const inserted = created.length;
    // Each imported PI tells Accounts, exactly as one typed in by hand does —
    // one notification per PI, so each carries its own number and amount.
    for (const pi of created) {
      if ((pi.pi_no ?? "").trim()) {
        await notifyPiCreated(orderId, pi.id, pi.pi_no.trim(), user.role);
      }
    }
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.update",
      category: "activity",
      target: "PI",
      details: `Imported ${inserted} PI${inserted === 1 ? "" : "s"} from "${file.name}": ${good
        .map((r) => r.pi_no)
        .filter(Boolean)
        .slice(0, 10)
        .join(", ")}`,
      subject: await subjectForOrder(orderId),
    });
    revalidatePath(`/risansi/orders/${orderId}`);
    revalidatePath("/risansi/departments/billing");
    return { ok: true, inserted, skipped: parsed.rows.length - good.length };
  } catch (error) {
    console.error("importPiExcelAction failed:", error);
    return { ok: false, error: "Could not read that workbook." };
  }
}

// ---------------------------------------------------------------------------
// Target date history
// ---------------------------------------------------------------------------

/** Dates read better in a notification than the ISO the input produces. */
function formatTargetDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export type TargetRevisionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Move one of the SO's target dates, keeping the old value as history.
 *
 * Targets are Central Visibility's to set (departments read them), so the
 * guard matches the Order details section rather than the department that
 * works to the date.
 */
export async function addTargetRevisionAction(
  orderId: string,
  targetKey: string,
  date: string,
  reason: string
): Promise<TargetRevisionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "orders")) {
    return { ok: false, error: "You don't have permission to set target dates." };
  }
  if (!isTargetKey(targetKey)) {
    return { ok: false, error: "Unknown target date." };
  }
  // A date is the whole point of the row, so it is the one required field.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Choose a date." };
  }

  const target = TARGET_BY_KEY.get(targetKey)!;
  const trimmedReason = reason.trim() || null;
  try {
    const { seq } = await addTargetRevision({
      orderId,
      target,
      date,
      reason: trimmedReason,
      actorId: user.id,
      actorRole: user.role,
    });

    // Two reads the audit line and the notice need; neither needs the other.
    const [orderLabel, recipients] = await Promise.all([
      getOrderLabel(orderId),
      targetRecipientsFor(target.column, orderId),
    ]);
    const label = orderLabel ?? orderId;
    const audited = logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.target_date",
      category: "activity",
      target: label,
      details:
        (seq === 1
          ? `Set ${target.label} to ${formatTargetDate(date)}`
          : `Revised ${target.label} to ${formatTargetDate(date)} (revision ${seq - 1})`) +
        (trimmedReason ? ` — reason: ${trimmedReason}` : ""),
      subject: { orderId, soNo: label },
    });

    // The department working to this date has to hear it — both when it is
    // first set and every time it moves, since a revision changes their
    // deadline as much as the original did. The reason rides along: "moved to
    // the 19th" is far less useful than knowing why.
    // Target dates used to notify through notifySectionSaved; they are no
    // longer written by a section save, so the emit happens here instead.
    // The audit line (started above) and the notice go out together; the
    // save waits for both. Neither throws.
    const when = formatTargetDate(date);
    const why = trimmedReason ? ` · ${trimmedReason}` : "";
    await Promise.all([
      audited,
      recipients
        ? emitNotification({
            roles: recipients.roles,
            orderId,
            type: "target_date",
            message:
              seq === 1
                ? `${recipients.label} set for ${label} — ${when}${why}`
                : `${recipients.label} revised for ${label} — ${when}${why}`,
          })
        : null,
    ]);

    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("addTargetRevision failed:", error);
    return { ok: false, error: "Could not save the target date." };
  }
}

/**
 * Undo the most recent value of a target date. Only the latest is removable —
 * rewriting the middle of a history is what makes a history worthless.
 */
export async function deleteTargetRevisionAction(
  orderId: string,
  targetKey: string
): Promise<TargetRevisionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "orders")) {
    return { ok: false, error: "You don't have permission to set target dates." };
  }
  if (!isTargetKey(targetKey)) {
    return { ok: false, error: "Unknown target date." };
  }

  const target = TARGET_BY_KEY.get(targetKey)!;
  try {
    const { removed, now } = await deleteLatestTargetRevision(orderId, target);
    if (removed === null) {
      return { ok: false, error: "There is nothing to remove." };
    }

    const label = (await getOrderLabel(orderId)) ?? orderId;
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.target_date",
      category: "activity",
      target: label,
      details: now
        ? `Removed ${target.label} ${removed}, back to ${now}`
        : `Cleared ${target.label} (was ${removed})`,
      subject: { orderId, soNo: label },
    });

    // Same reasoning as setting one: the department is working to this date,
    // so being told it was withdrawn matters as much as being told it moved.
    const recipients = await targetRecipientsFor(target.column, orderId);
    if (recipients) {
      await emitNotification({
        roles: recipients.roles,
        orderId,
        type: "target_date",
        message: now
          ? `${recipients.label} reverted for ${label} — ${formatTargetDate(now)}`
          : `${recipients.label} cleared for ${label}`,
      });
    }

    revalidatePath(`/risansi/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("deleteTargetRevision failed:", error);
    return { ok: false, error: "Could not remove the target date." };
  }
}

/**
 * The change history of one target date, for the read-only view departments
 * get in their queue. Any signed-in user may read it: the date is already
 * shown to them, and why it moved is the part they actually need.
 *
 * Loaded on demand rather than joined into every queue page — most rows are
 * never opened, and a target rarely has more than a couple of entries.
 */
export async function getTargetHistoryAction(
  orderId: string,
  targetKey: string
): Promise<TargetRevision[]> {
  const user = await getCurrentUser();
  if (!user || !isTargetKey(targetKey)) return [];
  const all = await listTargetRevisions(orderId);
  return all.filter((r) => r.target_key === targetKey);
}

// ---------------------------------------------------------------------------
// Department completion
// ---------------------------------------------------------------------------

export type DeptCompleteResult =
  | { ok: true; completion: DeptCompletion | null }
  | { ok: false; error: string };

/** Section table each department signs off through, for the permission check. */
const DEPT_SECTION: Record<DeptKey, OrderTable> = {
  drawing: "order_drawing",
  purchase: "order_purchase",
  quality: "order_qc",
  planning: "order_planning",
  assembly: "order_assembly_dispatch",
  billing: "order_billing",
  accounts: "order_accounts",
  // The invoice cards are Dispatch's own section now.
  dispatch: "order_dispatch",
};

/**
 * Tick or untick a department's sign-off. `scopeId` is the EC's item id for the
 * per-EC departments and the SO's order id for the rest.
 *
 * Whoever may edit the department's own section may sign it off — the same rule
 * that governs every other write it makes — and Central Visibility can too.
 */
export async function setDeptCompleteAction(
  scopeId: string,
  dept: string,
  complete: boolean
): Promise<DeptCompleteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!(DEPT_FILTER_KEYS as readonly string[]).includes(dept)) {
    return { ok: false, error: "Unknown department." };
  }
  const key = dept as DeptKey;
  if (!canEditSection(user.role, DEPT_SECTION[key])) {
    return {
      ok: false,
      error: "You don't have permission to complete this department.",
    };
  }

  try {
    if (!complete) {
      const orderId = await uncompleteDept(scopeId, key);
      if (!orderId) return { ok: false, error: "Nothing to undo." };
      const subject =
        scopeId === orderId ? await subjectForOrder(orderId) : await subjectForItem(scopeId);
      await logAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "order.dept_complete",
        category: "activity",
        target: subject.soNo ?? orderId,
        details: `Reopened ${DEPT_LABELS[key]}`,
        subject,
      });
      revalidatePath(`/risansi/orders/${orderId}`);
      return { ok: true, completion: null };
    }

    const completion = await completeDept({
      scopeId,
      dept: key,
      actorId: user.id,
      actorRole: user.role,
    });
    if (!completion) return { ok: false, error: "Could not find that record." };

    const label = (await getOrderLabel(completion.order_id)) ?? completion.order_id;
    const took = describeDays(completion.days_taken);
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "order.dept_complete",
      category: "activity",
      target: label,
      details: `Completed ${DEPT_LABELS[key]}${took ? ` — ${took}` : ""}`,
      subject: completion.item_id
        ? await subjectForItem(completion.item_id)
        : { orderId: completion.order_id, soNo: label },
    });

    // Central Visibility tracks the pipeline, so a department finishing is
    // exactly the kind of event they should not have to go looking for.
    if (user.role !== "central_visibility") {
      await emitNotification({
        roles: ["central_visibility"],
        orderId: completion.order_id,
        itemId: completion.item_id,
        type: "dept_update",
        message: `${DEPT_LABELS[key]} completed for ${label}${took ? ` — ${took}` : ""}`,
      });
    }

    revalidatePath(`/risansi/orders/${completion.order_id}`);
    return { ok: true, completion };
  } catch (error) {
    console.error("setDeptComplete failed:", error);
    return { ok: false, error: "Could not save. Please try again." };
  }
}

/**
 * Whether a payment term line can take this PI: it is one of the SO's own
 * lines, and no other PI is raised against it (a line takes one PI). Null
 * when it can, else why not.
 */
async function termTakesPi(orderId: string, termId: string, piId: string | null): Promise<string | null> {
  const r = await query<{ order_id: string; taken: boolean; after_receipt: boolean }>(
    `SELECT t.order_id, btrim(coalesce(t.term, '')) = 'After Receipt' AS after_receipt,
            EXISTS (SELECT 1 FROM order_billing_docs d
                     WHERE d.payment_term_id = t.id AND ($2::uuid IS NULL OR d.id <> $2::uuid)) AS taken
       FROM order_payment_terms t WHERE t.id = $1`,
    [termId, piId]
  );
  const row = r.rows[0];
  if (!row || row.order_id !== orderId) return "That payment term is not on this SO.";
  // Paid after receipt: there is nothing to raise a PI for.
  if (row.after_receipt) return "An After Receipt term has no PI.";
  if (row.taken) return "That payment term already has a PI.";
  return null;
}

/**
 * Billing raises or edits a PI against one of the SO's payment term lines
 * (or, on an SO with no terms yet, on its own). A new PI is created through
 * the list's own add and save, so its guards, audit line and notice to
 * Accounts are the same as ever; the link to the term is set alongside.
 */
export async function savePiAction(
  orderId: string,
  input: { piId?: string | null; termId?: string | null; pi_no: string; pi_date: string; pi_value: string }
): Promise<ChildActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_billing_docs")) {
    return { ok: false, error: "Only Proforma Invoice can raise PIs." };
  }
  if (!UUID_RE_ACTION.test(orderId)) return { ok: false, error: "Order not found." };
  const termId = input.termId && UUID_RE_ACTION.test(input.termId) ? input.termId : null;
  const piId = input.piId && UUID_RE_ACTION.test(input.piId) ? input.piId : null;
  if (!(input.pi_no ?? "").trim()) return { ok: false, error: "Enter the PI No." };
  // A new PI is raised against a payment term; an SO without terms has none to raise.
  if (!piId && !termId) return { ok: false, error: "Raise the PI against a payment term." };
  if (termId) {
    const problem = await termTakesPi(orderId, termId, piId);
    if (problem) return { ok: false, error: problem };
  }
  let id = piId;
  if (!id) {
    const made = await addOrderChildAction(orderId, "order_billing_docs");
    if (!made.ok) return made;
    id = made.id ?? null;
    if (!id) return { ok: false, error: "Could not raise the PI." };
  }
  if (termId) {
    await query(`UPDATE order_billing_docs SET payment_term_id = $2 WHERE id = $1 AND order_id = $3`, [id, termId, orderId]);
  }
  const saved = await updateOrderChildAction(
    id,
    "order_billing_docs",
    { pi_no: input.pi_no, pi_date: input.pi_date, pi_value: input.pi_value },
    orderId
  );
  if (termId) await moveTermPaymentToPi(orderId, termId, id);
  revalidatePath("/risansi/departments/billing");
  return saved.ok ? { ok: true, id } : saved;
}

/** Billing attaches a PI to a payment term line, or takes it off one (null). */
export async function linkPiAction(
  orderId: string,
  piId: string,
  termId: string | null
): Promise<ChildActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditChild(user.role, "order_billing_docs")) {
    return { ok: false, error: "Only Proforma Invoice can link PIs." };
  }
  if (!UUID_RE_ACTION.test(orderId) || !UUID_RE_ACTION.test(piId)) return { ok: false, error: "PI not found." };
  if (termId) {
    if (!UUID_RE_ACTION.test(termId)) return { ok: false, error: "Payment term not found." };
    const problem = await termTakesPi(orderId, termId, piId);
    if (problem) return { ok: false, error: problem };
  }
  const r = await query(
    `UPDATE order_billing_docs SET payment_term_id = $3 WHERE id = $1 AND order_id = $2`,
    [piId, orderId, termId]
  );
  if (r.rowCount === 0) return { ok: false, error: "PI not found." };
  if (termId) await moveTermPaymentToPi(orderId, termId, piId);
  const label = (await getOrderLabel(orderId)) ?? orderId;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: label,
    details: termId ? "Linked a PI to a payment term" : "Unlinked a PI from its payment term",
    subject: { orderId, soNo: label },
  });
  revalidatePath("/risansi/departments/billing");
  return { ok: true };
}

const UUID_RE_ACTION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Rep may read only their own SOs, a Rep Manager their team's too; anyone else is not limited here. */
async function repMaySee(user: { role: string; rep_names?: string[] }, orderId: string): Promise<boolean> {
  if (!isRep(user.role)) return true;
  return repMatches(await getOrderRep(orderId), user.rep_names);
}

/** The SO's Accounts fields that, once it has a PI, come from its PIs. */
const PI_ROLLED_UP = ["payment_status", "payment_confirmed_date", "amount_received", "hold_reason"];

/**
 * Accounts records the payment against one PI — or, when the term line has no
 * PI yet, against the term line; the SO's Accounts row follows.
 */
export async function savePiPaymentAction(
  orderId: string,
  target: { piId?: string | null; termId?: string | null },
  input: { payment_status: string; confirmed_date: string; amount_received: string; hold_reason: string }
): Promise<ChildActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canEditSection(user.role, "order_accounts")) {
    return { ok: false, error: "Only Accounts can record payments." };
  }
  const piId = target.piId && UUID_RE_ACTION.test(target.piId) ? target.piId : null;
  const termId = !piId && target.termId && UUID_RE_ACTION.test(target.termId) ? target.termId : null;
  if (!UUID_RE_ACTION.test(orderId) || (!piId && !termId)) return { ok: false, error: "Payment line not found." };
  const status = (input.payment_status ?? "").trim();
  if (status && !PAYMENT_STATUS_OPTIONS.some((o) => o.value === status)) {
    return { ok: false, error: "Choose a payment status from the list." };
  }
  const date = (input.confirmed_date ?? "").trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Enter a valid date." };
  const amount = (input.amount_received ?? "").trim();
  if (amount && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) {
    return { ok: false, error: "Amount Received must be a number, 0 or more." };
  }
  if (status === PAYMENT_HOLD_VALUE && !(input.hold_reason ?? "").trim()) {
    return { ok: false, error: "Enter the hold reason." };
  }
  const locked = lockReason("order_accounts", (await lockFactsForOrder(orderId)) as never, user.role);
  if (locked) return { ok: false, error: locked };

  const line = (
    await query<{ name: string | null; status: string | null; amount: string | null }>(
      piId
        ? `SELECT 'PI ' || COALESCE(pi_no, '—') AS name, pi_payment_status AS status, pi_amount_received::text AS amount
             FROM order_billing_docs WHERE id = $1 AND order_id = $2`
        : `SELECT concat_ws(' ', rtrim(rtrim(percent::text, '0'), '.') || '%', term) AS name,
                  term_payment_status AS status, term_amount_received::text AS amount
             FROM order_payment_terms WHERE id = $1 AND order_id = $2`,
      [piId ?? termId, orderId]
    )
  ).rows[0];
  if (!line) return { ok: false, error: "Payment line not found." };
  const payment = { payment_status: status, confirmed_date: date, amount_received: amount, hold_reason: input.hold_reason ?? "" };
  const saved = piId ? await savePiPayment(orderId, piId, payment) : await saveTermPayment(orderId, termId!, payment);
  if (!saved) return { ok: false, error: "This term now has a PI — record the payment on the PI." };
  const label = (await getOrderLabel(orderId)) ?? orderId;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: "Accounts",
    details: `${line.name ?? "—"}: payment ${line.status ?? "—"} → ${status || "—"}, received ${line.amount ?? "—"} → ${amount || "—"}`,
    subject: { orderId, soNo: label },
  });
  revalidatePath("/risansi/departments/accounts");
  return { ok: true };
}
