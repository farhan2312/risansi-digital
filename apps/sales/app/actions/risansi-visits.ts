'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';
import { withinVisitEditWindow, VISIT_EDIT_WINDOW_DAYS } from '@/lib/risansi-visit-edit-window';
import { canEditVisitReport, whyCannotVisitClient } from '@/lib/risansi-auth';
import { pctForProbabilityCode } from '@/lib/risansi-probability-codes';
import { isEpcOem } from '@/lib/risansi-client-types';
import { notifyExpansionTagged } from '@/lib/risansi-email';
import { pushInApp } from '@/lib/risansi-inapp';
import { notifyCheckIn, notifyVisitSubmitted } from '@/lib/risansi-notify';
import { clientPrimaryRepSql } from '@/lib/risansi-client-rep';

// A session's role, for the visit edit gate.
function callerRole(session: { user?: { role?: string | null } }): string | null {
  return session.user?.role ?? null;
}

// Resolve the signed-in user's rep id: prefer the session's linked rep_id,
// fall back to a reps-by-email lookup for accounts linked after token issue.
/** A refusal the person can read. Thrown server-action errors are redacted in
 *  production, so a rule that throws reaches the user as nothing at all. */
export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

async function callerRepId(session: {
  user?: { repId?: number | null; email?: string | null };
}): Promise<number | null> {
  let repId = session.user?.repId ?? null;
  if (repId == null && session.user?.email) {
    const r = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1',
      [session.user.email],
    );
    repId = r.rows[0]?.id ?? null;
  }
  return repId;
}

// Insert an auto-created opportunity.
async function insertAutoOpp(fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  const ph   = cols.map((_, i) => `$${i + 1}`);
  await risansiPool.query(
    `INSERT INTO opportunities (${cols.join(', ')}, auto_created, created_at, updated_at)
     VALUES (${ph.join(', ')}, TRUE, NOW(), NOW())`,
    Object.values(fields),
  );
}

// ── Expansion opportunity (visit form "Expansion / New Business") ──
// Upserts a single auto_source='expansion_plan' opportunity for the visit as
// the form is filled (debounced from the client); deletes it when toggled off.
export async function saveExpansionOpportunity(input: {
  visitId: number;
  clientId: number;
  repId: number | null;
  hasExpansion: boolean;
  product: string;
  productType: string;
  stage: string;
  valueInr: number | null;
  probabilityCode: string | null;
  etaText: string | null;
  quoteRef: string | null;
  notes: string | null;
  tsmUserId?: number | null;
  tsmExternal?: string | null;
  tsmExternalEmail?: string | null;
}): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  // Same gate as the rest of the report: an authorised person, within the
  // window. This is a report-edit path too, so it can't stay open when the
  // equipment paths are closed.
  const expVis = await risansiPool.query<{ rep_id: number | null; submitted_at: string | null; client_id: number | null }>(
    'SELECT rep_id, submitted_at, client_id FROM visits WHERE id = $1', [input.visitId],
  );
  if (!expVis.rows[0]) return fail('That visit report no longer exists.');
  if (!(await canEditVisitReport({ role: callerRole(session), repId: await callerRepId(session) }, expVis.rows[0].rep_id, expVis.rows[0].client_id))) {
    return fail('You do not have permission to edit this visit report.');
  }
  if (!withinVisitEditWindow(expVis.rows[0].submitted_at)) {
    return fail(`This report was closed more than ${VISIT_EDIT_WINDOW_DAYS} days ago and can no longer be edited.`);
  }

  const existing = await risansiPool.query<{ id: number }>(
    `SELECT id FROM opportunities
     WHERE visit_id = $1 AND auto_source = 'expansion_plan'
     ORDER BY created_at DESC LIMIT 1`,
    [input.visitId],
  );
  const existingId = existing.rows[0]?.id ?? null;

  // Toggled "No" → drop the draft expansion opp if one exists — but only while
  // it is still a pristine draft. Once it has moved past Suspect, or picked up a
  // Sales Order, deleting it would hard-remove a real deal (SOs cascade). In that
  // case DETACH it from the visit instead and keep it standing on the board.
  if (!input.hasExpansion) {
    if (existingId) {
      const info = (await risansiPool.query<{ product: string; stage: string; so: number }>(
        `SELECT product, stage,
                (SELECT count(*) FROM opportunity_sales_orders s WHERE s.opportunity_id = o.id)::int AS so
           FROM opportunities o WHERE id = $1`, [existingId],
      )).rows[0];
      const prod = info?.product ?? 'Expansion';
      const advanced = info && (info.stage !== 'Suspect' || info.so > 0);
      if (advanced) {
        await risansiPool.query(
          `UPDATE opportunities SET visit_id = NULL, auto_source = NULL, updated_at = NOW() WHERE id = $1`,
          [existingId],
        );
        await recordAudit({
          action: 'update', entityType: 'client', entityId: input.clientId,
          summary: `expansion un-tagged from visit (kept on pipeline): ${prod}`,
          actorEmail: session.user.email,
        });
      } else {
        await risansiPool.query('DELETE FROM opportunities WHERE id = $1', [existingId]);
        await recordAudit({
          action: 'delete', entityType: 'client', entityId: input.clientId,
          summary: `opportunity removed (expansion): ${prod}`,
          actorEmail: session.user.email,
        });
      }
      revalidatePath(`/risansi/visits/${input.visitId}`);
      revalidatePath('/risansi/pipeline');
    }
    return { ok: true };
  }

  // Resolve the owning rep so it's never null: passed-in → reps-by-email →
  // session.repId → client's primary rep.
  let repId = input.repId;
  if (!repId) {
    const r = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1',
      [session.user.email],
    );
    repId = r.rows[0]?.id ?? session.user.repId ?? null;
  }
  if (!repId) {
    const c = await risansiPool.query<{ primary_rep_id: number | null }>(
      `SELECT ${clientPrimaryRepSql('$1')} AS primary_rep_id`,
      [input.clientId],
    );
    repId = c.rows[0]?.primary_rep_id ?? null;
  }

  const product = input.product.trim() || 'Expansion';
  const valueCr = input.valueInr && input.valueInr > 0 ? input.valueInr / 10_000_000 : null;
  // The form captures the RIL probability code; the numeric % is derived from
  // it, and stays null when the rep left the code blank rather than defaulting
  // to a figure nobody chose.
  const probability = pctForProbabilityCode(input.probabilityCode);

  const tsmUserId       = input.tsmUserId ?? null;
  const tsmExternal     = input.tsmExternal?.trim() || null;
  const tsmExternalEmail = input.tsmExternalEmail?.trim() || null;

  if (existingId) {
    await risansiPool.query(
      `UPDATE opportunities SET
         rep_id = COALESCE($2, rep_id),
         product = $3, product_type = $4, stage = $5,
         value_cr = $6, probability = $7, probability_code = $8, eta_text = $9,
         quote_ref = $10, notes = $11,
         tsm_user_id = $12, tsm_external = $13, tsm_external_email = $14, updated_at = NOW()
       WHERE id = $1`,
      [existingId, repId, product, input.productType, input.stage,
       valueCr, probability, input.probabilityCode, input.etaText, input.quoteRef, input.notes,
       tsmUserId, tsmExternal, tsmExternalEmail],
    );
  } else {
    await risansiPool.query(
      `INSERT INTO opportunities (
         client_id, rep_id, visit_id, product, product_type, stage,
         value_cr, probability, probability_code, eta_text, quote_ref, notes,
         tsm_user_id, tsm_external, tsm_external_email,
         auto_created, auto_source, created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,'expansion_plan',$16,NOW(),NOW())`,
      [input.clientId, repId, input.visitId, product, input.productType, input.stage,
       valueCr, probability, input.probabilityCode, input.etaText, input.quoteRef, input.notes,
       tsmUserId, tsmExternal, tsmExternalEmail, session.user.email],
    );
    // Log only the initial creation, not the debounced updates that follow.
    await recordAudit({
      action: 'create', entityType: 'client', entityId: input.clientId,
      summary: `created opportunity (expansion): ${product} · ${input.stage}`,
      actorEmail: session.user.email,
    });
  }

  revalidatePath(`/risansi/visits/${input.visitId}`);
  revalidatePath('/risansi/pipeline');
  return { ok: true };
}

