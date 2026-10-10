import 'server-only';
import { headers } from 'next/headers';
import risansiPool from './db-risansi';

/** Best-effort client IP + user-agent from the current request headers. */
async function reqMeta(): Promise<{ ip: string | null; ua: string | null }> {
  try {
    const h = await headers();
    const fwd = h.get('x-forwarded-for');
    const ip = (fwd ? fwd.split(',')[0].trim() : null) || h.get('x-real-ip') || null;
    const ua = h.get('user-agent');
    return { ip, ua: ua || null };
  } catch {
    return { ip: null, ua: null };
  }
}

export interface AuditInput {
  action: string;                          // create | update | delete | submit | assign | export | ...
  entityType?: string | null;
  entityId?: string | number | null;
  entityLabel?: string | null;
  summary?: string | null;
  metadata?: unknown;
  actorEmail?: string | null;              // override; otherwise read from session
  actorRole?: string | null;
}

/**
 * Record a general action into audit_log. Resolves the actor from the session
 * when not supplied, and captures IP / user-agent. Never throws — auditing must
 * never break the action it records.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    let actorEmail = input.actorEmail ?? null;
    let actorRole = input.actorRole ?? null;

    if (!actorEmail) {
      // Dynamic import avoids a circular dependency (the auth route imports this file).
      const [{ getServerSession }, { authOptions }] = await Promise.all([
        import('next-auth/next'),
        import('@/app/api/auth/[...nextauth]/route'),
      ]);
      const session = await getServerSession(authOptions);
      actorEmail = session?.user?.email ?? null;
      actorRole  = (session?.user?.role as string | undefined) ?? null;
    }

    // Backfill role from the users table when an email was supplied without one.
    if (actorEmail && !actorRole) {
      try {
        const r = await risansiPool.query<{ role: string }>(
          'SELECT role FROM users WHERE lower(email) = lower($1) LIMIT 1', [actorEmail]);
        actorRole = r.rows[0]?.role ?? null;
      } catch { /* non-critical */ }
    }

    const { ip, ua } = await reqMeta();
    await risansiPool.query(
      `INSERT INTO audit_log
         (actor_email, actor_role, action, entity_type, entity_id, entity_label, summary, metadata, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        actorEmail, actorRole, input.action,
        input.entityType ?? null,
        input.entityId != null ? String(input.entityId) : null,
        input.entityLabel ?? null, input.summary ?? null,
        input.metadata != null ? JSON.stringify(input.metadata) : null,
        ip, ua,
      ],
    );
  } catch (err) {
    console.error('recordAudit failed:', err);
  }
}

export interface AuthAuditInput {
  event: 'login' | 'logout' | 'login_failed' | 'password_changed';
  email?: string | null;
  userId?: number | null;
  role?: string | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Record an authentication event into auth_audit. Callers (the NextAuth
 * authorize/signOut hooks) usually pass ip/userAgent explicitly because the
 * next/headers() context may be unavailable there; falls back to reqMeta().
 */
export async function recordAuth(input: AuthAuditInput): Promise<void> {
  try {
    let ip = input.ip ?? null;
    let ua = input.userAgent ?? null;
    if (ip == null && ua == null) {
      const m = await reqMeta();
      ip = m.ip; ua = m.ua;
    }
    await risansiPool.query(
      `INSERT INTO auth_audit (event, email, user_id, role, ip, user_agent, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.event, input.email ?? null, input.userId ?? null, input.role ?? null, ip, ua, input.reason ?? null],
    );
  } catch (err) {
    console.error('recordAuth failed:', err);
  }
}
