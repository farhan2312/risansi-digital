'use server';

// Saving, sharing and running a report.
//
// Every action here authenticates first, and every one that touches a
// particular report re-checks who is asking against that row - ownership is
// never inferred from what the client sent. A 'use server' module may export
// nothing but async functions, so the types, the caps and the sanitiser all
// live in lib/custom-analytics/.
//
// The rule that matters most: runReportVisual builds its scope from the
// CALLER, so a shared report shows the reader their own numbers. Nothing in
// here ever runs a query as the report's owner.

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole, type CurrentUser } from '@/lib/risansi-auth';
import { pushInApp } from '@/lib/risansi-inapp';
import { recordAudit } from '@/lib/audit';
import { runVisual, type CrossFilter, type RunOpts, type RunResult } from '@/lib/custom-analytics/engine';
import { buildScope } from '@/lib/custom-analytics/scope';
import { sanitizeDoc, emptyDoc, cloneDoc } from '@/lib/custom-analytics/doc';
import { templateByKey } from '@/lib/custom-analytics/templates';
import type { ReportDoc, PageFilters, Visual } from '@/lib/custom-analytics/types';

export interface ReportSummary {
  id: number;
  title: string;
  description: string | null;
  ownerId: number;
  ownerName: string | null;
  updatedAt: string;
  shareCount?: number;
  pinned?: boolean;
}