// ── Check In ───────────────────────────────────────────────────

export async function checkInVisit({
  visitId, lat, lng, accuracy, manual = false, manualNote,
}: {
  visitId: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  manual?: boolean;
  manualNote?: string;
}): Promise<SaveResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) throw new Error('Not authenticated');

    // Only someone allowed to edit this visit may check it in (the UPDATE is
    // already scoped to unsubmitted visits; this adds the missing who-check).
    const civ = await risansiPool.query<{ rep_id: number | null; client_id: number | null }>(
      'SELECT rep_id, client_id FROM visits WHERE id = $1', [visitId],
    );
    if (!civ.rows[0]) return fail('That visit report no longer exists.');
    if (!(await canEditVisitReport({ role: callerRole(session), repId: await callerRepId(session) }, civ.rows[0].rep_id, civ.rows[0].client_id))) {
      return fail('You do not have permission to edit this visit report.');
    }

    await risansiPool.query(
      `UPDATE visits SET
         check_in_time       = NOW(),
         check_in_lat        = $1,
         check_in_lng        = $2,
         check_in_accuracy_m = $3,
         manual_checkin      = $4,
         manual_checkin_note = $5,
         gps_within_radius   = NULL,
         status              = CASE WHEN status = 'planned' THEN 'checked-in' ELSE status END,
         updated_at          = NOW()
       WHERE id = $6 AND submitted_at IS NULL`,
      [lat, lng, accuracy, manual, manualNote ?? null, visitId],
    );

    revalidatePath(`/risansi/visits/${visitId}`);
    if (civ.rows[0].client_id != null) {
      await notifyCheckIn(civ.rows[0].client_id, civ.rows[0].rep_id, session.user.email);
    }
  } catch (err) {
    console.error('checkInVisit error:', err);
    throw err;
  }
  return { ok: true };
}

// ── Auto-save visit fields ─────────────────────────────────────

const SAFE_VISIT_COLS = new Set([
  'purpose', 'outcome', 'summary', 'industry_format',
  'competitor_activity_observed', 'sample_or_gift_given',
  'sample_gift_detail', 'sample_gift_value',
  'follow_up_required', 'follow_up_text', 'follow_up_due_date',
  'next_visit_recommendation', 'performance_feedback',
  'pcp_competitor', 'mgmt_intervention', 'action_points',
  'complaint_notes', 'competitors_observed',
  'open_remarks', 'major_remarks',
  'ice_dispersal_by', 'negotiation_by',
  'is_unplanned', 'unplanned_reason',
]);

