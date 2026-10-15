import { query } from "@/lib/db";
import {
  offsetFor,
  pageResult,
  pageWithTotal,
  type PageResult,
} from "@/lib/pagination";
import { SECTION_BY_TABLE, type OrderTable } from "@/lib/order-schema";

type Row = Record<string, unknown> | null;

export type NotificationType =
  | "payment_terms"
  | "target_date"
  | "dept_update"
  // A bug the recipient reported changed status (addressed to them alone).
  | "bug_status"
  // No longer emitted — department saves are all reported as "dept_update"
  // now. Kept so notifications already stored still render.
  | "dept_complete";

export type NotificationRow = {
  id: string;
  order_id: string | null;
  item_id: string | null;
  type: NotificationType;
  message: string;
  created_at: string;
  /**
   * The order and money behind the notification, read when the feed is
   * loaded — so a value corrected or filled in later shows as it is now.
   */
  so_no: string | null;
  client_name: string | null;
  order_value: string | null;
  order_currency: string | null;
  /** The PI this notification is about, when it is about one. */
  pi_no: string | null;
  pi_value: string | null;
  /** Otherwise, the order's PIs so far: their numbers and their total. */
  order_pi_nos: string | null;
  order_pi_total: string | null;
  order_pi_count: number;
  /** A personal notification about a bug report: the report it concerns. */
  bug_report_id: string | null;
};

// ---------------------------------------------------------------------------
// Recipient targeting
// ---------------------------------------------------------------------------

/**
 * Which recipient_role values a user should see. Admin also sees the Central
 * Visibility feed (department-completion events); everyone else sees only
 * notifications addressed to their own role.
 */
export function recipientRolesForUser(role: string): string[] {
  if (role === "admin") return ["admin", "central_visibility"];
  // Order Making SO hears only what is addressed to the member themselves —
  // the SOs assigned to them.
  if (role === "order_making_so") return [];
  // A Rep Manager hears what is addressed to Reps — limited, by REP_SCOPE, to
  // the SOs of their own and their team.
  if (role === "rep_manager") return ["rep"];
  return [role];
}

/**
 * Every Rep shares the "rep" role, so a notification to it is shown only to
 * the Rep whose SO it is — or a Rep Manager over them. `param` is their rep
 * names, lower-cased and trimmed (repScopeParam); NULL — everyone else — no
 * limit.
 */
const REP_SCOPE = (n: string, param: string) =>
  `(${param}::text[] IS NULL OR EXISTS (SELECT 1 FROM orders ro WHERE ro.id = ${n}.order_id
     AND lower(btrim(COALESCE(ro.reps, ''))) = ANY(${param}::text[])))`;

/** A reader's rep names as REP_SCOPE compares them, or null for no limit. */
function repScopeParam(repNames: readonly string[] | null): string[] | null {
  return repNames ? repNames.map((n) => n.trim().toLowerCase()) : null;
}

// ---------------------------------------------------------------------------
// Reads (for the bell)
// ---------------------------------------------------------------------------

/** Notifications and escalations show this many per page. */
export const FEED_PAGE_SIZE = 25;

/**
 * One page of a user's notifications, newest first. Replaces a fixed "latest
 * 30", which left everything older unreachable.
 */