export interface ReportFull extends ReportSummary {
  doc: ReportDoc;
  /** Only for the owner. */
  shares?: { userId: number; name: string | null }[];
  canEdit: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const no = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The pin is one report per person, kept beside the other settings. */
const pinKey = (userId: number) => `report.pin:${userId}`;

/**
 * Who may create a report.
 *
 * rep and above. The three narrow roles - staff, viewer, registry - can open
 * a report shared with them and take a copy of nothing: they own no accounts,
 * so a report of their own would be empty under their own scope anyway.
 */
function mayBuild(user: CurrentUser): boolean {
  return !!user.email && hasRole(user.role, 'rep');
}

/** Everyone signed in may READ a report shared with them. */
function maySee(user: CurrentUser): boolean {
  return !!user.email && !!user.id;
}

export async function listMyReports(): Promise<Result<ReportSummary[]>> {
  const user = await getCurrentUser();
  if (!maySee(user)) return no('Please sign in.');
  const { rows } = await risansiPool.query(
    `SELECT r.id, r.title, r.description, r.owner_id, u.name AS owner_name,
            r.updated_at::text AS updated_at,
            (SELECT count(*)::int FROM custom_report_shares s WHERE s.report_id = r.id) AS share_count
       FROM custom_reports r
       LEFT JOIN users u ON u.id = r.owner_id
      WHERE r.owner_id = $1
      ORDER BY r.updated_at DESC`,
    [user.id]);
  const pinned = await currentPin(user.id!);
  return { ok: true, data: rows.map(r => row(r, pinned)) };
}

export async function listSharedReports(): Promise<Result<ReportSummary[]>> {
  const user = await getCurrentUser();
  if (!maySee(user)) return no('Please sign in.');
  const { rows } = await risansiPool.query(
    `SELECT r.id, r.title, r.description, r.owner_id, u.name AS owner_name,
            r.updated_at::text AS updated_at
       FROM custom_report_shares s
       JOIN custom_reports r ON r.id = s.report_id
       LEFT JOIN users u ON u.id = r.owner_id
      WHERE s.user_id = $1
      ORDER BY r.updated_at DESC`,
    [user.id]);
  const pinned = await currentPin(user.id!);
  return { ok: true, data: rows.map(r => row(r, pinned)) };
}

function row(r: Record<string, unknown>, pinned: number | null): ReportSummary {
  return {
    id: Number(r.id),
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    ownerId: Number(r.owner_id),
    ownerName: (r.owner_name as string | null) ?? null,
    updatedAt: String(r.updated_at),
    shareCount: r.share_count == null ? undefined : Number(r.share_count),
    pinned: Number(r.id) === pinned ? true : undefined,
  };
}

async function currentPin(userId: number): Promise<number | null> {
  const { rows } = await risansiPool.query(
    `SELECT value FROM app_settings WHERE key = $1`, [pinKey(userId)]);
  const n = Number(rows[0]?.value);
  return Number.isInteger(n) ? n : null;
}

export async function getReport(id: number): Promise<Result<ReportFull>> {
  const user = await getCurrentUser();
  if (!maySee(user)) return no('Please sign in.');
  if (!Number.isInteger(id)) return no('Unknown report.');

  // Owner or a named recipient. No implicit admin read: an admin is not
  // automatically entitled to somebody else's saved work.
  const { rows } = await risansiPool.query(
    `SELECT r.id, r.title, r.description, r.owner_id, r.doc,
            u.name AS owner_name, r.updated_at::text AS updated_at
       FROM custom_reports r
       LEFT JOIN users u ON u.id = r.owner_id
      WHERE r.id = $1
        AND (r.owner_id = $2
             OR EXISTS (SELECT 1 FROM custom_report_shares s
                         WHERE s.report_id = r.id AND s.user_id = $2))`,
    [id, user.id]);
  const r = rows[0];
  if (!r) return no('That report does not exist, or it has not been shared with you.');

  const canEdit = Number(r.owner_id) === user.id;
  const out: ReportFull = {
    ...row(r, await currentPin(user.id!)),
    doc: sanitizeDoc(r.doc),
    canEdit,
  };
  if (canEdit) {
    const { rows: sh } = await risansiPool.query(
      `SELECT s.user_id, u.name FROM custom_report_shares s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.report_id = $1 ORDER BY u.name`, [id]);
    out.shares = sh.map(x => ({ userId: Number(x.user_id), name: (x.name as string | null) ?? null }));
  }
  return { ok: true, data: out };
}

export async function saveReport(input: {
  id?: number; title: string; description?: string; doc: unknown;
}): Promise<Result<{ id: number }>> {
  const user = await getCurrentUser();
  if (!mayBuild(user)) return no('You do not have access to build reports.');

  const title = String(input?.title ?? '').trim().slice(0, 120) || 'Untitled report';
  const description = String(input?.description ?? '').trim().slice(0, 500) || null;
  const doc = sanitizeDoc(input?.doc);

  if (input?.id != null) {
    if (!Number.isInteger(input.id)) return no('Unknown report.');
    // owner_id in the WHERE, not checked in JS: a non-owner updates 0 rows.
    const { rowCount } = await risansiPool.query(
      `UPDATE custom_reports
          SET title = $1, description = $2, doc = $3, updated_at = now()
        WHERE id = $4 AND owner_id = $5`,
      [title, description, JSON.stringify(doc), input.id, user.id]);
    if (!rowCount) return no('You can only change a report you own.');
    await recordAudit({ entityType: 'custom_report', entityId: input.id, action: 'update',
      summary: `Saved report "${title}"`, actorEmail: user.email!, actorRole: user.role });
    revalidatePath('/risansi/reports');
    return { ok: true, data: { id: input.id } };
  }

  const { rows } = await risansiPool.query(
    `INSERT INTO custom_reports (owner_id, title, description, doc)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.id, title, description, JSON.stringify(doc)]);
  const id = Number(rows[0].id);
  await recordAudit({ entityType: 'custom_report', entityId: id, action: 'create',
    summary: `Created report "${title}"`, actorEmail: user.email!, actorRole: user.role });
  revalidatePath('/risansi/reports');
  return { ok: true, data: { id } };
}

export async function createReport(title = 'Untitled report'): Promise<Result<{ id: number }>> {
  // Read before passing on. Returning another action's result untouched
  // looks like handling it and is not: nothing here would notice a refusal.
  const saved = await saveReport({ title, doc: emptyDoc() });
  return saved.ok ? saved : no(saved.error);
}

/**
 * A report of the reader's own, started from one of the four templates.
 *
 * A copy, not a link: nothing about the result points back at the template,
 * so editing it later cannot be confused with editing a shared report, and a
 * template changed in a future release does not rewrite anybody's saved work.
 */
export async function createFromTemplate(key: string): Promise<Result<{ id: number }>> {
  const user = await getCurrentUser();
  if (!mayBuild(user)) return no('You do not have access to build reports.');
  const t = templateByKey(String(key ?? ''));
  if (!t) return no('That template does not exist.');
  const saved = await saveReport({
    title: t.title, description: t.description, doc: cloneDoc(t.doc),
  });
  return saved.ok ? saved : no(saved.error);
}

export async function deleteReport(id: number): Promise<Result<true>> {
  const user = await getCurrentUser();
  if (!maySee(user)) return no('Please sign in.');
  if (!Number.isInteger(id)) return no('Unknown report.');
  const { rows } = await risansiPool.query(
    `DELETE FROM custom_reports WHERE id = $1 AND owner_id = $2 RETURNING title`,
    [id, user.id]);
  if (!rows.length) return no('You can only delete a report you own.');
  // Only if the deleted one was the pinned one. An unconditional delete here
  // un-pinned whatever else you had pinned, every time you tidied up.
  await risansiPool.query(
    `DELETE FROM app_settings WHERE key = $1 AND value = $2`, [pinKey(user.id!), String(id)]);
  await recordAudit({ entityType: 'custom_report', entityId: id, action: 'delete',
    summary: `Deleted report "${rows[0].title}"`, actorEmail: user.email!, actorRole: user.role });
  revalidatePath('/risansi/reports');
  return { ok: true, data: true };
}

/** A recipient's own editable copy. The original is untouched. */
export async function copyReport(id: number): Promise<Result<{ id: number }>> {
  const user = await getCurrentUser();
  if (!mayBuild(user)) return no('You do not have access to build reports.');
  const src = await getReport(id);
  if (!src.ok) return no(src.error);
  const saved = await saveReport({
    title: `${src.data.title} (copy)`.slice(0, 120),
    description: src.data.description ?? undefined,
    doc: cloneDoc(src.data.doc),
  });
  return saved.ok ? saved : no(saved.error);
}

export async function getShareCandidates(): Promise<Result<{ id: number; name: string; email: string; role: string }[]>> {
  const user = await getCurrentUser();
  if (!mayBuild(user)) return no('You do not have access to build reports.');
  const { rows } = await risansiPool.query(
    `SELECT id, name, email, role FROM users
      WHERE is_active AND id <> $1 ORDER BY name`, [user.id]);
  return { ok: true, data: rows.map(r => ({
    id: Number(r.id), name: String(r.name ?? r.email), email: String(r.email), role: String(r.role),
  })) };
}

export async function setReportShares(reportId: number, userIds: number[]): Promise<Result<{ added: number; removed: number }>> {
  const user = await getCurrentUser();
  if (!mayBuild(user)) return no('You do not have access to build reports.');
  if (!Number.isInteger(reportId)) return no('Unknown report.');

  const { rows: own } = await risansiPool.query(
    `SELECT title FROM custom_reports WHERE id = $1 AND owner_id = $2`, [reportId, user.id]);
  if (!own.length) return no('You can only share a report you own.');

  // Recipients are validated against the users table, not taken on trust.
  const wanted = [...new Set((userIds ?? []).filter(n => Number.isInteger(n)))];
  const { rows: valid } = await risansiPool.query(
    `SELECT id FROM users WHERE is_active AND id = ANY($1::int[]) AND id <> $2`, [wanted, user.id]);
  const ids = valid.map(r => Number(r.id));

  const { rows: before } = await risansiPool.query(
    `SELECT user_id FROM custom_report_shares WHERE report_id = $1`, [reportId]);
  const had = new Set(before.map(r => Number(r.user_id)));
  const added = ids.filter(i => !had.has(i));

  await risansiPool.query(
    `DELETE FROM custom_report_shares WHERE report_id = $1 AND NOT (user_id = ANY($2::int[]))`,
    [reportId, ids]);
  for (const uid of added) {
    await risansiPool.query(
      `INSERT INTO custom_report_shares (report_id, user_id, shared_by_name)
       VALUES ($1, $2, $3) ON CONFLICT (report_id, user_id) DO NOTHING`,
      [reportId, uid, user.email]);
  }

  // Only the newly added hear about it. Re-saving a share list should not
  // notify everybody on it again.
  if (added.length) {
    await pushInApp(added, {
      kind: 'report_shared',
      section: 'Reports',
      title: 'A report was shared with you',
      body: `${user.email} shared "${own[0].title}" with you.`,
      link: `/risansi/reports/${reportId}`,
      actor: user.email,
      entityType: 'custom_report',
      entityId: String(reportId),
    });
  }
  await recordAudit({ entityType: 'custom_report', entityId: reportId, action: 'update',
    summary: `Shared "${own[0].title}" with ${ids.length} ${ids.length === 1 ? 'person' : 'people'}`,
    actorEmail: user.email!, actorRole: user.role });

  return { ok: true, data: { added: added.length, removed: before.length - (ids.length - added.length) } };
}

export async function pinReport(id: number | null): Promise<Result<true>> {
  const user = await getCurrentUser();
  if (!maySee(user)) return no('Please sign in.');
  if (id == null) {
    await risansiPool.query(`DELETE FROM app_settings WHERE key = $1`, [pinKey(user.id!)]);
    revalidatePath('/risansi/reports');
    return { ok: true, data: true };
  }
  if (!Number.isInteger(id)) return no('Unknown report.');
  // Pinning something you cannot open would leave a dead tab on your page.
  const readable = await getReport(id);
  if (!readable.ok) return readable;
  await risansiPool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [pinKey(user.id!), String(id), user.email]);
  revalidatePath('/risansi/reports');
  return { ok: true, data: true };
}

export async function getPinnedReport(): Promise<Result<number | null>> {
  const user = await getCurrentUser();
  if (!maySee(user)) return no('Please sign in.');
  return { ok: true, data: await currentPin(user.id!) };
}

/**
 * Run one visual, in the CALLER's scope.
 *
 * The visual is taken from the request rather than re-read from the saved
 * document on purpose: the builder runs visuals that have not been saved
 * yet. That is safe because the engine validates every id against the model
 * and the scope is built here, from the session, never from the request.
 */
export async function runReportVisual(
  visual: Visual, filters?: PageFilters, cross?: CrossFilter, opts?: RunOpts,
): Promise<RunResult> {
  const user = await getCurrentUser();
  if (!maySee(user)) return { ok: false, error: 'Please sign in.' };
  return runVisual(buildScope(user), visual, filters ?? {}, cross, opts ?? {});
}

/** The page-filter dropdowns, limited to what the caller can already see. */
export async function getFilterOptions(): Promise<Result<{
  states: string[]; industries: string[]; clientTypes: string[]; tiers: string[];
  reps: { id: number; name: string }[];
}>> {
  const user = await getCurrentUser();
  if (!maySee(user)) return no('Please sign in.');
  const scope = buildScope(user);
  const rule = scope.clients;
  const where = rule === 'FALSE' ? 'FALSE' : rule ? `c.deleted_at IS NULL AND ${rule}` : 'c.deleted_at IS NULL';
  const { rows } = await risansiPool.query(
    `SELECT array_agg(DISTINCT c.state)       FILTER (WHERE c.state IS NOT NULL)       AS states,
            array_agg(DISTINCT c.industry)    FILTER (WHERE c.industry IS NOT NULL)    AS industries,
            array_agg(DISTINCT c.client_type) FILTER (WHERE c.client_type IS NOT NULL) AS client_types,
            array_agg(DISTINCT c.tier)        FILTER (WHERE c.tier IS NOT NULL)        AS tiers
       FROM clients c WHERE ${where}`);
  const { rows: reps } = await risansiPool.query(
    `SELECT DISTINCT u.id, u.name FROM clients c
       JOIN users u ON u.id = c.primary_rep_id
      WHERE ${where} ORDER BY u.name`);
  const r = rows[0] ?? {};
  return { ok: true, data: {
    states: (r.states ?? []) as string[],
    industries: (r.industries ?? []) as string[],
    clientTypes: (r.client_types ?? []) as string[],
    tiers: (r.tiers ?? []) as string[],
    reps: reps.map(x => ({ id: Number(x.id), name: String(x.name) })),
  } };
}