const SAFE_SUGAR_COLS = new Set([
  'ril_screw_molasses', 'ril_screw_magma', 'ril_screw_syrup',
  'ril_screw_massecuite', 'ril_screw_melt', 'ril_screw_dosing',
  'ril_screw_other', 'ril_rota_magma', 'ril_rota_massecuite',
  'ril_spares_feedback', 'ril_spares_notes',
  'other_screw_molasses', 'other_screw_magma', 'other_screw_syrup',
  'other_screw_massecuite', 'other_screw_melt', 'other_screw_dosing',
  'other_screw_other', 'other_rota_magma', 'other_rota_massecuite',
  'purchasing_route', 'purchasing_route_detail',
  'has_expansion', 'expansion_detail',
  'has_pending_offers', 'pending_offers_detail',
  'has_complaints', 'complaints_detail',
  'has_returnable_material', 'returnable_detail',
  'has_outstanding_issues', 'outstanding_detail',
  'perf_cert_required', 'perf_cert_detail',
  'last_pump_order', 'last_spares_order',
  'competitor_prices_captured', 'competitor_pics_count', 'checked_by',
]);

const SAFE_NONSUGAR_COLS = new Set([
  'deal_in', 'valves_observed_notes', 'checked_by',
]);

export async function saveVisitField(
  visitId: string,
  fields: Record<string, unknown>,
): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  const { rows } = await risansiPool.query<{ rep_id: number | null; submitted_at: string | null; client_id: number | null }>(
    'SELECT rep_id, submitted_at, client_id FROM visits WHERE id = $1',
    [visitId],
  );
  const visit = rows[0];
  if (!visit) return fail('That visit report no longer exists.');   // guard the who-check below and avoid orphan report rows
  // Submitted reports stay correctable for the edit window, then lock for good.
  if (visit.submitted_at && !withinVisitEditWindow(visit.submitted_at)) {
    return fail(`This report was closed more than ${VISIT_EDIT_WINDOW_DAYS} days ago and can no longer be edited.`);
  }
  const isCorrection = !!visit?.submitted_at;

  // Who may edit: the assigned rep, a manager above them, or admin/sysadmin.
  const myRepId = await callerRepId(session);
  if (!(await canEditVisitReport({ role: callerRole(session), repId: myRepId }, visit.rep_id, visit.client_id))) {
    return fail('You do not have permission to edit this visit report.');
  }

  const visitFields:   Record<string, unknown> = {};
  const sugarFields:   Record<string, unknown> = {};
  const nonsugFields:  Record<string, unknown> = {};

  for (const [key, val] of Object.entries(fields)) {
    if (SAFE_VISIT_COLS.has(key))    visitFields[key]   = val;
    if (SAFE_SUGAR_COLS.has(key))    sugarFields[key]   = val;
    if (SAFE_NONSUGAR_COLS.has(key)) nonsugFields[key]  = val;
  }

  if (Object.keys(visitFields).length > 0) {
    const cols = Object.keys(visitFields);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    await risansiPool.query(
      `UPDATE visits SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [visitId, ...Object.values(visitFields)],
    );
  }

  if (Object.keys(sugarFields).length > 0) {
    const cols = Object.keys(sugarFields);
    const vals = Object.values(sugarFields);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    await risansiPool.query(
      `INSERT INTO visit_sugar_report (visit_id, ${cols.join(', ')})
       VALUES ($1, ${placeholders})
       ON CONFLICT (visit_id) DO UPDATE SET ${sets.join(', ')}`,
      [visitId, ...vals],
    );
  }

  if (Object.keys(nonsugFields).length > 0) {
    const cols = Object.keys(nonsugFields);
    const vals = Object.values(nonsugFields);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    await risansiPool.query(
      `INSERT INTO visit_nonsugar_report (visit_id, ${cols.join(', ')})
       VALUES ($1, ${placeholders})
       ON CONFLICT (visit_id) DO UPDATE SET ${sets.join(', ')}`,
      [visitId, ...vals],
    );
  }

  // Next Visit Recommendation edited AFTER the report was submitted: move the
  // planned visit that was raised from it. Only for corrections — before submit
  // the rep is still drafting, and every keystroke on that date field would
  // otherwise shuffle a visit around the calendar. Never fails the save.
  if (isCorrection && visit.client_id && 'next_visit_recommendation' in visitFields) {
    try {
      const rec = visitFields.next_visit_recommendation;
      await syncPlannedFollowUpVisit(
        visitId, Number(visit.client_id), visit.rep_id,
        rec ? String(rec) : null, session.user.email,
      );
    } catch (e) {
      console.error('planned follow-up reschedule failed for visit', visitId, e);
    }
  }

  // Corrections to an already-submitted report are auditable against the client;
  // ordinary pre-submission drafting is not logged (it would drown the feed).
  if (isCorrection && visit?.client_id) {
    const changed = [...Object.keys(visitFields), ...Object.keys(sugarFields), ...Object.keys(nonsugFields)];
    if (changed.length) {
      const shown = changed.slice(0, 6).map(c => c.replace(/_/g, ' ')).join(', ');
      await recordAudit({
        action: 'update', entityType: 'client', entityId: visit.client_id,
        summary: `Visit report corrected after submission: ${shown}${changed.length > 6 ? ` +${changed.length - 6} more` : ''}`,
        actorEmail: session.user.email,
      });
    }
  }
  return { ok: true };
}

// ── Client profile from the visit's Client Type page ───────────
// The Client Type page persists to the CLIENT (not the visit): the client_type
// itself, plus the EPC/OEM account-intelligence fields. Latest-wins, prefilled
// on the next visit. Same edit permission as the rest of the report.
const SAFE_CLIENT_PROFILE_COLS = new Set([
  'client_type', 'focus_industries', 'avg_annual_pump_req',
  'ongoing_tenders', 'upcoming_tenders', 'upcoming_tenders_details', 'pcp_suppliers',
  'tcd',
]);

export async function saveClientProfileFromVisit(
  visitId: string,
  patch: Record<string, unknown>,
): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  const { rows } = await risansiPool.query<{ rep_id: number | null; submitted_at: string | null; client_id: number | null; client_type: string | null }>(
    `SELECT v.rep_id, v.submitted_at, v.client_id, c.client_type
       FROM visits v JOIN clients c ON c.id = v.client_id
      WHERE v.id = $1`,
    [visitId],
  );
  const visit = rows[0];
  if (!visit || visit.client_id == null) return fail('That visit report no longer exists.');
  if (visit.submitted_at && !withinVisitEditWindow(visit.submitted_at)) {
    return fail(`This report was closed more than ${VISIT_EDIT_WINDOW_DAYS} days ago and can no longer be edited.`);
  }
  const myRepId = await callerRepId(session);
  if (!(await canEditVisitReport({ role: callerRole(session), repId: myRepId }, visit.rep_id, visit.client_id))) {
    return fail('You do not have permission to edit this visit report.');
  }

  const INT4_MAX = 2147483647;
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!SAFE_CLIENT_PROFILE_COLS.has(k)) continue;
    let val = v;
    // Defend the integer columns against overflow / negatives regardless of what
    // the client sent, so a mis-keyed value can't throw 22003 and lose the save.
    if (k === 'avg_annual_pump_req' || k === 'ongoing_tenders' || k === 'tcd') {
      const n = v == null ? null : Number(v);
      val = (n != null && Number.isFinite(n)) ? Math.min(INT4_MAX, Math.max(0, Math.round(n))) : null;
    }
    cols.push(k); vals.push(val);
  }
  // Nothing in the patch was a column we store — not a refusal, just no work.
  if (cols.length === 0) return { ok: true };

  // Re-typing a client away from EPC/OEM retires the channel-only intelligence,
  // so a later re-classification starts clean instead of resurfacing stale data.
  const clearingEpc =
    Object.prototype.hasOwnProperty.call(patch, 'client_type') && !isEpcOem(patch.client_type as string);
  const extraNulls = clearingEpc
    ? ['focus_industries', 'avg_annual_pump_req', 'ongoing_tenders', 'upcoming_tenders', 'upcoming_tenders_details', 'pcp_suppliers']
        .filter(col => !cols.includes(col))
    : [];

  const sets = [
    ...cols.map((c, i) => `${c} = $${i + 2}`),
    ...extraNulls.map(c => `${c} = NULL`),
  ];
  await risansiPool.query(
    `UPDATE clients SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [visit.client_id, ...vals],
  );

  // A client_type change is a real profile edit — audit it against the client.
  if (cols.includes('client_type') && patch.client_type !== visit.client_type) {
    await recordAudit({
      action: 'update', entityType: 'client', entityId: visit.client_id,
      summary: `Client type set to ${(patch.client_type as string) || '—'} (from visit report)`,
      actorEmail: session.user.email,
    });
  }

  revalidatePath(`/risansi/clients/${visit.client_id}`);
  return { ok: true };
}