export async function listNotificationsPage(
  roles: string[],
  page: number,
  /** The reader: their own notifications come alongside their role's. */
  userId: string | null = null,
  /** A Rep or Rep Manager: their role's notifications only for these reps' SOs. */
  repNames: readonly string[] | null = null
): Promise<PageResult<NotificationRow>> {
  if (roles.length === 0 && !userId) return pageResult([], 0, 1, FEED_PAGE_SIZE);
  return pageWithTotal(
    page,
    (p) =>
      query<NotificationRow & { total_count: string }>(
        `SELECT n.id, n.order_id, n.item_id, n.type, n.message,
                to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                o.so_no, o.client_name,
                o.order_value::text AS order_value, o.order_currency,
                b.pi_no, b.pi_value::text AS pi_value,
                pis.nos AS order_pi_nos, pis.total::text AS order_pi_total,
                COALESCE(pis.count, 0)::int AS order_pi_count,
                n.bug_report_id,
                count(*) OVER ()::text AS total_count
           FROM notifications n
           LEFT JOIN orders o ON o.id = n.order_id
           LEFT JOIN order_billing_docs b ON b.id = n.billing_doc_id
           LEFT JOIN LATERAL (
             SELECT string_agg(d.pi_no, ', ' ORDER BY d.seq) AS nos,
                    sum(d.pi_value) AS total,
                    count(*) AS count
               FROM order_billing_docs d
              WHERE d.order_id = n.order_id
                AND nullif(btrim(d.pi_no), '') IS NOT NULL
           ) pis ON n.billing_doc_id IS NULL
          WHERE (n.recipient_role = ANY($1) AND ${REP_SCOPE("n", "$5")}) OR n.recipient_user_id = $4
          ORDER BY n.created_at DESC
          LIMIT $2 OFFSET $3`,
        [roles, FEED_PAGE_SIZE, offsetFor(p, FEED_PAGE_SIZE), userId, repScopeParam(repNames)]
      ),
    async () => {
      const r = await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications n
          WHERE (n.recipient_role = ANY($1) AND ${REP_SCOPE("n", "$3")}) OR n.recipient_user_id = $2`,
        [roles, userId, repScopeParam(repNames)]
      );
      return Number(r.rows[0]?.count ?? 0);
    },
    FEED_PAGE_SIZE
  );
}

export async function countUnread(
  roles: string[],
  seenAt: string | null,
  userId: string | null = null,
  repNames: readonly string[] | null = null
): Promise<number> {
  if (roles.length === 0 && !userId) return 0;
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM notifications n
      WHERE ((n.recipient_role = ANY($1) AND ${REP_SCOPE("n", "$4")}) OR n.recipient_user_id = $3)
        AND ($2::timestamptz IS NULL OR n.created_at > $2)`,
    [roles, seenAt, userId, repScopeParam(repNames)]
  );
  return Number(result.rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

/**
 * Emit an ad-hoc notification (for events outside notifySectionSaved's
 * section-save flow, e.g. Billing creating a PI). Never throws.
 */
export async function emitNotification(input: {
  roles: string[];
  orderId: string;
  itemId?: string | null;
  /** The PI it is about, so the feed can show that PI's number and amount. */
  billingDocId?: string | null;
  type: NotificationType;
  message: string;
}): Promise<void> {
  try {
    await emit(input.roles, {
      orderId: input.orderId,
      itemId: input.itemId ?? null,
      billingDocId: input.billingDocId ?? null,
      type: input.type,
      message: input.message,
    });
  } catch (error) {
    // Preserve the original error text so causes (e.g. FK violation on
    // notifications.item_id, connection lost) show up in the server log
    // instead of being reduced to "[object Object]".
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `emitNotification failed (roles=${input.roles.join(",")} type=${input.type}):`,
      msg
    );
  }
}

/**
 * A notification for one person rather than a department — about something
 * they did themselves, like a bug they reported. Never throws.
 */
export async function emitToUser(input: {
  userId: string;
  type: NotificationType;
  message: string;
  bugReportId?: string | null;
  /** The SO it is about, so the feed links to it. */
  orderId?: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO notifications (recipient_user_id, type, message, bug_report_id, order_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.type, input.message, input.bugReportId ?? null, input.orderId ?? null]
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`emitToUser failed (type=${input.type}):`, msg);
  }
}

/** Insert one notification row per recipient role. */
async function emit(
  roles: string[],
  input: {
    orderId: string;
    itemId?: string | null;
    billingDocId?: string | null;
    type: NotificationType;
    message: string;
  }
): Promise<void> {
  let unique = [...new Set(roles)];
  if (unique.length === 0) return;
  // An SO Central Visibility has not yet cleared or held is no department's
  // business: only Central, Admin and Order Making hear about it.
  const cleared = await query<{ clear: boolean }>(
    // Held by Order Making or by Central Visibility, it is forwarded to no one.
    `SELECT COALESCE(NULLIF(clearance_status, ''), 'Clear') = 'Clear'
            AND COALESCE(NULLIF(om_status, ''), 'Clear') <> 'Hold' AS clear
       FROM orders WHERE id = $1`,
    [input.orderId]
  );
  if (cleared.rows[0] && !cleared.rows[0].clear) {
    unique = unique.filter((r) => r === "central_visibility" || r === "admin" || r === "order_making");
    if (unique.length === 0) return;
  }
  const n = unique.length;
  // One INSERT with a row per role; the shared columns are the last 5 params.
  const values = unique
    .map(
      (_, i) =>
        `($${i + 1}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5})`
    )
    .join(", ");
  await query(
    `INSERT INTO notifications
       (recipient_role, order_id, item_id, billing_doc_id, type, message)
     VALUES ${values}`,
    [
      ...unique,
      input.orderId,
      input.itemId ?? null,
      input.billingDocId ?? null,
      input.type,
      input.message,
    ]
  );
}

/** True when any field in the section actually differs after the save. */
function sectionChanged(table: OrderTable, before: Row, after: Row): boolean {
  const norm = (row: Row, col: string) => {
    const v = row?.[col];
    return v === null || v === undefined ? "" : String(v).trim();
  };
  const fields = SECTION_BY_TABLE.get(table)?.fields ?? [];
  return fields.some((f) => norm(before, f.column) !== norm(after, f.column));
}

// A target-date column → the departments that should be told it's now set.
// Drawing/QC/Dispatch/Planning target dates live on the SO (orders); Purchase
// target is per-EC (order_planning); Dispatch team target is per-EC too.
const TARGET_DATE_RECIPIENTS: Partial<
  Record<OrderTable, { column: string; label: string; roles: string[] }[]>
> = {
  orders: [
    { column: "drg_target_date", label: "Drawing target date", roles: ["drawing"] },
    // The date Dispatch works to, and the one Planning schedules to, so it
    // goes to both. Assembly & Packing has its own, further down.
    {
      column: "dispatch_target_date",
      label: "Dispatch target date",
      roles: ["dispatch", "planning"],
    },
    // A revision matters just as much to both as the original date.
    {
      column: "dispatch_target_revised_date",
      label: "Revised dispatch target date",
      roles: ["dispatch", "planning"],
    },
    {
      column: "qc_doc_target_date",
      label: "Quality target date",
      roles: ["qc"],
    },
    {
      column: "purchase_target_date",
      label: "Purchase target date",
      roles: ["purchase"],
    },
    {
      column: "dispatch_team_target_date",
      label: "Packing team target date",
      roles: ["assembly"],
    },
  ],
  // Planning schedules the assembly; Assembly & Packing is the team that has
  // to be there for it, and sees the date read-only in their workspace.
  order_planning: [
    {
      column: "assembly_date",
      label: "Assembly date",
      roles: ["assembly"],
    },
  ],
};

/**
 * Emit any notifications triggered by a section being saved:
 *  - payment terms filled → Billing & Operations + Accounts
 *  - a target date newly set → the department that works to it
 *  - ANY department edit → Central Visibility (flagged as "completed" when the
 *    save is what finished that department's work)
 *
 * Field triggers fire only on an empty→filled transition, and the Central
 * Visibility notice only when a field actually changed, so re-saving an
 * unchanged section is silent. Central's own edits don't notify Central.
 * Never throws — notification failures must not break the save.
 */
export async function notifySectionSaved(params: {
  orderId: string;
  itemId?: string | null;
  orderLabel: string;
  table: OrderTable;
  actorRole: string;
  before: Row;
  after: Row;
}): Promise<void> {
  const { orderId, itemId = null, orderLabel, table, actorRole, before, after } =
    params;
  try {
    const val = (row: Row, col: string) => {
      const v = row?.[col];
      return v === null || v === undefined ? "" : String(v).trim();
    };
    // Fires when a trigger field ends up with a value it didn't have before —
    // so both first-time entry and a later revision notify, while re-saving an
    // unchanged field stays silent. On order creation `before` is null, so
    // anything filled in on the create form notifies too.
    const setOrChanged = (col: string) => {
      const now = val(after, col);
      return now !== "" && now !== val(before, col);
    };

    // Payment terms → Billing & Operations + Accounts (SO-level).
    if (table === "orders" && setOrChanged("payment_terms")) {
      await emit(["operations", "accounts"], {
        orderId,
        type: "payment_terms",
        message: `Payment terms set for ${orderLabel}`,
      });
    }

    // Target dates → the departments that work to them (per EC).
    for (const t of TARGET_DATE_RECIPIENTS[table] ?? []) {
      if (setOrChanged(t.column)) {
        await emit(t.roles, {
          orderId,
          itemId,
          type: "target_date",
          message: `${t.label} set for ${orderLabel}`,
        });
      }
    }

    // Any department edit → Central Visibility, reported uniformly as an
    // update. Only Mitali (central_visibility) herself is self-muted; admin
    // saves still notify central_visibility so admin's bell picks it up.
    if (actorRole !== "central_visibility" && sectionChanged(table, before, after)) {
      const dept = SECTION_BY_TABLE.get(table)?.title ?? "A department";
      await emit(["central_visibility"], {
        orderId,
        itemId,
        type: "dept_update",
        message: `${dept} updated ${orderLabel}`,
      });
    }
  } catch (error) {
    console.error("notifySectionSaved failed:", error);
  }
}

// ---------------------------------------------------------------------------
// Drawing revisions
// ---------------------------------------------------------------------------

/** The hand-offs on one drawing revision, plus what it belongs to. */
export type DrawingHandoffs = {
  revision_no: string | null;
  ec_no: string | null;
  issued_to_operations: string | null;
  issued_to_operations_remarks: string | null;
  issued_to_client: string | null;
  approved: string | null;
  issued_to_production: string | null;
};

export type DrawingHandoffEvent = { roles: string[]; what: string };

/** Normalised Yes / No, or "" while the hand-off is still unanswered. */
function answer(value: string | null | undefined): "Yes" | "No" | "" {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "";
}

/**
 * Which notifications a drawing-revision save earns. Each hand-off tells the
 * side that acts next:
 *
 *   - Issued to Operations (Drawing) → Central Visibility, who issue it to the
 *     client. Drawing's remarks ride along.
 *   - Issued to Client, Approved (Central Visibility) → Drawing, who are
 *     waiting on both: approval is what unblocks issuing to production.
 *   - Issued to Production (Drawing) → Central Visibility.
 *
 * Mitali is muted on the hand-offs she makes herself.
 *
 * "No" notifies exactly like "Yes": a drawing that comes back *not* approved is
 * the answer Drawing most needs — it means rework — and a hand-off flipped back
 * to No is equally a change of state. What stays silent is a save that didn't
 * change the answer, or one that leaves it blank. Applies to every revision
 * row, not just the first issue.
 */
export function drawingHandoffEvents(
  before: DrawingHandoffs | null,
  after: DrawingHandoffs,
  actorIsCentral: boolean
): DrawingHandoffEvent[] {
  const answered = (col: keyof DrawingHandoffs) => {
    const now = answer(after[col]);
    return now !== "" && now !== answer(before?.[col]) ? now : null;
  };
  const phrase = (verdict: "Yes" | "No", what: string) =>
    verdict === "Yes" ? what : `not ${what}`;

  const events: DrawingHandoffEvent[] = [];

  const operations = answered("issued_to_operations");
  if (operations && !actorIsCentral) {
    const remarks = (after.issued_to_operations_remarks ?? "").trim();
    events.push({
      roles: ["central_visibility"],
      what: `${phrase(operations, "issued to Operations")}${remarks ? ` (remarks: ${remarks})` : ""}`,
    });
  }

  const client = answered("issued_to_client");
  if (client) {
    events.push({ roles: ["drawing"], what: phrase(client, "issued to Client") });
  }

  const approved = answered("approved");
  if (approved) {
    events.push({ roles: ["drawing"], what: phrase(approved, "approved") });
  }

  const production = answered("issued_to_production");
  if (production && !actorIsCentral) {
    events.push({
      roles: ["central_visibility"],
      what: phrase(production, "issued to Production"),
    });
  }

  return events;
}

/** "SO26/1/999 · EC 123TEST · Rev. 2" — the first issue has no number. */
export function drawingHandoffDetail(
  soLabel: string,
  after: DrawingHandoffs
): string {
  const rev = (after.revision_no ?? "").trim();
  return `${soLabel} · EC ${after.ec_no ?? "—"} · ${
    rev ? `Rev. ${rev}` : "first issue"
  }`;
}

/**
 * Who hears about a target date, by its column on `orders`.
 *
 * Target dates are no longer written through notifySectionSaved — they have
 * their own revision flow — but the recipients are the same, so both read this
 * one map rather than keeping two lists in step.
 */
/**
 * A payment term that has just been set. The two departments that chase and
 * record the money work to these terms, so both hear it; Central Visibility
 * hears it unless they are the one who typed it.
 *
 * The term itself is the message — "40% Before Dispatch" is the whole point —
 * and a row with no term yet is not a term, so it says nothing.
 */
export function paymentTermNotice(
  row: { term?: unknown; percent?: unknown; days?: unknown } | null,
  actorIsCentral: boolean
): { roles: string[]; detail: string } | null {
  const text = (v: unknown) => String(v ?? "").trim();
  const term = text(row?.term);
  const percent = text(row?.percent);
  const days = text(row?.days);
  if (!term) return null;
  const roles = ["accounts", "operations"];
  if (!actorIsCentral) roles.push("central_visibility");
  return {
    roles,
    detail: [percent ? `${Number(percent)}%` : null, term, days ? `${days} days` : null]
      .filter(Boolean)
      .join(" "),
  };
}

export function targetDateRecipients(
  column: string
): { label: string; roles: string[] } | null {
  const match = (TARGET_DATE_RECIPIENTS.orders ?? []).find(
    (t) => t.column === column
  );
  return match ? { label: match.label, roles: match.roles } : null;
}
