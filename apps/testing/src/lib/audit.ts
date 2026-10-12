/**
 * Shared helper for writing to audit_logs -- called from every route that
 * changes data (or logs in/out), never awaited in a way that can block or
 * fail the actual request; a logging hiccup should never break a real
 * action. See schema.ts for the table shape and the Audit Log admin page
 * for how these get read back.
 */
import { db } from "./db";
import { auditLogs } from "./db/schema";

export type AuditEventType = "login" | "login_failed" | "logout" | "create" | "update" | "delete";
export type AuditEntityType = "requisition" | "report" | "attachment" | "user" | "bug_report" | "calendar_event";

export interface AuditParams {
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  eventType: AuditEventType;
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  entityLabel?: string | null;
  details?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Best-effort client IP off a Next.js Request. Vercel (and most proxies)
 * set x-forwarded-for as "client, proxy1, proxy2..." -- the first entry is
 * the original client. x-real-ip is a one-value fallback some setups use
 * instead. Returns null rather than the proxy's own address when neither
 * header is present, rather than guessing. */
export function getClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return null;
}

/** Raw User-Agent header, capped so a hostile client can't bloat the table. */
export function getUserAgent(req: Request): string | null {
  return req.headers.get("user-agent")?.slice(0, 400) || null;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: params.userId ?? null,
      userName: params.userName ?? null,
      userEmail: params.userEmail ?? null,
      eventType: params.eventType,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      entityLabel: params.entityLabel ?? null,
      details: params.details ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (err) {
    // Never let an audit-log write take down the real request it's
    // describing -- just surface it server-side for visibility.
    console.error("logAudit failed:", err);
  }
}