// ── Add equipment ──────────────────────────────────────────────

export async function addEquipment(
  visitId: string,
  clientId: string,
  data: {
    pump_type: string; supplier: string; is_ril: boolean;
    model?: string; qty?: number; application?: string;
    capacity_m3h?: number; head_m?: number; kw?: number;
    drive_system?: string; moc?: string; condition?: string;
    condition_remark?: string;
    performance_feedback?: string;
    reason_for_competitor?: string;
    competitor_activity_type?: string;
  },
): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  // Same gate as the report itself: an authorised person, within the window.
  const addVis = await risansiPool.query<{ submitted_at: string | null; rep_id: number | null; client_id: number | null }>(
    'SELECT submitted_at, rep_id, client_id FROM visits WHERE id = $1', [visitId],
  );
  if (!addVis.rows[0]) return fail('That visit report no longer exists.');
  if (!(await canEditVisitReport({ role: callerRole(session), repId: await callerRepId(session) }, addVis.rows[0].rep_id, addVis.rows[0].client_id))) {
    return fail('You do not have permission to edit this visit report.');
  }
  if (!withinVisitEditWindow(addVis.rows[0].submitted_at)) {
    return fail(`This report was closed more than ${VISIT_EDIT_WINDOW_DAYS} days ago and can no longer be edited.`);
  }
  const addIsCorrection = !!addVis.rows[0].submitted_at;

  const isOpp = !data.is_ril && data.condition === 'EOL';

  await risansiPool.query(
    `INSERT INTO equipment (
       client_id, visit_id, pump_type, supplier, is_ril,
       model, qty, application, capacity_m3h, head_m, kw,
       drive_system, moc, condition, condition_remark, performance_feedback,
       reason_for_competitor, competitor_activity_type,
       is_opportunity, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW()
     )`,
    [
      clientId, visitId,
      data.pump_type, data.supplier, data.is_ril,
      data.model ?? null, data.qty ?? 1, data.application ?? null,
      data.capacity_m3h ?? null, data.head_m ?? null, data.kw ?? null,
      data.drive_system ?? null, data.moc ?? null,
      data.condition ?? null, data.condition_remark ?? null, data.performance_feedback ?? null,
      data.reason_for_competitor ?? null, data.competitor_activity_type ?? null,
      isOpp,
    ],
  );

  const label = `${data.supplier ?? ''} ${data.model ?? ''}`.trim() || data.pump_type;
  await recordAudit({
    action: 'create', entityType: 'client', entityId: clientId,
    summary: `${data.is_ril ? 'RIL' : 'Competitor'} pump added: ${label}${addIsCorrection ? ' (after submission)' : ''}`,
    actorEmail: session.user.email,
  });

  revalidatePath(`/risansi/visits/${visitId}`);
  return { ok: true };
}

// ── Edit equipment (only while the visit is still open) ─────────

export async function updateEquipment(
  equipmentId: string | number,
  visitId: string,
  data: {
    pump_type: string; supplier: string; is_ril: boolean;
    model?: string; qty?: number; application?: string;
    capacity_m3h?: number; head_m?: number; kw?: number;
    drive_system?: string; moc?: string; condition?: string;
    condition_remark?: string;
    performance_feedback?: string;
    reason_for_competitor?: string;
    competitor_activity_type?: string;
  },
): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  // Editable until submission, then for the correction window only — by an
  // authorised person (rep / tour manager / admin / sysadmin).
  const vis = await risansiPool.query<{ submitted_at: string | null; rep_id: number | null; client_id: number | null }>(
    'SELECT submitted_at, rep_id, client_id FROM visits WHERE id = $1', [visitId],
  );
  if (!vis.rows[0]) return fail('That visit report no longer exists.');
  if (!(await canEditVisitReport({ role: callerRole(session), repId: await callerRepId(session) }, vis.rows[0].rep_id, vis.rows[0].client_id))) {
    return fail('You do not have permission to edit this visit report.');
  }
  if (!withinVisitEditWindow(vis.rows[0].submitted_at)) {
    return fail(`This report was closed more than ${VISIT_EDIT_WINDOW_DAYS} days ago and can no longer be edited.`);
  }
  const isCorrection = !!vis.rows[0].submitted_at;

  const isOpp = !data.is_ril && data.condition === 'EOL';

  await risansiPool.query(
    `UPDATE equipment SET
       pump_type = $1, supplier = $2, is_ril = $3, model = $4, qty = $5,
       application = $6, capacity_m3h = $7, head_m = $8, kw = $9,
       drive_system = $10, moc = $11, condition = $12, condition_remark = $13, performance_feedback = $14,
       reason_for_competitor = $15, competitor_activity_type = $16, is_opportunity = $17
     WHERE id = $18 AND visit_id = $19`,
    [
      data.pump_type, data.supplier, data.is_ril,
      data.model ?? null, data.qty ?? 1, data.application ?? null,
      data.capacity_m3h ?? null, data.head_m ?? null, data.kw ?? null,
      data.drive_system ?? null, data.moc ?? null,
      data.condition ?? null, data.condition_remark ?? null, data.performance_feedback ?? null,
      data.reason_for_competitor ?? null, data.competitor_activity_type ?? null,
      isOpp, equipmentId, visitId,
    ],
  );

  const cRow = await risansiPool.query<{ client_id: number }>(
    'SELECT client_id FROM equipment WHERE id = $1', [equipmentId],
  );
  const clientId = cRow.rows[0]?.client_id;
  if (clientId != null) {
    const label = `${data.supplier ?? ''} ${data.model ?? ''}`.trim() || data.pump_type;
    await recordAudit({
      action: 'update', entityType: 'client', entityId: clientId,
      summary: `${data.is_ril ? 'RIL' : 'Competitor'} pump updated: ${label}${isCorrection ? ' (after submission)' : ''}`,
      actorEmail: session.user.email,
    });
  }

  revalidatePath(`/risansi/visits/${visitId}`);
  return { ok: true };
}

// ── Delete equipment (only while the visit is still open) ───────

export async function deleteEquipment(equipmentId: string | number, visitId: string): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  // Match the edit rule — an authorised person, correctable until the window closes.
  const vis = await risansiPool.query<{ submitted_at: string | null; rep_id: number | null; client_id: number | null }>(
    'SELECT submitted_at, rep_id, client_id FROM visits WHERE id = $1', [visitId],
  );
  if (!vis.rows[0]) return fail('That visit report no longer exists.');
  if (!(await canEditVisitReport({ role: callerRole(session), repId: await callerRepId(session) }, vis.rows[0].rep_id, vis.rows[0].client_id))) {
    return fail('You do not have permission to edit this visit report.');
  }
  if (!withinVisitEditWindow(vis.rows[0].submitted_at)) {
    return fail(`This report was closed more than ${VISIT_EDIT_WINDOW_DAYS} days ago and can no longer be edited.`);
  }
  const isCorrection = !!vis.rows[0].submitted_at;

  const eq = await risansiPool.query<{ client_id: number; supplier: string | null; model: string | null; pump_type: string | null; is_ril: boolean }>(
    'SELECT client_id, supplier, model, pump_type, is_ril FROM equipment WHERE id = $1 AND visit_id = $2',
    [equipmentId, visitId],
  );
  const row = eq.rows[0];
  if (!row) return fail('That equipment row no longer exists — somebody else may have changed the report.');

  await risansiPool.query('DELETE FROM equipment WHERE id = $1 AND visit_id = $2', [equipmentId, visitId]);

  const label = `${row.supplier ?? ''} ${row.model ?? ''}`.trim() || row.pump_type || 'pump';
  await recordAudit({
    action: 'delete', entityType: 'client', entityId: row.client_id,
    summary: `${row.is_ril ? 'RIL' : 'Competitor'} pump removed: ${label}${isCorrection ? ' (after submission)' : ''}`,
    actorEmail: session.user.email,
  });

  revalidatePath(`/risansi/visits/${visitId}`);
  return { ok: true };
}

// ── Submit (close) visit ───────────────────────────────────────

/**
 * Raise (or reschedule) the Planned visit a report's "Next Visit Recommendation"
 * asks for. (Called from saveVisitField above as well as submitVisit below —
 * a function declaration, so it hoists.)
 *
 * Rules, as agreed:
 *   • only a FUTURE date creates anything — a recommendation already in the past
 *     is a record of intent, not a plan, and back-dating the calendar helps
 *     nobody;
 *   • the planned visit belongs to the rep who filed the report — IF they work
 *     the client. A visit may only be planned for the owner, a covering rep or
 *     their manager (whyCannotVisitClient, the rule Plan Visit enforces), and
 *     this path is one of the ways people ended up with visits to clients they
 *     had no relation to. When the filing rep is not one of those, the plan
 *     goes to the client's owner instead, and the audit row says so; when
 *     nobody owns the client, nothing is raised and the audit row says that;
 *   • changing the recommendation MOVES the same planned visit (found via
 *     planned_from_visit_id, migration 0044) rather than adding a second one;
 *   • nothing is ever auto-deleted. Clearing the date leaves the planned visit
 *     standing for the rep to cancel deliberately — the calendar is something
 *     people organise their week around, so it is not ours to silently empty.
 *
 * Also refuses to act once the planned visit has been started: if the rep has
 * already checked in or closed it, moving its date under them would rewrite
 * history. Returns the planned visit id, or null when nothing was done.
 */
async function syncPlannedFollowUpVisit(
  sourceVisitId: string | number,
  clientId: number,
  repId: number | null,
  recommendation: string | null | undefined,
  actorEmail: string,
): Promise<{ id: number; action: 'created' | 'moved' } | null> {
  if (!recommendation) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(recommendation)) return null;
  if (repId == null) return null;

  const existing = (await risansiPool.query<{ id: number; visit_date: string; check_in_time: string | null; submitted_at: string | null }>(
    `SELECT id, visit_date::text AS visit_date, check_in_time, submitted_at
       FROM visits WHERE planned_from_visit_id = $1`,
    [sourceVisitId],
  )).rows[0];

  if (existing) {
    // Started or closed — leave it alone.
    if (existing.check_in_time || existing.submitted_at) return null;
    if (existing.visit_date === recommendation) return null;
    await risansiPool.query(
      `UPDATE visits SET visit_date = $1, updated_at = NOW() WHERE id = $2`,
      [recommendation, existing.id],
    );
    return { id: existing.id, action: 'moved' };
  }

  // Only future dates raise a new plan.
  const future = (await risansiPool.query<{ ok: boolean }>(
    `SELECT ($1::date > CURRENT_DATE) AS ok`, [recommendation],
  )).rows[0]?.ok;
  if (!future) return null;

  // Whose plan is it? The filing rep's, if they work the client; otherwise the
  // owner's. Never somebody with no relation to the client.
  let plannedFor = repId;
  let redirected: string | null = null;
  const refusal = await whyCannotVisitClient(repId, clientId);
  if (refusal) {
    const owner = (await risansiPool.query<{ id: number; name: string }>(
      `SELECT u.id, u.name FROM clients c JOIN users u ON u.id = c.primary_rep_id AND u.is_active
        WHERE c.id = $1`, [clientId],
    )).rows[0];
    if (!owner) {
      await recordAudit({
        action: 'skip', entityType: 'visit', entityId: String(sourceVisitId),
        summary: `No follow-up visit raised from the next-visit date on report #${sourceVisitId}: ${refusal}`,
        actorEmail,
      });
      return null;
    }
    plannedFor = owner.id;
    redirected = owner.name;
  }

  // Don't stack a duplicate on top of a plan the rep already made by hand for
  // the same client and day.
  const clash = (await risansiPool.query<{ id: number }>(
    `SELECT id FROM visits
      WHERE client_id = $1 AND visit_date = $2::date AND rep_id = $3
        AND submitted_at IS NULL
      LIMIT 1`,
    [clientId, recommendation, plannedFor],
  )).rows[0];
  if (clash) {
    await risansiPool.query(
      `UPDATE visits SET planned_from_visit_id = $1 WHERE id = $2 AND planned_from_visit_id IS NULL`,
      [sourceVisitId, clash.id],
    );
    return null;
  }

  // 'planned', lower-case: every other writer and every reader uses that
  // spelling, and the seven 'Planned' rows this used to write only passed
  // because the readers test `status <> 'completed'`.
  const { rows } = await risansiPool.query<{ id: number }>(
    `INSERT INTO visits (client_id, rep_id, visit_date, is_planned, status,
                         purpose, planned_from_visit_id, created_at, updated_at)
     VALUES ($1, $2, $3::date, TRUE, 'planned', $4, $5, NOW(), NOW())
     RETURNING id`,
    [clientId, plannedFor, recommendation, 'Follow-up visit', sourceVisitId],
  );
  const newId = rows[0]?.id;
  if (newId) {
    await recordAudit({
      action: 'create', entityType: 'visit', entityId: String(newId),
      summary: redirected
        ? `Planned follow-up visit auto-created from the next-visit date on report #${sourceVisitId}, for ${redirected} as the client's owner — the filing rep does not work this client`
        : `Planned follow-up visit auto-created from the next-visit date on report #${sourceVisitId}`,
      actorEmail,
    });
  }
  return newId ? { id: newId, action: 'created' } : null;
}

/**
 * Equipment pump types and opportunity product types are two different
 * vocabularies, and this path fed one straight into the other. Equipment holds
 * Rota (76 records) and Other (8), neither of which is an opportunity product
 * type — and since displacement opportunities are created during visit submit,
 * an unmapped value fails the whole submission, not just the auto-opportunity.
 *
 * Anything without a counterpart becomes OTHER rather than being passed
 * through. A displacement opportunity is a lead to chase, not a product spec.
 */
function oppProductType(pumpType: string | null | undefined): string {
  const t = (pumpType ?? '').trim().toUpperCase();
  return t === 'PCP' || t === 'MMP' ? t : 'OTHER';
}

/**
 * Close a visit.
 *
 * Every refusal here is returned, not thrown. A thrown server-action error is
 * redacted in production, so the caller got an opaque failure and the Confirm
 * Submit button — which had no catch — simply did nothing: the page never
 * refreshed, the spinner reset, and the rep was left pressing a button that
 * gave no reason. Visit 1810 sat like that because the visit belongs to one of
 * Ankur Srivastava's two accounts and he was signed into the other.
 */
export async function submitVisit(visitId: string): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const [visitRes, sugarRes, dispRes] = await Promise.all([
    risansiPool.query(
      `SELECT v.*, c.legal_name, c.id::text AS cid
       FROM visits v JOIN clients c ON v.client_id = c.id
       WHERE v.id = $1 AND v.submitted_at IS NULL`,
      [visitId],
    ),
    risansiPool.query('SELECT * FROM visit_sugar_report WHERE visit_id = $1', [visitId]).catch(() => ({ rows: [] })),
    risansiPool.query('SELECT * FROM equipment WHERE visit_id = $1 AND is_opportunity = TRUE', [visitId]).catch(() => ({ rows: [] })),
  ]);

  const visit = visitRes.rows[0];
  if (!visit) return { ok: false, error: 'This visit no longer exists, or it has already been submitted.' };

  // Ownership: only the assigned rep may submit (close) the visit. The message
  // names the rep it belongs to, because the usual cause is one person holding
  // two accounts and being signed into the wrong one — "only the assigned rep"
  // on its own does not tell them what to do about it.
  const submitterRepId = await callerRepId(session);
  if (visit.rep_id == null || submitterRepId == null || Number(visit.rep_id) !== Number(submitterRepId)) {
    const { rows: [owner] } = await risansiPool.query<{ name: string; email: string }>(
      'SELECT name, email FROM users WHERE id = $1', [visit.rep_id]);
    return {
      ok: false,
      error: visit.rep_id == null
        ? 'This visit has no rep assigned, so there is nobody to submit it. Ask an administrator to assign it.'
        : `This visit is assigned to ${owner?.name ?? 'another rep'}${owner?.email ? ` (${owner.email})` : ''}, and only they can submit it. If that is also you, sign in with that account.`,
    };
  }
  // And the client must be theirs — the same Blocked rule the page applies
  // when it hides the button. Without this, an orphaned visit could still be
  // closed by hand, and a closed visit moves the client's last-visit date.
  const blocked = await whyCannotVisitClient(Number(visit.rep_id), Number(visit.client_id));
  if (blocked) return { ok: false, error: blocked };

  const sugar     = sugarRes.rows[0];
  const dispOpps  = dispRes.rows;

  const repRes = await risansiPool.query<{ id: number }>(
    'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1',
    [session.user.email],
  );
  // Resolve the submitting rep from multiple sources so it's never null:
  // reps-by-email → session.repId → visit.rep_id.
  const repId = repRes.rows[0]?.id ?? session.user.repId ?? visit.rep_id ?? null;

  // The client's own rep owns the auto-created opportunity, falling back to the
  // submitting rep so it always has an owner even on an unassigned client.
  const clientRepRes = await risansiPool.query<{ user_id: number }>(
    `SELECT ${clientPrimaryRepSql('$1')} AS user_id`,
    [visit.client_id],
  );
  const primaryRepId   = clientRepRes.rows[0]?.user_id ?? repId;
  console.log('submitVisit repId resolved:', { repId, primaryRepId });

  // 1. Close the visit
  await risansiPool.query(
    `UPDATE visits SET
       status         = 'completed',
       submitted_at   = NOW(),
       check_out_time = COALESCE(check_out_time, NOW()),
       updated_at     = NOW()
     WHERE id = $1`,
    [visitId],
  );

  // 2. Expansion opportunities are now created live from the visit form's
  //    "Expansion / New Business" section (saveExpansionOpportunity), so the
  //    submit no longer creates one from visit_sugar_report.

  // 3. Auto-create displacement opportunities
  for (const equip of dispOpps) {
    await insertAutoOpp({
      client_id:    visit.client_id,
      rep_id:       primaryRepId,
      visit_id:     visitId,
      product:      `${equip.supplier} ${equip.model ?? ''} replacement`.trim(),
      product_type: oppProductType(equip.pump_type),
      stage:        'Suspect',
      notes:        `Auto-created: EOL ${equip.supplier} pump (${equip.application ?? 'n/a'}) observed.`,
      auto_source:  'displacement',
      created_by:   session.user.email,
    });
  }

  // 4. Auto-create follow-up task
  if (visit.follow_up_required && visit.follow_up_text) {
    // Owner: submitting rep first, client's primary as last resort — so the
    // follow-up is never left unassigned (primaryRepId = client.primary ?? repId).
    const followUpRepId = repId ?? primaryRepId;
    await risansiPool.query(
      `INSERT INTO tasks
         (visit_id, client_id, assigned_to_rep, title, description,
          due_date, priority, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Medium','open',$7,NOW(),NOW())`,
      [
        visitId, visit.client_id, followUpRepId,
        `Follow up — ${visit.legal_name}`,
        visit.follow_up_text,
        visit.follow_up_due_date ?? null,
        session.user.email,
      ],
    );
  }

  // 4b. Next Visit Recommendation -> a Planned visit on that date, owned by the
  //     rep who filed this report. Never fails the submit: a follow-up that
  //     can't be raised must not cost the rep the report they just closed.
  try {
    await syncPlannedFollowUpVisit(
      visitId, Number(visit.client_id), repId,
      visit.next_visit_recommendation
        ? new Date(visit.next_visit_recommendation).toISOString().slice(0, 10)
        : null,
      session.user.email,
    );
  } catch (e) {
    console.error('planned follow-up visit failed for visit', visitId, e);
  }

  // 5. Update client last_visit_date
  await risansiPool.query(
    `UPDATE clients SET
       last_visit_date = $1, updated_at = NOW()
     WHERE id = $2
       AND (last_visit_date IS NULL OR last_visit_date < $1)`,
    [visit.visit_date, visit.client_id],
  );

  await recordAudit({
    action: 'submit', entityType: 'visit', entityId: visitId,
    entityLabel: visit.legal_name,
    summary: `Submitted visit report for ${visit.legal_name}`,
    actorEmail: session.user.email,
  });

  // Notify a TSM tagged on this visit's expansion opportunity — once, on submit.
  try {
    const exp = (await risansiPool.query<{
      id: number; product: string | null; stage: string | null; value_cr: string | null; notes: string | null;
      tsm_user_id: number | null; tsm_external: string | null; tsm_external_email: string | null;
    }>(
      `SELECT id, product, stage, value_cr::text AS value_cr, notes, tsm_user_id, tsm_external, tsm_external_email
         FROM opportunities
        WHERE visit_id = $1 AND auto_source = 'expansion_plan' AND tsm_notified_at IS NULL
          AND (tsm_user_id IS NOT NULL OR (tsm_external IS NOT NULL AND tsm_external_email IS NOT NULL))
        ORDER BY created_at DESC LIMIT 1`,
      [visitId],
    )).rows[0];
    if (exp) {
      let to: string | null = null;
      let toName: string | null = null;
      if (exp.tsm_user_id) {
        const u = (await risansiPool.query<{ name: string | null; email: string | null }>(
          'SELECT name, email FROM users WHERE id = $1', [exp.tsm_user_id])).rows[0];
        if (u?.email && u.email.toLowerCase() !== session.user.email!.toLowerCase()) { to = u.email; toName = u.name; }
      } else if (exp.tsm_external && exp.tsm_external_email) {
        to = exp.tsm_external_email; toName = exp.tsm_external;
      }
      if (to) {
        const tagger = (await risansiPool.query<{ name: string | null }>(
          'SELECT name FROM users WHERE lower(email) = lower($1)', [session.user.email])).rows[0];
        await notifyExpansionTagged({
          to, toName,
          taggedBy: tagger?.name || session.user.email,
          clientName: visit.legal_name,
          product: exp.product, stage: exp.stage,
          valueInr: exp.value_cr ? Math.round(parseFloat(exp.value_cr) * 10_000_000) : null,
          notes: exp.notes,
        });
      }
      if (exp.tsm_user_id) {
        await pushInApp([exp.tsm_user_id], {
          kind: 'expansion_tagged', section: 'Expansion', actor: session.user.email,
          title: `You were tagged on an expansion opportunity — ${visit.legal_name ?? 'client'}`,
          body: exp.product ?? null, link: '/risansi/pipeline',
          entityType: 'opportunity', entityId: String(exp.id),
        });
      }
      await risansiPool.query('UPDATE opportunities SET tsm_notified_at = NOW() WHERE id = $1', [exp.id]);
    }
  } catch (e) {
    console.error('[expansion-tsm] notification failed', e);
  }

  // Summarise the submitted report to the tour manager(s).
  await notifyVisitSubmitted(Number(visit.client_id), null, session.user.email);

  revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath(`/risansi/clients/${visit.cid}`);
  revalidatePath('/risansi/field');
  return { ok: true };
}
