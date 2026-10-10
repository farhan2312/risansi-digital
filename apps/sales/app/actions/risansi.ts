'use server';

import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getManagerAssignableReps, hasRole, getCurrentUser, canViewClient, whyCannotWorkClient, whyCannotVisitClient, isDepartment, type RisansiRole } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';
import { normalizeClientName, uniqueLeadCode } from '@/lib/risansi-lead-code';
import {
  isProspectiveStatus, isLeadCode, CLIENT_STATUSES,
  allowedStatusesForCode, clientStatusLabel,
} from '@/lib/risansi-client-status';
import { resolveClientPrimaryRep, clientPrimaryRepSql } from '@/lib/risansi-client-rep';
import { freezeCreditForClient, thawOpenCredit } from '@/lib/risansi-attribution';
import { parseSalesOrdersJson, inrToCr, type SoInput, type SalesOrder } from '@/lib/risansi-sales-orders';
import { parseOfferRevisionsJson, type OfferRevisionInput } from '@/lib/risansi-offer-revisions';
import { poInrToCr, type PurchaseOrder } from '@/lib/risansi-purchase-orders';
import { notifyVisitPlanned } from '@/lib/risansi-email';
import { pushInApp } from '@/lib/risansi-inapp';
import { notifyCheckIn, notifyOppClosed, notifySalesOrder, notifyNewLead, notifyQuotationIssued } from '@/lib/risansi-notify';
import { requiredFieldNames, labelsFor, OPP_FIELDS, CREATE_STAGES, isDropReason, type CreateStage, type OppStage } from '@/lib/risansi-opportunity-fields';
import { pctForProbabilityCode } from '@/lib/risansi-probability-codes';
import { normaliseIndustry, istToday, normaliseDate } from '@/lib/risansi-utils';
import { parseMoneyInput, parsePositiveMoney, moneyToCr } from '@/lib/risansi-money';

// ── Helper ─────────────────────────────────────────────────────

/**
 * Does a quoted line item carry ANY data the user typed?
 *
 * This used to test only pump_model / pump_qty / offer_value_inr /
 * detailed_specifications, which silently discarded a row where the user had
 * filled just the speed, the motor or gearbox price, the geared-motor detail or
 * the USD offer — the "I added a second item and it didn't save" bug. Every
 * field now counts, so anything typed is kept; only a wholly untouched row is
 * dropped. Mirrored client-side in NewOpportunityModal so the two can't drift.
 */
function quotedItemHasData(it: object): boolean {
  const FIELDS = [
    'pump_model', 'pump_qty', 'pump_speed', 'geared_motor_detail',
    'motor_price', 'gearbox_vbelt_price', 'offer_value_inr',
    'detailed_specifications',
  ];
  const row = (it ?? {}) as Record<string, unknown>;
  return FIELDS.some(f => String(row[f] ?? '').trim() !== '');
}

interface QuotedItemInput { pump_model?: unknown; pump_qty?: unknown; pump_speed?: unknown; geared_motor_detail?: unknown; motor_price?: unknown; gearbox_vbelt_price?: unknown; offer_value_inr?: unknown; detailed_specifications?: unknown; }
const itemStr = (v: unknown) => { const t = String(v ?? '').trim(); return t ? t : null; };
const itemNum = (v: unknown) => { const f = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(f) ? f : null; };
const itemInt = (v: unknown) => { const p = parseInt(String(v ?? '').replace(/[^0-9\-]/g, ''), 10); return Number.isFinite(p) ? p : null; };

/** The rows in a form's items_json, blanks dropped; null when the form carried no such field. */
function parseItemsJson(raw: FormDataEntryValue | null): QuotedItemInput[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(String(raw) || '[]');
    return Array.isArray(parsed) ? (parsed as QuotedItemInput[]).filter(quotedItemHasData) : [];
  } catch { return []; }
}

/**
 * Replace an opportunity's quoted line items. Shared by saveQuotedDetails and
 * updateOpportunity — the move form and the edit drawer both went through the
 * latter from 26 Aug, which wrote none of this, so the items typed into a move
 * to Quoted were never stored (and Market and Total Offer with them).
 */
async function replaceQuotedItems(oppId: number, items: QuotedItemInput[]): Promise<void> {
  await risansiPool.query('DELETE FROM opportunity_items WHERE opportunity_id = $1', [oppId]);
  let so = 0;
  for (const it of items) {
    await risansiPool.query(
      `INSERT INTO opportunity_items (opportunity_id, sort_order, pump_model, pump_qty, pump_speed,
         geared_motor_detail, motor_price, gearbox_vbelt_price, offer_value_inr, detailed_specifications)
       -- Ten columns, ten placeholders. It read $11 for seven weeks, which made
       -- every save of a quotation that had any quoted items fail outright.
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [oppId, so++, itemStr(it.pump_model), itemInt(it.pump_qty), itemStr(it.pump_speed),
       itemStr(it.geared_motor_detail), itemNum(it.motor_price), itemNum(it.gearbox_vbelt_price),
       itemNum(it.offer_value_inr), itemStr(it.detailed_specifications)],
    );
  }
}

/**
 * Replace an opportunity's revised-offer history with `rows`, and re-point the
 * two legacy mirror columns at the newest revision.
 *
 * opportunities.revised_offer_value_inr / revised_offer_date used to BE the
 * revised offer; they are now a denormalised copy of the last row here, so the
 * Excel export, the opportunity drawer and the quote summary keep reading one
 * column instead of joining. Nothing else may write them. Delete + re-insert
 * runs in a transaction so a failed insert can't leave a quote with no history
 * at all. revised_offer_value_usd was retired with the other USD columns: its
 * six rows were each the rupee figure divided by the conversion rate, so the
 * column never held anything its rupee twin did not.
 *
 * Only call this when the caller actually submitted a revision list; an empty
 * array from a form that HAS the field means "the user removed them all".
 */
async function syncOfferRevisions(
  oppId: number, rows: OfferRevisionInput[], actor: string | null,
): Promise<void> {
  const latest = rows.length ? rows[rows.length - 1] : null;
  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM opportunity_offer_revisions WHERE opportunity_id = $1', [oppId]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO opportunity_offer_revisions (opportunity_id, value_inr, revised_on, note, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [oppId, r.value_inr, r.revised_on, r.note, actor],
      );
    }
    // The newest revision IS the current price, so it drives value_cr too — a
    // quote cut from 10,00,000 to 8,50,000 must forecast at 8,50,000, not at
    // what was first asked. When the last revision is removed the value falls
    // back to the original offer rather than being left stranded at a figure
    // that no longer exists anywhere.
    //
    // final_value_cr is untouched: on a Won deal that is the booked amount, a
    // different fact from what the quote currently says.
    await client.query(
      `UPDATE opportunities
          SET revised_offer_value_inr = $1,
              revised_offer_date      = $2,
              value_cr = COALESCE($3::numeric / 10000000.0,
                                  offer_value_inr / 10000000.0,
                                  value_cr),
              updated_at = NOW()
        WHERE id = $4`,
      [latest?.value_inr ?? null, latest?.revised_on ?? null, latest?.value_inr ?? null, oppId],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  return session.user;
}

// Resolve which user a visit/opportunity is owned by, enforcing role rules:
//   rep      → ALWAYS themselves (session id, email fallback); errors if the
//              account isn't linked — the form's rep_id is ignored.
//   manager  → the submitted rep_id, REQUIRED and validated to fall within
//              their tours. No client-primary fallback (flat owner model).
//   admin/+  → the submitted rep_id, REQUIRED.
async function resolveAssignableRepId(
  user: { role?: string; repId?: number | null; email?: string | null },
  formRepId: string | null,
): Promise<number> {
  const role = user.role ?? 'rep';

  if (role === 'rep') {
    let repId = typeof user.repId === 'number' ? user.repId : null;
    if (!repId && user.email) {
      const { rows } = await risansiPool.query<{ id: number }>(
        'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1',
        [user.email],
      );
      repId = rows[0]?.id ?? null;
    }
    if (!repId) {
      throw new Error('Your account is not linked to a user record. Please contact the system administrator.');
    }
    return repId;
  }

  const parsed = formRepId ? parseInt(formRepId, 10) : NaN;
  const repId: number | null = Number.isInteger(parsed) ? parsed : null;
  if (!repId) {
    throw new Error('Please select an owner for this visit/opportunity.');
  }

  if (role === 'manager' && typeof user.repId === 'number') {
    const allowed = await getManagerAssignableReps(user.repId);
    if (!allowed.includes(repId)) {
      throw new Error('You can only assign to people on your team.');
    }
  }

  return repId;
}

// Responsible people come from the client itself: clients.primary_rep_id names
// the one owner, client_secondary_reps names anyone covering it, and manager_reps
// puts a manager above them. Ownership is edited on Reps & Managers. The client's
// route survives as clients.tour_id but no longer grants anybody anything.

// Can this user move / edit an opportunity owned by `oppRepId`?
//   admin/sysadmin → always · assigned rep → own · manager → their own team.
// An opportunity belongs to the client's TOUR, not one owner: anyone who can SEE
// the client (a rep/manager on its tour, a special-access grantee, or admin) may
// edit it. `clientId` is what widens this beyond the assigned rep — pass it
// wherever possible.
// The oppRepId fast-path and the manager fallback remain for callers that don't.
// Read-guard for an opportunity's sub-records (SOs/POs). These are exported
// server actions = callable endpoints, so without this anyone could enumerate a
// deal's commercial data by id. Viewing follows client visibility (edit rights
// are stricter and enforced separately by userCanEditOpp).
async function assertCanViewOpp(oppId: number): Promise<void> {
  const user = await getCurrentUser();
  const { rows } = await risansiPool.query<{ client_id: number | null }>(
    'SELECT client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) throw new Error('Opportunity not found.');
  if (rows[0].client_id == null || !(await canViewClient(user, Number(rows[0].client_id)))) {
    throw new Error('You do not have access to this opportunity.');
  }
}

async function userCanEditOpp(
  user: { role?: string; repId?: number | null; email?: string | null; departments?: string[] },
  oppRepId: number | null,
  clientId?: number | null,
): Promise<boolean> {
  const role = user.role ?? 'rep';
  if (hasRole(role, 'admin')) return true;
  // Being the opportunity's rep is not enough when the client is known: an
  // opportunity on a client that is not theirs is Blocked (whyCannotWorkClient),
  // shown as such on the board, and worked again only once an admin assigns
  // the client. The rep-only fast path survives for callers with no client.
  if (clientId == null && user.repId != null && oppRepId != null && Number(oppRepId) === Number(user.repId)) return true;
  if (clientId != null) {
    return canViewClient(
      { id: user.repId ?? null, email: user.email ?? null, role: role as RisansiRole,
        departments: (user.departments ?? []).filter(isDepartment) },
      Number(clientId),
    );
  }
  if (role === 'manager' && user.repId != null && oppRepId != null) {
    const assignable = await getManagerAssignableReps(user.repId);
    return assignable.includes(Number(oppRepId));
  }
  return false;
}

// Cached set of columns that actually exist on the opportunities table.
// Lets writes degrade gracefully when optional columns aren't present.
let _oppColumns: Set<string> | null = null;
async function opportunityColumns(refresh = false): Promise<Set<string>> {
  if (_oppColumns && !refresh) return _oppColumns;
  try {
    const { rows } = await risansiPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'opportunities'`,
    );
    _oppColumns = new Set(rows.map(r => r.column_name));
  } catch {
    _oppColumns = new Set();
  }
  return _oppColumns;
}

/**
 * Narrow a write to the columns the table actually has — re-reading the schema
 * once before giving up on any it does not recognise.
 *
 * The re-read is the whole point. This cache is filled on the first write a
 * server instance handles and was never invalidated, so an instance that started
 * before a migration kept a column list from before it, and every column that
 * migration added was quietly dropped from the INSERT or UPDATE. The write
 * reported success and the value was never stored.
 *
 * That is exactly what migration 0061 caused: po_date, opportunity_type,
 * opportunity_source, opportunity_category, client_reference, suspect_reason and
 * hold_reason all arrived mid-session, so a PO date entered on the Won form
 * saved on an instance with a fresh cache and vanished on one without. Saving a
 * second time appeared to fix it only because the retry landed elsewhere.
 *
 * Refreshing when something is unrecognised means a new column costs one extra
 * schema read, once per instance, and then behaves. Anything still missing after
 * the re-read is genuinely absent and is logged rather than dropped in silence —
 * degrading gracefully is fine, doing it invisibly is not.
 */
async function writableColumns(wanted: string[]): Promise<string[]> {
  let cols = await opportunityColumns();
  if (cols.size === 0) return wanted;          // schema unreadable: fail open, as before
  if (wanted.some(c => !cols.has(c))) {
    cols = await opportunityColumns(true);
    const missing = wanted.filter(c => !cols.has(c));
    if (missing.length && cols.size > 0) {
      console.warn('[opportunities] these columns do not exist and will not be written:', missing.join(', '));
    }
  }
  return cols.size === 0 ? wanted : wanted.filter(c => cols.has(c));
}

function auditVerb(action: string): string {
  if (/add|creat/i.test(action))        return 'create';
  if (/updat|edit|chang|rename/i.test(action)) return 'update';
  if (/delet|remov/i.test(action))      return 'delete';
  if (/assign/i.test(action))           return 'assign';
  if (/submit|close/i.test(action))     return 'submit';
  return 'activity';
}

async function logActivity(entityType: string, entityId: string, action: string, email: string) {
  // Persist into the unified audit_log (captures actor IP/UA via recordAudit).
  await recordAudit({ action: auditVerb(action), entityType, entityId, summary: action, actorEmail: email });
}

// ── Access request ─────────────────────────────────────────────

export async function requestAccess(_formData: FormData) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  const email = session.user.email.toLowerCase().trim();
  const displayName = session.user.name ?? email;

  // Self-service access requests land as Pending users for a sysadmin to approve.
  await risansiPool.query(
    `INSERT INTO users (email, name, status, role)
     VALUES ($1, $2, 'Pending', 'rep')
     ON CONFLICT (lower(email)) DO NOTHING`,
    [email, displayName],
  );

  await recordAudit({ action: 'create', entityType: 'access_request', entityId: email, summary: 'access_requested', actorEmail: email });

  redirect('/risansi');
}

// ── Client: add contact ────────────────────────────────────────

export async function addContact(formData: FormData): Promise<SaveResult> {
  const user = await requireSession();

  const clientId  = parseInt(formData.get('client_id') as string);
  const name      = (formData.get('name') as string | null)?.trim() ?? '';
  const isPrimary = formData.get('is_primary') === 'true';

  if (isNaN(clientId) || clientId <= 0) return fail('No client was given for this contact.');
  // The reason, not a verdict. "You do not have access to this client" was
  // true and useless: the rep had access to the visit that brought them here.
  const denied = await whyCannotWorkClient(await getCurrentUser(), clientId);
  if (denied) return fail(denied);
  if (!name || name.length < 2) return fail('Contact name is required (at least 2 characters).');

  const designation = (formData.get('designation') as string | null)?.trim() || null;
  const phone       = (formData.get('phone')       as string | null)?.trim() || null;
  const email       = (formData.get('email')       as string | null)?.trim() || null;
  const whatsapp    = (formData.get('whatsapp')    as string | null)?.trim() || null;
  const notes       = (formData.get('notes')       as string | null)?.trim() || null;

  // Clear existing primary first
  if (isPrimary) {
    await risansiPool.query(
      `UPDATE contacts SET is_primary = FALSE WHERE client_id = $1`,
      [clientId],
    );
  }

  await risansiPool.query(
    `INSERT INTO contacts
       (client_id, name, designation, is_primary,
        phone, email, whatsapp, notes,
        added_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
    [clientId, name, designation, isPrimary, phone, email, whatsapp, notes, user.email ?? 'system'],
  );

  await logActivity('client', String(clientId), `Contact Added: ${name}${designation ? ` (${designation})` : ''}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
  return { ok: true };
}

// ── Client: update an existing contact ─────────────────────────

export async function updateContact(contactId: number, clientId: number, formData: FormData): Promise<SaveResult> {
  const user = await requireSession();
  // Resolve the contact's real owner server-side — never trust the clientId the
  // caller passed — and require access to it. Without this any rep could rewrite
  // any contact by id.
  const owner = (await risansiPool.query<{ client_id: number }>('SELECT client_id FROM contacts WHERE id = $1', [contactId])).rows[0];
  if (!owner) return fail('This contact no longer exists — it may have been deleted by somebody else.');
  const denied = await whyCannotWorkClient(await getCurrentUser(), owner.client_id);
  if (denied) return fail(denied);
  clientId = owner.client_id;

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name || name.length < 2) return fail('Contact name is required (at least 2 characters).');

  const designation = (formData.get('designation') as string | null)?.trim() || null;
  const phone       = (formData.get('phone')       as string | null)?.trim() || null;
  const email       = (formData.get('email')       as string | null)?.trim() || null;
  const whatsapp    = (formData.get('whatsapp')    as string | null)?.trim() || null;
  const notes       = (formData.get('notes')       as string | null)?.trim() || null;
  const isPrimary   = formData.get('is_primary') === 'true';

  // Only one primary per client — clear others first
  if (isPrimary) {
    await risansiPool.query(
      `UPDATE contacts SET is_primary = FALSE WHERE client_id = $1 AND id != $2`,
      [clientId, contactId],
    );
  }

  await risansiPool.query(
    `UPDATE contacts SET
       name = $1, designation = $2, is_primary = $3,
       phone = $4, email = $5, whatsapp = $6, notes = $7,
       updated_at = NOW()
     WHERE id = $8 AND client_id = $9`,
    [name, designation, isPrimary, phone, email, whatsapp, notes, contactId, clientId],
  );

  await logActivity('client', String(clientId), `Contact Updated: ${name}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
  return { ok: true };
}

// ── Client: delete a contact ───────────────────────────────────

export async function deleteContact(contactId: number, clientId: number): Promise<SaveResult> {
  const user = await requireSession();
  const owner = (await risansiPool.query<{ client_id: number }>('SELECT client_id FROM contacts WHERE id = $1', [contactId])).rows[0];
  if (!owner) return { ok: true };   // already gone, which is what was asked for
  const denied = await whyCannotWorkClient(await getCurrentUser(), owner.client_id);
  if (denied) return fail(denied);
  await risansiPool.query('DELETE FROM contacts WHERE id = $1 AND client_id = $2', [contactId, owner.client_id]);
  await logActivity('client', String(owner.client_id), 'Contact Deleted', user.email!);
  revalidatePath(`/risansi/clients/${owner.client_id}`);
  return { ok: true };
}

// ── Client: shared contact processing ──────────────────────────
// Used by both addClient and updateClient. Takes the full contact list
// (existing + new) plus the ids the user removed, and reconciles the
// contacts table: delete removed, update existing (id && !isNew),
// insert new. Only one primary is allowed per client.

interface ContactPayload {
  id?: number;
  name?: string;
  designation?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  is_primary?: boolean;
  isNew?: boolean;
}

async function saveContacts(
  clientId: number,
  contactsJson: string,
  deletedIds: number[],
  userEmail: string,
): Promise<void> {
  let contacts: ContactPayload[] = [];
  try {
    const parsed = JSON.parse(contactsJson || '[]');
    if (Array.isArray(parsed)) contacts = parsed;
  } catch { contacts = []; }

  // Delete removed contacts
  if (deletedIds.length > 0) {
    await risansiPool.query(
      `DELETE FROM contacts WHERE id = ANY($1::int[]) AND client_id = $2`,
      [deletedIds, clientId],
    );
  }

  // If any contact is set as primary, clear existing primary first
  const hasPrimary = contacts.some(c => c.is_primary);
  if (hasPrimary) {
    await risansiPool.query(
      `UPDATE contacts SET is_primary = FALSE WHERE client_id = $1`,
      [clientId],
    );
  }

  for (const ct of contacts) {
    if (!ct.name?.trim()) continue;

    if (ct.id && !ct.isNew) {
      // Update existing contact
      await risansiPool.query(
        `UPDATE contacts SET
           name        = $1, designation = $2,
           phone       = $3, email       = $4,
           whatsapp    = $5, is_primary  = $6,
           updated_at  = NOW()
         WHERE id = $7 AND client_id = $8`,
        [
          ct.name.trim(),
          ct.designation?.trim() || null,
          ct.phone?.trim() || null,
          ct.email?.trim() || null,
          ct.whatsapp?.trim() || null,
          ct.is_primary ?? false,
          ct.id, clientId,
        ],
      );
    } else {
      // Insert new contact
      await risansiPool.query(
        `INSERT INTO contacts
           (client_id, name, designation, phone, email, whatsapp, is_primary,
            added_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
        [
          clientId,
          ct.name.trim(),
          ct.designation?.trim() || null,
          ct.phone?.trim() || null,
          ct.email?.trim() || null,
          ct.whatsapp?.trim() || null,
          ct.is_primary ?? false,
          userEmail,
        ],
      );
    }
  }
}

function parseDeletedIds(raw: FormDataEntryValue | null): number[] {
  try {
    const parsed = JSON.parse((raw as string) || '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch { return []; }
}

// ── Client: update client details ─────────────────────────────

/**
 * Write a client's primary rep and covering reps from a submitted form.
 *
 * Shared by add and update so the two cannot drift: a create that sets an owner
 * and an edit that quietly does not is exactly how clients ended up unassigned
 * without anybody noticing.
 *
 * An absent secondary_rep_ids field leaves the covering list alone; a present
 * one replaces it, including with an empty list. That distinction is why the
 * form posts JSON rather than a multi-select, which sends nothing when empty.
 */
async function saveClientOwnership(clientId: number, formData: FormData, actorEmail: string): Promise<void> {
  const rawPrimary = formData.get('primary_rep_id');
  if (rawPrimary !== null) {
    const primary = rawPrimary === '' ? null : parseInt(String(rawPrimary), 10);
    const next = Number.isInteger(primary as number) ? primary : null;
    // Closed work stays with the owner this save replaces, and the only place
    // to read that owner is before the UPDATE. freezeCreditForClient does
    // nothing when the owner is unchanged, which is almost every save here:
    // the form posts the field whether or not it was touched.
    await freezeCreditForClient(risansiPool, clientId, next);
    await risansiPool.query(
      'UPDATE clients SET primary_rep_id = $2, updated_at = NOW() WHERE id = $1',
      [clientId, next],
    );
    await thawOpenCredit(risansiPool, clientId);
  }

  const rawSecondary = formData.get('secondary_rep_ids');
  if (rawSecondary === null) return;
  let ids: number[] = [];
  try {
    const parsed = JSON.parse(String(rawSecondary) || '[]');
    if (Array.isArray(parsed)) {
      ids = [...new Set(parsed.map(n => parseInt(String(n), 10)).filter(n => Number.isInteger(n) && n > 0))];
    }
  } catch { ids = []; }

  // Never both owner and cover on the same client.
  const { rows } = await risansiPool.query<{ primary_rep_id: number | null }>(
    'SELECT primary_rep_id FROM clients WHERE id = $1', [clientId]);
  const owner = rows[0]?.primary_rep_id ?? null;

  await risansiPool.query('DELETE FROM client_secondary_reps WHERE client_id = $1', [clientId]);
  for (const repId of ids.filter(n => n !== owner)) {
    await risansiPool.query(
      `INSERT INTO client_secondary_reps (client_id, rep_id, added_by)
       VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)))
       ON CONFLICT DO NOTHING`,
      [clientId, repId, actorEmail],
    );
  }
}

/**
 * Returns its errors rather than throwing them, for the same reason addClient
 * does: a thrown message is redacted in production and the person editing sees
 * only that something went wrong.
 */
export async function updateClient(clientId: number, formData: FormData): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    return fail('Only an admin can edit a client.');
  }
  const email = session!.user.email ?? 'system';

  // Fetch the current row for change logging (status + all editable fields).
  let currentStatus: string | null = null;
  let currentCode:   string | null = null;
  let oldRow: Record<string, unknown> | null = null;
  try {
    const { rows } = await risansiPool.query(
      `SELECT code, status, legal_name, trade_name, group_name, country, state, city, address,
              google_maps_url, market_type, industry, is_sugar, client_type, is_tender,
              capacity_bracket, tcd, klpd, tier, since_year, tour_id, is_end_client
         FROM clients WHERE id = $1`, [clientId],
    );
    oldRow = rows[0] ?? null;
    currentStatus = (rows[0]?.status as string | undefined) ?? null;
    currentCode   = (rows[0]?.code   as string | undefined) ?? null;
  } catch { /* ignore */ }

  const newStatus = (formData.get('status') as string | null)?.trim() || 'ACTIVE';

  // Client code — editable only from the Client Master page (the form there sends a
  // changed value; elsewhere it re-sends the current code, so nothing changes here).
  // Keep the current code if none submitted; never null it. Enforce the UNIQUE.
  const submittedCode = (formData.get('code') as string | null)?.trim().toUpperCase() || null;
  const newCode = submittedCode || currentCode;
  if (newCode && currentCode && newCode !== currentCode) {
    const dup = await risansiPool.query('SELECT 1 FROM clients WHERE UPPER(code) = $1 AND id <> $2', [newCode, clientId]);
    if (dup.rows.length > 0) return fail(`Client code "${newCode}" is already in use.`);
  }

  // Coupling: the status must be valid for the (final) code type — a LEAD_ code can
  // only be Prospective-Lead/Duplicate; a real code can't be Prospective-Lead. Enforced
  // on every save so a raw code edit (LEAD_ → real) can't leave a lead status behind.
  // The guided path for that transition is convertLeadToClient.
  if (!allowedStatusesForCode(newCode).includes(newStatus as never)) {
    return fail(`"${clientStatusLabel(newStatus)}" isn't a valid status for ${isLeadCode(newCode) ? 'a lead (LEAD_) code — use “Convert to Client” to assign an ERP code first' : 'a real client code'}.`);
  }

  // Update the client, and when the code changes cascade it to the denormalised
  // client_code snapshots — atomically, so the code and its copies never diverge.
  const clientTx = await risansiPool.connect();
  try {
    await clientTx.query('BEGIN');
    await clientTx.query(
    `UPDATE clients SET
       code               = $24,
       legal_name         = $1,
       trade_name         = $2,
       group_name         = $3,
       country            = $4,
       state              = $5,
       city               = $6,
       address            = $7,
       google_maps_url    = $8,
       market_type        = $9,
       industry           = $10,
       is_sugar           = $11,
       client_type        = $12,
       is_tender          = $13,
       capacity_bracket   = $14,
       tcd                = $15,
       klpd               = $16,
       status             = $17,
       tier               = $18,
       since_year         = $19,
       tour_id            = $20,
       is_end_client      = $23,
       updated_by         = $21,
       updated_at         = NOW()
     WHERE id = $22`,
    [
      (formData.get('legal_name')        as string | null)?.trim() || null,
      (formData.get('trade_name')        as string | null)?.trim() || null,
      (formData.get('group_name')        as string | null)?.trim() || null,
      (formData.get('country')           as string | null)?.trim() || 'India',
      (formData.get('state')             as string | null)?.trim() || null,
      (formData.get('city')              as string | null)?.trim() || null,
      (formData.get('address')           as string | null)?.trim() || null,
      (formData.get('google_maps_url')   as string | null)?.trim() || null,
      (formData.get('market_type')       as string | null)?.trim() || 'Domestic',
      normaliseIndustry((formData.get('industry') as string | null)?.trim() || null),
      formData.get('is_sugar') === 'true',
      (formData.get('client_type')       as string | null)?.trim() || null,
      formData.get('is_tender') === 'true',
      (formData.get('capacity_bracket')  as string | null)?.trim() || null,
      formData.get('tcd')  ? parseInt(formData.get('tcd')  as string) : null,
      formData.get('klpd') ? parseInt(formData.get('klpd') as string) : null,
      newStatus,
      (formData.get('tier')              as string | null)?.trim() || 'Standard',
      (formData.get('since_year')        as string | null)?.trim() || null,
      formData.get('tour_id') ? parseInt(formData.get('tour_id') as string, 10) : null,
      email,
      clientId,
      formData.get('is_end_client') === 'true',
      newCode,
    ],
    );

    if (newCode && currentCode && newCode !== currentCode) {
      // client_code is a plain text copy (no FK) in these tables. Update every row
      // for this client, plus orphaned rows still carrying the old code with no id.
      for (const tbl of ['client_pumps', 'competitor_installed_base', 'complaints']) {
        await clientTx.query(
          `UPDATE ${tbl} SET client_code = $1 WHERE client_id = $2 OR (client_code = $3 AND client_id IS NULL)`,
          [newCode, clientId, currentCode],
        );
      }
    }

    await clientTx.query('COMMIT');
  } catch (e) {
    await clientTx.query('ROLLBACK');
    throw e;
  } finally {
    clientTx.release();
  }

  await saveClientOwnership(clientId, formData, email);

  // Save contacts
  await saveContacts(
    clientId,
    (formData.get('contacts_json') as string) ?? '[]',
    parseDeletedIds(formData.get('deleted_contact_ids')),
    email,
  );

  // Log status change
  if (currentStatus && newStatus !== currentStatus) {
    try {
      await risansiPool.query(
        `INSERT INTO client_status_log
           (client_id, from_status, to_status, reason, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [clientId, currentStatus, newStatus, 'Updated via edit form', email],
      );
    } catch (e) { console.error('opportunity_stage_log insert failed:', e); }
  }

  // Describe what actually changed, so the activity feed is informative. This
  // diff is purely for logging — it never affects the UPDATE above.
  const gv = (k: string) => (formData.get(k) as string | null)?.trim() || null;
  const gi = (k: string) => (formData.get(k) ? parseInt(formData.get(k) as string, 10) : null);
  const specs: [string, string, unknown][] = [
    ['code', 'Client code', newCode],
    ['legal_name', 'Name', gv('legal_name')],
    ['trade_name', 'Trade name', gv('trade_name')],
    ['group_name', 'Group', gv('group_name')],
    ['country', 'Country', gv('country') || 'India'],
    ['state', 'State', gv('state')],
    ['city', 'City', gv('city')],
    ['address', 'Address', gv('address')],
    ['google_maps_url', 'Maps link', gv('google_maps_url')],
    ['market_type', 'Market', gv('market_type') || 'Domestic'],
    ['industry', 'Industry', gv('industry')],
    ['is_sugar', 'Sugar flag', formData.get('is_sugar') === 'true'],
    ['client_type', 'Client type', gv('client_type')],
    ['is_tender', 'Tender flag', formData.get('is_tender') === 'true'],
    ['capacity_bracket', 'Capacity', gv('capacity_bracket')],
    ['tcd', 'TCD', gi('tcd')],
    ['klpd', 'KLPD', gi('klpd')],
    ['status', 'Status', newStatus],
    ['tier', 'Tier', gv('tier') || 'Standard'],
    ['since_year', 'Since year', gv('since_year')],
    ['tour_id', 'Tour', gi('tour_id')],
    ['is_end_client', 'End-client flag', formData.get('is_end_client') === 'true'],
  ];
  const norm = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v).trim());
  const changed = oldRow ? specs.filter(([col, , nv]) => norm(oldRow![col]) !== norm(nv)).map(([, label]) => label) : [];
  const summary = changed.length
    ? `Client details updated: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` +${changed.length - 6} more` : ''}`
    : 'Client details updated';

  await logActivity('client', String(clientId), summary, email);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/admin/clients');
  return { ok: true };
}

// ── Client comments (free-form notes on the Client 360) ────────
// Anyone who can SEE the client may add a comment; only the original author may
// edit or delete their own. All three events are logged to the activity feed.

// Short single-line preview of a comment for the activity feed.
function commentPreview(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
}

export async function addClientComment(clientId: number, body: string): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');
  if (!Number.isInteger(clientId)) return fail('No client was given for this comment.');
  const denied = await whyCannotWorkClient(user, clientId);
  if (denied) return fail(denied);

  const text = (body ?? '').trim();
  if (!text) return fail('Comment cannot be empty.');
  if (text.length > 5000) return fail('Comment is too long (5,000 characters at most).');

  const session = await getServerSession(authOptions);
  const authorName = session?.user?.name ?? user.email;

  await risansiPool.query(
    `INSERT INTO client_comments (client_id, author_email, author_name, body)
     VALUES ($1, $2, $3, $4)`,
    [clientId, user.email, authorName, text],
  );

  await logActivity('client', String(clientId), `Comment added: "${commentPreview(text)}"`, user.email);
  revalidatePath(`/risansi/clients/${clientId}`);
  return { ok: true };
}

export async function updateClientComment(commentId: number, body: string): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');
  if (!Number.isInteger(commentId)) throw new Error('Invalid comment.');

  const text = (body ?? '').trim();
  if (!text) return fail('Comment cannot be empty.');
  if (text.length > 5000) return fail('Comment is too long (max 5000 characters).');

  const { rows } = await risansiPool.query<{ client_id: number; author_email: string }>(
    'SELECT client_id, author_email FROM client_comments WHERE id = $1', [commentId],
  );
  const row = rows[0];
  if (!row) return fail('Comment not found.');
  // Author-only — enforced here and in the WHERE clause below.
  if (row.author_email.toLowerCase() !== user.email.toLowerCase()) {
    return fail('You can only edit your own comment.');
  }

  const res = await risansiPool.query(
    'UPDATE client_comments SET body = $1, updated_at = now() WHERE id = $2 AND lower(author_email) = lower($3)',
    [text, commentId, user.email],
  );
  if (res.rowCount === 0) return fail('Comment not found.');

  await logActivity('client', String(row.client_id), `Comment edited: "${commentPreview(text)}"`, user.email);
  revalidatePath(`/risansi/clients/${row.client_id}`);
  return { ok: true };
}

export async function deleteClientComment(commentId: number): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user.email) redirect('/api/auth/signin');
  if (!Number.isInteger(commentId)) throw new Error('Invalid comment.');

  const { rows } = await risansiPool.query<{ client_id: number; author_email: string }>(
    'SELECT client_id, author_email FROM client_comments WHERE id = $1', [commentId],
  );
  const row = rows[0];
  if (!row) return { ok: true }; // already gone — treat as success
  if (row.author_email.toLowerCase() !== user.email.toLowerCase()) {
    return fail('You can only delete your own comment.');
  }

  await risansiPool.query(
    'DELETE FROM client_comments WHERE id = $1 AND lower(author_email) = lower($2)',
    [commentId, user.email],
  );

  await logActivity('client', String(row.client_id), 'Comment deleted', user.email);
  revalidatePath(`/risansi/clients/${row.client_id}`);
  return { ok: true };
}

// ── Client: plan visit ─────────────────────────────────────────


// Email about a newly planned visit (best-effort). If the planner is the rep the
// visit is for, the tour's manager(s) are told; if a manager/admin planned it for
// someone else, that rep is told. Any failure is logged and swallowed.
async function notifyVisitPlan(opts: {
  plannerEmail: string; clientId: number; repId: number | null; visitDate: string; purpose: string;
}) {
  try {
    const { plannerEmail, clientId, repId, visitDate, purpose } = opts;
    const planner = (await risansiPool.query<{ id: number; name: string | null }>(
      'SELECT id, name FROM users WHERE lower(email) = lower($1)', [plannerEmail])).rows[0];
    const client = (await risansiPool.query<{ legal_name: string | null; tour_id: number | null }>(
      'SELECT legal_name, tour_id FROM clients WHERE id = $1', [clientId])).rows[0];
    if (!client) return;
    const rep = repId != null ? (await risansiPool.query<{ name: string | null; email: string | null }>(
      'SELECT name, email FROM users WHERE id = $1', [repId])).rows[0] : null;
    const plannedBy = planner?.name || plannerEmail;
    const plannerIsRep = planner?.id != null && repId != null && planner.id === repId;

    if (plannerIsRep) {
      // Who to tell that a rep has planned a visit: the managers of the people
      // who work this client. The tour version bailed out entirely when the
      // client had no route — true of 1,186 clients — so those visits used to be
      // planned in silence.
      const mgrs = (await risansiPool.query<{ id: number; name: string | null; email: string | null }>(
        `SELECT DISTINCT u.id, u.name, u.email FROM users u
          WHERE u.is_active AND u.id IN (
            SELECT mr.manager_id FROM manager_reps mr
             WHERE mr.rep_id = (SELECT primary_rep_id FROM clients WHERE id = $1)
                OR mr.rep_id IN (SELECT rep_id FROM client_secondary_reps WHERE client_id = $1))`,
        [clientId])).rows;
      const inAppMgrs: number[] = [];
      for (const m of mgrs) {
        if (!m.email || m.email.toLowerCase() === plannerEmail.toLowerCase()) continue;
        inAppMgrs.push(m.id);
        await notifyVisitPlanned({
          to: m.email, toName: m.name, plannedBy,
          clientName: client.legal_name, visitDate, purpose,
          repName: rep?.name || plannedBy, audience: 'manager',
        });
      }
      await pushInApp(inAppMgrs, {
        kind: 'visit_planned', section: 'Visit Planner', actor: plannerEmail,
        title: `${rep?.name || plannedBy} planned a visit — ${client.legal_name ?? 'client'}`,
        link: '/risansi/field', entityType: 'client', entityId: String(clientId),
      });
    } else {
      if (!rep?.email || rep.email.toLowerCase() === plannerEmail.toLowerCase()) return;
      await notifyVisitPlanned({
        to: rep.email, toName: rep.name, plannedBy,
        clientName: client.legal_name, visitDate, purpose,
        repName: rep.name, audience: 'rep',
      });
      if (repId != null) await pushInApp([repId], {
        kind: 'visit_planned', section: 'Visit Planner', actor: plannerEmail,
        title: `A visit was planned for you — ${client.legal_name ?? 'client'}`,
        link: '/risansi/field', entityType: 'client', entityId: String(clientId),
      });
    }
  } catch (e) {
    console.error('[visit-plan] notification failed', e);
  }
}

// ── Client: create opportunity ─────────────────────────────────


// ── Client: update tier ────────────────────────────────────────


// Map a client to a tour inline (from the New Opportunity form, when the client
// isn't on one yet). Ownership then derives from the tour — returns the resolved
// owner so the caller can clear the "no tour" block without a full reload.
/**
 * Map a client onto a tour.
 *
 * Anyone who can SEE the client may do this — a rep covering an account can put
 * it on the right route without waiting for an admin, and 1,157 of 2,767 clients
 * are on no route at all.
 *
 * This does NOT reassign the account. Ownership is clients.primary_rep_id and
 * client_secondary_reps, and resolveClientPrimaryRep reads only those; the owner
 * returned below is the one the client already had, reported so the caller can
 * show that it did not move.
 *
 * Refusals are returned rather than thrown: a thrown server-action error is
 * redacted in production and the picker would show nothing useful.
 */
export async function assignClientTour(clientId: number, tourId: number): Promise<
  { ok: true; ownerName: string | null; tourName: string | null } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!(await canViewClient(user, clientId))) return { ok: false, error: 'You do not have access to this client.' };
  const { rows: tr } = await risansiPool.query<{ name: string }>('SELECT name FROM tour_routes WHERE id = $1', [tourId]);
  if (!tr[0]) return { ok: false, error: 'That tour no longer exists.' };
  await risansiPool.query(
    'UPDATE clients SET tour_id = $1, updated_by = $2, updated_at = NOW() WHERE id = $3',
    [tourId, user.email ?? null, clientId],
  );
  const resolved = await resolveClientPrimaryRep(clientId, null);
  let ownerName: string | null = null;
  if (resolved.repId != null) {
    const { rows } = await risansiPool.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [resolved.repId]);
    ownerName = rows[0]?.name ?? null;
  }
  await logActivity('client', String(clientId), `mapped to tour "${tr[0].name}"${ownerName ? ` · owner unchanged (${ownerName})` : ''}`, user.email!);
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi/pipeline');
  return { ok: true, ownerName, tourName: tr[0].name };
}

// ── Pipeline: create opportunity (client_id from form) ─────────

/** Created, or the reason it was not. Returned rather than thrown for the same
 *  reason updateOpportunity returns its refusals: Next redacts a thrown
 *  server-action error in production, so every one of the eight messages below
 *  reached the user as "Could not create the opportunity." — including the ones
 *  that say exactly what to go and fix. */
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * The outcome of an action that returns something on success.
 *
 * Same reasoning as SaveResult and CreateResult: a rule the person broke has to
 * reach them as words, because Next redacts a thrown server-action error in
 * production. Genuine faults still throw and stay in the logs.
 */
export type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });

export async function createPipelineOpportunity(formData: FormData): Promise<CreateResult> {
  const user = await requireSession();

  const clientId = (formData.get('client_id') as string | null)?.trim() ?? '';
  // Prospect is the only way in. An enquiry has arrived; everything else is a
  // move from here, which the stage log records honestly rather than a record
  // that claims to have been born Won.
  const rawStage = (formData.get('stage')     as string | null)?.trim() ?? 'Prospect';
  const stage: CreateStage = (CREATE_STAGES as readonly string[]).includes(rawStage)
    ? rawStage as CreateStage : 'Prospect';
  // `product` (Product / Description) was retired — it duplicated Project Name /
  // Unit and Product Type between them. The column stays NOT NULL for the 1,803
  // rows that have one, so a new row gets the project name, or a plain marker.
  const product  = (formData.get('unit_project') as string | null)?.trim() || 'Enquiry';
  const prodType = (formData.get('product_type') as string | null)?.trim() || null;

  if (!clientId) return fail('Client is required.');

  // You can only file an opportunity for a client you can see — a client on one
  // of your tours or one you've been granted direct special access to. Admin/
  // sysadmin always pass. getCurrentUser maps the session's repId to id.
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) {
    return fail('You do not have access to this client.');
  }

  // Field readers. `s` → trimmed string or null; `nRaw` → any finite number;
  // `nInr`/`crOf` turn a rupee input into Crores (₹1,00,00,000 = 1 Cr).
  const s    = (k: string) => { const v = (formData.get(k) as string | null)?.trim(); return v ? v : null; };
  // parseMoneyInput, not parseFloat: amounts are typed 1,50,000 here and
  // parseFloat('1,50,000') is 1 — five opportunities were saved as Rs 1 that way.
  const nRaw = (k: string) => parseMoneyInput(formData.get(k));
  const crOf = (k: string) => moneyToCr(formData.get(k));
  // Item helpers (values arrive inside items_json, mirroring saveQuotedDetails).
  const iStr = (v: unknown) => { const t = String(v ?? '').trim(); return t ? t : null; };
  const iNum = (v: unknown) => { const f = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(f) ? f : null; };
  const iInt = (v: unknown) => { const p = parseInt(String(v ?? '').replace(/[^0-9\-]/g, ''), 10); return Number.isFinite(p) ? p : null; };

  interface ItemInput { pump_model?: unknown; pump_qty?: unknown; pump_speed?: unknown; geared_motor_detail?: unknown; motor_price?: unknown; gearbox_vbelt_price?: unknown; offer_value_inr?: unknown; detailed_specifications?: unknown; }
  let items: ItemInput[] = [];
  try { const parsed = JSON.parse((formData.get('items_json') as string) || '[]'); if (Array.isArray(parsed)) items = parsed; } catch { /* ignore */ }
  items = items.filter(quotedItemHasData);
  const itemsSum = items.reduce((a, it) => a + (iNum(it.offer_value_inr) ?? 0), 0);
  // A blank OR zero Total Offer falls back to the line-item sum. (`?? ` alone
  // would keep a literal 0, since 0 isn't nullish, and silently ignore items.)
  const offerDirect = nRaw('offer_value_inr');
  const offerInr = offerDirect != null && offerDirect > 0 ? offerDirect : (itemsSum || null);

  // Cumulative required-field gate — the exact rule the form renders, enforced
  // here so a hand-built request can't skip a stage's requirements. The offer
  // counts as filled when line items sum to a value, matching the form.
  const filled = (name: string): boolean => {
    if (name === 'offer_value_inr') return offerInr != null && offerInr > 0;
    const v = formData.get(name);
    if (v == null || String(v).trim() === '') return false;
    // A money field present but zero is not filled in. Kept general rather than
    // named per field: final_value_inr no longer needs it (the Sale Order value
    // is optional at Won), and hard-coding the survivors would just have to be
    // revisited the next time a required money field is added.
    if (OPP_FIELDS.some(f => f.name === name && f.kind === 'inr')) return (parsePositiveMoney(v) ?? 0) > 0;
    return true;
  };
  const missing = requiredFieldNames(stage).filter(n => !filled(n));
  if (missing.length) {
    return fail(`Fill the required field${missing.length > 1 ? 's' : ''} for the ${stage} stage: ${labelsFor(missing).join(', ')}.`);
  }

  // Dates that cannot be in the future. The input carries a `max`, but a typed
  // or hand-built value still arrives here. Compared against today in IST, not
  // UTC: the server is five and a half hours behind, so a PO raised at 9am in
  // Lucknow would otherwise be rejected as future for the rest of the morning.
  const today = istToday();
  for (const f of OPP_FIELDS) {
    if (!f.noFuture) continue;
    const v = (formData.get(f.name) as string | null)?.trim();
    if (v && v > today) {
      return fail(`${f.label} cannot be in the future — ${v} is after ${today}.`);
    }
  }

  // Revised-offer history, if the quotation step captured any.
  const revParsed = parseOfferRevisionsJson(formData.get('offer_revisions_json'));
  if (revParsed.error) return fail(revParsed.error);
  const revRows   = revParsed.rows;
  const latestRev = revRows.length ? revRows[revRows.length - 1] : null;

  // Sales Orders are optional at Won. The PO is what makes a deal Won; the SO
  // follows days or weeks later, and demanding it at the same moment either
  // blocks a real win or invites a placeholder number somebody has to correct.
  // PO Number and PO Date are required instead — enforced by the catalogue gate
  // above, which marks both requiredAt: ['Won']. Any SO rows that ARE supplied
  // still get written.
  let soRows: SoInput[] = [];
  if (stage === 'Won') {
    const parsed = parseSalesOrdersJson(formData.get('sales_orders_json'));
    if (parsed.error) return fail(parsed.error);
    soRows = parsed.rows;
  }

  const value = crOf('value_inr') ?? (offerInr ? offerInr / 10_000_000 : null);
  // Probability is entered as the RIL code (1–4); the stored numeric % is
  // derived from the code so the weighted forecast + % displays keep working.
  // No code, no probability. A stage default used to be written here, which is
  // how 171 quoted opportunities ended up showing 60% on the card and a blank
  // in the drawer: the number was the stage's guess, not anybody's judgement.
  const prob  = pctForProbabilityCode(s('probability_code'));
  const first = items[0] ?? {};

  // Ownership is derived, not asked for. The client is already on a tour and
  // the tour names its owner, so a rep picker on this form could only ever
  // disagree with that. A rep filing their own opportunity still gets it;
  // otherwise the tour decides. A rep's session may carry no numeric repId, so
  // fall back to a lookup by login email — without it a rep would silently have
  // their own work handed to a colleague off the tour roster.
  let creatorRepId = typeof user.repId === 'number' ? user.repId : null;
  if (creatorRepId == null && user.email) {
    const { rows } = await risansiPool.query<{ id: number }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE LIMIT 1',
      [user.email],
    );
    creatorRepId = rows[0]?.id ?? null;
  }
  if (user.role === 'rep' && creatorRepId == null) {
    return fail('Your account is not linked to a user record. Please contact the system administrator.');
  }

  // A rep owns what they file. For anyone else the client names the owner, and
  // resolveClientPrimaryRep falls back to the filer when they cover a client
  // nobody owns yet — which is the case the special-access branch here used to
  // handle, before covering reps could be assigned from the interface.
  const derived = await resolveClientPrimaryRep(clientId, creatorRepId);
  const primaryRepId = user.role === 'rep' ? creatorRepId : derived.repId;

  if (!primaryRepId) {
    return fail(
      'This client has no rep assigned, so the opportunity would have no owner. '
      + 'Set a primary rep on the client first — Admin › Reps & Managers › Unassigned lists every client waiting for one.',
    );
  }

  // Column → value. Only columns that actually exist on the table are written
  // (mirrors updateOpportunity), so an environment missing an optional column
  // still inserts cleanly.
  const candidates: Record<string, unknown> = {
    client_id: clientId, rep_id: primaryRepId,
    product, product_type: prodType, stage, value_cr: value, probability: prob,
    eta_text: s('eta_text'),
    quote_ref: s('quote_ref'), quote_date: s('quote_date'),
    enquiry_no: s('enquiry_no'), enquiry_date: s('enquiry_date'),
    market: s('market'), offer_value_inr: offerInr,
    probability_code: s('probability_code'), ril_rep: s('ril_rep'),
    qtn_prepared_by: s('qtn_prepared_by'), client_status_at_quote: s('client_status_at_quote'),
    qtr: s('qtr'), unit_project: s('unit_project'), location: s('location'),
    // The mirror columns are set by syncOfferRevisions once the row exists —
    // seeded here so a create that carries revisions writes them in one insert.
    revised_offer_value_inr: latestRev?.value_inr ?? null,
    revised_offer_date: latestRev?.revised_on ?? null,
    negotiation_notes: s('negotiation_notes'),
    po_number: s('po_number'), final_value_cr: crOf('final_value_inr'),
    lost_to_competitor: s('lost_to_competitor'),
    lost_to_competitor_other: s('lost_to_competitor_other'),
    lost_reason: s('lost_reason'),
    // quotation_link is deliberately absent. No form has posted it since
    // uploads replaced typed links, and syncQuotationLink is its only writer —
    // reading it from the request meant a crafted POST could point an
    // opportunity's quotation at any address it liked. A new opportunity has no
    // quotation until a document is attached, so the column defaults to null.
    pump_model: iStr(first.pump_model) ?? s('pump_model'), pump_qty: iInt(first.pump_qty),
    // The intake block — asked wherever an opportunity is raised.
    opportunity_type: s('opportunity_type'),
    opportunity_source: s('opportunity_source'),
    opportunity_category: s('opportunity_category'),
    client_reference: s('client_reference'),
    suspect_reason: s('suspect_reason'),
    hold_reason: s('hold_reason'),
    po_date: s('po_date'),
    // The day it arrived defaults to the day it is dated. The form mirrors the
    // two as they are typed; this is the same rule for anything that posts
    // only one of them.
    po_received_date: s('po_received_date') ?? s('po_date'),
    notes: s('notes'), auto_created: false, created_by: user.email,
  };

  // Every date the catalogue knows about, in the shape Postgres wants. A page
  // that ships a `date` column without casting it hands the form a serialised
  // JS Date; without this the whole save is refused (see normaliseDate).
  for (const f of OPP_FIELDS) {
    if (f.kind === 'date' && f.name in candidates) candidates[f.name] = normaliseDate(candidates[f.name]);
  }

  // Every date the catalogue knows about, in the shape Postgres wants. A page
  // that ships a `date` column without casting it hands the form a serialised
  // JS Date; without this the whole save is refused (see normaliseDate).
  for (const f of OPP_FIELDS) {
    if (f.kind === 'date' && f.name in candidates) candidates[f.name] = normaliseDate(candidates[f.name]);
  }

  const cols = await writableColumns(Object.keys(candidates));
  const insertSql = `INSERT INTO opportunities (${cols.join(', ')}, created_at, updated_at)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, NOW(), NOW())
     RETURNING id`;
  const insertVals = cols.map(c => candidates[c]);

  let newOppId: string | null = null;
  if (soRows.length) {
    // Won-on-create: the opportunity row and its Sales Orders commit together,
    // so a Won can never be created without its required SOs.
    const client = await risansiPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(insertSql, insertVals);
      newOppId = rows[0]?.id ?? null;
      if (newOppId) {
        for (const r of soRows) {
          await client.query(
            `INSERT INTO opportunity_sales_orders (opportunity_id, so_number, so_date, so_value_cr, created_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [Number(newOppId), r.so_number, r.so_date, r.so_value_cr, user.email ?? null],
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } else {
    const { rows: oppRows } = await risansiPool.query<{ id: string }>(insertSql, insertVals);
    newOppId = oppRows[0]?.id ?? null;
  }

  // Revised-offer history, if the quotation step captured any.
  if (newOppId && revRows.length) {
    await syncOfferRevisions(Number(newOppId), revRows, user.email ?? null);
  }

  // Quoted line items, if any were entered.
  if (newOppId && items.length) {
    let so = 0;
    for (const it of items) {
      await risansiPool.query(
        `INSERT INTO opportunity_items (opportunity_id, sort_order, pump_model, pump_qty, pump_speed,
           geared_motor_detail, motor_price, gearbox_vbelt_price, offer_value_inr, detailed_specifications)
         -- Same off-by-one as saveQuotedDetails had: ten columns, ten values.
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [newOppId, so++, iStr(it.pump_model), iInt(it.pump_qty), iStr(it.pump_speed),
         iStr(it.geared_motor_detail), iNum(it.motor_price), iNum(it.gearbox_vbelt_price),
         iNum(it.offer_value_inr), iStr(it.detailed_specifications)],
      );
    }
  }

  if (newOppId) {
    try {
      await risansiPool.query(
        `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, notes, changed_by)
         VALUES ($1, NULL, $2, 'Created via pipeline', $3)`,
        [newOppId, stage, user.email],
      );
    } catch (e) { console.error('opportunity_stage_log insert failed:', e); }

    // Notify on a create that lands straight in a notable stage.
    if (stage === 'Won' || stage === 'Lost') {
      await notifyOppClosed(Number(newOppId), user.email ?? '', stage);
    } else if (stage === 'Quoted') {
      await notifyQuotationIssued(Number(newOppId), user.email ?? '');
    }
  }

  // The owner is never guessed now — the client names it — so the log no longer
  // has to caveat where the name came from. The note this replaced explained a
  // tour roster tie-break that cannot happen any more.
  await logActivity('pipeline', clientId, `created opportunity: ${product} · ${stage} · ₹${value ?? 0} Cr`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  // The new id lets the caller attach a quotation PDF to the record it just
  // created — the whole reason the create form has a second step.
  return { ok: true, id: String(newOppId) };
}

// ── Pipeline: move to Quoted + capture the quotation details ───
// Dedicated to the "move to Quoted" flow so unrelated columns are never wiped
// (unlike updateOpportunity, which nulls any candidate field the form omits).
export async function saveQuotedDetails(oppId: number, formData: FormData): Promise<Result> {
  const user = await requireSession();

  const { rows } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) return fail('Opportunity not found.');
  if (rows[0].stage === 'Won' || rows[0].stage === 'Lost') {
    return fail(`This opportunity is already ${rows[0].stage} and its details are locked. `
      + 'Add or change Purchase Orders and Sales Orders from their own panels, '
      + `or move it out of ${rows[0].stage} first.`);
  }
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) {
    return fail('You do not have permission to edit this opportunity.');
  }

  const s = (k: string) => { const v = (formData.get(k) as string | null)?.trim(); return v ? v : null; };
  const n = (k: string) => parseMoneyInput(formData.get(k));   // comma-safe: see lib/risansi-money
  const i = (k: string) => { const v = formData.get(k) as string | null; const p = v ? parseInt(v, 10) : NaN; return Number.isFinite(p) ? p : null; };
  // Item helpers (values arrive inside items_json).
  const iStr = itemStr, iNum = itemNum, iInt = itemInt;
  const items = parseItemsJson(formData.get('items_json')) ?? [];

  const itemsSum = items.reduce((a, it) => a + (iNum(it.offer_value_inr) ?? 0), 0);
  const offerInr = n('offer_value_inr') ?? (itemsSum || null);
  const valueCr  = offerInr != null ? offerInr / 10_000_000 : null;
  const first    = items[0] ?? {};
  // Keep the numeric probability derived from the code (COALESCE so a blank code
  // leaves the existing % intact — same rule as create/update).
  const probPct  = pctForProbabilityCode(s('probability_code'));

  // Revised offers are a list now, not a field. Parse before the UPDATE so a
  // malformed row aborts the save instead of half-applying it.
  const revParsed = parseOfferRevisionsJson(formData.get('offer_revisions_json'));
  if (revParsed.error) return fail(revParsed.error);

  await risansiPool.query(
    `UPDATE opportunities SET
       stage = 'Quoted',
       quote_ref = $1, quote_date = $2, enquiry_no = $3, enquiry_date = $4,
       -- Never written from this form any more. The quotation documents own this
       -- column (syncQuotationLink is the only writer), and the modal used to
       -- round-trip it through a hidden field — so a stale or empty field could
       -- wipe a link that was perfectly good, including the external urls on 678
       -- rows. COALESCE makes that impossible while leaving the parameter
       -- positions of this UPDATE undisturbed.
       quotation_link = COALESCE($5, quotation_link),
       offer_value_inr = $6,
       -- qtn_prepared_by / client_status_at_quote / location / qtr are no longer
       -- asked for on any form, so the modal submits nothing for them. COALESCE
       -- keeps whatever a legacy record already holds instead of blanking it on
       -- the next save. offer_value_usd was retired: USD is derived from the
       -- settings rate for display and was never typed.
       market = $7, ril_rep = COALESCE($8, ril_rep),
       qtn_prepared_by = COALESCE($9, qtn_prepared_by),
       client_status_at_quote = COALESCE($10, client_status_at_quote),
       unit_project = $11,
       location = COALESCE($12, location),
       qtr = COALESCE($13, qtr),
       probability_code = $14,
       product_type    = COALESCE($15, product_type),
       value_cr        = COALESCE($16, value_cr),
       notes           = COALESCE($17, notes),
       pump_model = $18, pump_qty = $19,
       probability = COALESCE($20, probability),
       updated_at = NOW()
     WHERE id = $21`,
    [s('quote_ref'), s('quote_date'), s('enquiry_no'), s('enquiry_date'),
     // $5, quotation_link: always null, so the COALESCE above resolves to the
     // stored value and this UPDATE can never change it. Uploading or removing a
     // document is the only way the link changes, which is what "no new external
     // links" has to mean on the server as well as in the form.
     null, offerInr,
     s('market'), s('ril_rep'), s('qtn_prepared_by'), s('client_status_at_quote'),
     s('unit_project'), s('location'), s('qtr'), s('probability_code'),
     s('product_type'), valueCr, s('notes'),
     iStr(first.pump_model) ?? s('pump_model'), iInt(first.pump_qty) ?? i('pump_qty'), probPct, oppId],
  );

  // revised_offer_date / revised_offer_value_inr are written by this call, from
  // the newest revision — see syncOfferRevisions.
  if (formData.get('offer_revisions_json') !== null) {
    await syncOfferRevisions(oppId, revParsed.rows, user.email ?? null);
  }

  // Replace the opportunity's quoted items.
  await replaceQuotedItems(oppId, items);

  try {
    await risansiPool.query(
      `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, notes, changed_by)
       VALUES ($1, $2, 'Quoted', 'Quoted via board', $3)`,
      [oppId, rows[0].stage, user.email],
    );
  } catch (e) { console.error('opportunity_stage_log insert failed:', e); }

  await logActivity('opportunity', String(oppId), `moved to Quoted${s('quote_ref') ? ` · ${s('quote_ref')}` : ''}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');

  // Notify only the FIRST time an opp reaches Quoted — Negotiating / On Hold
  // already imply it passed through Quoted, so re-entering must not re-fire.
  if (!['Quoted', 'Negotiating', 'On Hold'].includes(rows[0].stage)) {
    await notifyQuotationIssued(Number(oppId), user.email ?? '');
  }
  return ok(null);
}

// ── Pipeline: full opportunity edit ────────────────────────────

/**
 * The outcome of a save, as a value rather than an exception.
 *
 * Next redacts a thrown server-action error in production — the browser gets
 * "An error occurred in the Server Components render" and the reason is gone.
 * Every message below is something the person saving needs to read and act on,
 * so they are returned. Genuine faults (a dead connection, a broken query) still
 * throw: those are for the logs, not for the user.
 */
export type SaveResult = { ok: true } | { ok: false; error: string };
// Deliberately not annotated as SaveResult: the same helper is the failure half
// of CreateResult too, and a refusal is the same shape whatever succeeded would
// have returned.
const fail = (error: string) => ({ ok: false as const, error });

export async function updateOpportunity(oppId: number, formData: FormData): Promise<SaveResult> {
  const user = await requireSession();

  // Lock guard — a Won/Lost opp can't be edited unless it's being moved out of that stage
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!cur[0]) return fail('Opportunity not found.');

  // Edit rights follow the client: anyone who can see it, or an admin.
  if (!(await userCanEditOpp(user, cur[0].rep_id, cur[0].client_id))) {
    return fail('You do not have permission to edit this opportunity.');
  }

  const currentStage = cur[0]?.stage;
  const newStage     = (formData.get('stage') as string | null) ?? currentStage;
  if ((currentStage === 'Won' || currentStage === 'Lost') && newStage === currentStage) {
    // Say what to do instead. "Locked" on its own sends people back to the same
    // button expecting a different result — the PO and Sales Order panels edit a
    // closed deal without unlocking it.
    return fail(`This opportunity is already ${currentStage} and its details are locked. `
      + 'Add or change Purchase Orders and Sales Orders from their own panels, '
      + `or move it out of ${currentStage} first.`);
  }
  // Gate: Quoted is a mandatory gateway. A deal that's been Quoted can be put
  // On Hold and still advance to Won/Lost, so On Hold counts as "past Quoted".
  if (['Negotiating', 'Won', 'Lost'].includes(newStage ?? '')
      && !['Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost'].includes(currentStage ?? '')) {
    return fail('Move this opportunity through Quoted first.');
  }

  // A stage change has to satisfy that stage's required fields — the same
  // catalogue the form renders from, enforced here so a hand-built request
  // cannot skip it. Only on a TRANSITION: re-saving an opportunity that is
  // already at its stage may come from a partial form that never asked for
  // those fields, and failing that would block edits for no reason.
  //
  // This is why "Won with PO details only" was refused. The rule lived in two
  // places — the catalogue said PO Number and PO Date, this function said one
  // Sales Order — and only one of them was ever updated.
  if (newStage && newStage !== currentStage) {
    const filled = (name: string): boolean => {
      const v = formData.get(name);
      if (v == null || String(v).trim() === '') return false;
      if (OPP_FIELDS.some(f => f.name === name && f.kind === 'inr')) return (parsePositiveMoney(v) ?? 0) > 0;
      return true;
    };
    const missing = requiredFieldNames(newStage as OppStage).filter(n => !filled(n));
    if (missing.length) {
      return fail(`Fill the required field${missing.length > 1 ? 's' : ''} for the ${newStage} stage: ${labelsFor(missing).join(', ')}.`);
    }
    // Compared against today in IST: the server runs on UTC and is five and a
    // half hours behind, so a PO raised at 9am in Lucknow would otherwise be
    // rejected as a future date for the rest of the morning.
    const today = istToday();
    for (const f of OPP_FIELDS) {
      if (!f.noFuture) continue;
      const v = normaliseDate(formData.get(f.name));
      if (v && v > today) return fail(`${f.label} cannot be in the future — ${v} is after ${today}.`);
    }
  }

  // Sales Orders are optional at Won — see createPipelineOpportunity for why.
  // Whatever rows are supplied get written with the stage flip; none is fine,
  // and more can be added later through addSalesOrder, which bypasses the Won
  // edit lock.
  const isWonTransition = newStage === 'Won' && currentStage !== 'Won';
  let soRows: SoInput[] = [];
  if (isWonTransition) {
    const parsed = parseSalesOrdersJson(formData.get('sales_orders_json'));
    if (parsed.error) return fail(parsed.error);
    soRows = parsed.rows;
  }

  // Moving to Dropped requires a reason from the fixed list — both entry points
  // (the kanban completion modal and the Edit drawer) ask for it. Enforced only
  // on the transition INTO Dropped, so re-saving an already-dropped opp from a
  // form that doesn't carry the field can't fail; the preserve guard below stops
  // that same case from wiping the stored reason.
  const isDropTransition = newStage === 'Dropped' && currentStage !== 'Dropped';
  if (isDropTransition && !isDropReason(formData.get('drop_reason'))) {
    return fail('Select a reason for dropping this opportunity.');
  }
  // 'Other' is only an answer once it says something.
  if (isDropTransition && formData.get('drop_reason') === 'Other'
      && !((formData.get('drop_reason_other') as string | null) ?? '').trim()) {
    return fail('Say why this opportunity was dropped.');
  }

  const valueInr = parseMoneyInput(formData.get('value_inr'))       ?? NaN;
  const finalInr = parseMoneyInput(formData.get('final_value_inr')) ?? NaN;
  // The forms stopped asking for a separate Value: an enquiry has no value until
  // it is quoted, and after that the Total Offer IS the value. createPipeline-
  // Opportunity already falls back this way; without the same fallback here, a
  // Prospect moved to Quoted kept value_cr = NULL and showed ₹0 on the board
  // while carrying a real offer.
  // The line items, when the form carries them (the move to Quoted and the
  // edit drawer do; the Won/Lost modal does not). A blank Total Offer falls
  // back to their sum, as saveQuotedDetails and createPipelineOpportunity do.
  const items = parseItemsJson(formData.get('items_json'));
  const itemsSum = (items ?? []).reduce((a, it) => a + (itemNum(it.offer_value_inr) ?? 0), 0);
  const offerTyped = parseMoneyInput(formData.get('offer_value_inr'));
  const offerForValue = offerTyped ?? (itemsSum || NaN);
  const revParsed = parseOfferRevisionsJson(formData.get('offer_revisions_json'));
  if (formData.get('offer_revisions_json') !== null && revParsed.error) return fail(revParsed.error);
  // Probability is entered as the RIL code (1–4); the numeric % is derived from
  // it. When the form omits the field entirely (e.g. OppCompletionModal marking
  // Won), both are left untouched — see the preserve guard below.
  const probCodeRaw = formData.get('probability_code');
  const probCode = typeof probCodeRaw === 'string' ? (probCodeRaw.trim() || null) : null;

  // For rep_id: if the form omits it, preserve the opportunity's EXISTING
  // rep_id before falling back to the client's primary rep. (Marking Won via
  // OppCompletionModal sends no rep_id, so without this the existing owner
  // would be overwritten — and wiped to null if the client has no primary.)
  const rawRepId = formData.get('rep_id');
  let repId = rawRepId && rawRepId !== '' ? parseInt(rawRepId as string, 10) : null;
  if (!repId) {
    // Reuse cur[0] (fetched above) instead of re-SELECTing the same row.
    repId = cur[0].rep_id ?? null;
    if (!repId && cur[0].client_id) {
      const { rows: cRows } = await risansiPool.query<{ primary_rep_id: number | null }>(
        `SELECT ${clientPrimaryRepSql('$1')} AS primary_rep_id`,
        [cur[0].client_id],
      );
      repId = cRows[0]?.primary_rep_id ?? null;
    }
  }

  // Candidate columns → values. Only those present on the table are written.
  const candidates: Record<string, unknown> = {
    product:            (formData.get('product') as string | null)?.trim() || null,
    product_type:       (formData.get('product_type') as string | null) || 'PCP',
    stage:              (formData.get('stage') as string | null) || 'Suspect',
    value_cr:           valueInr > 0 ? valueInr / 10_000_000
                        : offerForValue > 0 ? offerForValue / 10_000_000 : null,
    probability:        pctForProbabilityCode(probCode),
    probability_code:   probCode,
    eta_text:           (formData.get('eta_text') as string | null) || null,
    quote_ref:          (formData.get('quote_ref') as string | null) || null,
    quote_date:         (formData.get('quote_date') as string | null) || null,
    unit_project:       (formData.get('unit_project') as string | null) || null,
    negotiation_notes:  (formData.get('negotiation_notes') as string | null) || null,
    notes:              (formData.get('notes') as string | null) || null,
    rep_id:             repId,
    po_number:          (formData.get('po_number') as string | null) || null,
    final_value_cr:     finalInr > 0 ? finalInr / 10_000_000 : null,
    lost_to_competitor: (formData.get('lost_to_competitor') as string | null) || null,
    // Only meaningful beside Others; the form submits '' when the picker moves
    // off it, which clears the name rather than leaving it stranded.
    lost_to_competitor_other: (formData.get('lost_to_competitor_other') as string | null) || null,
    lost_reason:        (formData.get('lost_reason') as string | null) || null,
    drop_reason:        (formData.get('drop_reason') as string | null) || null,
    drop_reason_other:  (formData.get('drop_reason_other') as string | null)?.trim() || null,
    // The intake block and the per-stage reasons. Each guarded below, so a form
    // that does not ask for one leaves the stored value alone.
    opportunity_type:     (formData.get('opportunity_type') as string | null) || null,
    opportunity_source:   (formData.get('opportunity_source') as string | null) || null,
    opportunity_category: (formData.get('opportunity_category') as string | null) || null,
    client_reference:     (formData.get('client_reference') as string | null) || null,
    suspect_reason:       (formData.get('suspect_reason') as string | null) || null,
    hold_reason:          (formData.get('hold_reason') as string | null) || null,
    po_date:              (formData.get('po_date') as string | null) || null,
    po_received_date:     ((formData.get('po_received_date') as string | null) || null)
                            ?? ((formData.get('po_date') as string | null) || null),
    // The quotation's own columns. These were only ever written by
    // saveQuotedDetails, which no form has called since the stage-move form
    // replaced the Quoted modal — so Market and Total Offer typed into a move
    // to Quoted "saved" and were gone on reopening. Same guard as the rest:
    // a form that does not carry the field leaves the stored value alone.
    market:               (formData.get('market') as string | null) || null,
    enquiry_no:           (formData.get('enquiry_no') as string | null)?.trim() || null,
    enquiry_date:         (formData.get('enquiry_date') as string | null) || null,
    offer_value_inr:      offerForValue > 0 ? offerForValue : null,
    pump_model:           itemStr(items?.[0]?.pump_model),
    pump_qty:             itemInt(items?.[0]?.pump_qty),
  };

  // Ownership is no longer set from the Edit drawer — it's derived from the
  // client's tour and shown read-only. When the form doesn't submit these
  // fields at all, leave the stored values untouched (don't wipe the secondary
  // owner or re-derive the primary). OppCompletionModal still sends rep_id
  // explicitly, so its Won transition keeps carrying the owner through.
  if (formData.get('rep_id') === null)           delete candidates.rep_id;
  // Same idea for the drop reason: a form that never asks for it (the Won/Lost
  // modal, the Quoted modal) must not blank an already-recorded reason.
  if (formData.get('drop_reason') === null)      delete candidates.drop_reason;
  if (formData.get('drop_reason_other') === null) delete candidates.drop_reason_other;
  // negotiation_notes was retired from the forms — no form submits it any more,
  // so this preserves whatever legacy records already hold.
  if (formData.get('negotiation_notes') === null) delete candidates.negotiation_notes;
  // Broaden that guard to every field a partial submitter may not carry. The
  // Won/Lost completion modal, for instance, sends no quote_ref / quote_date /
  // unit_project / eta_text — so winning a deal used to blank its quote number
  // and project name. A field the form doesn't submit at all (=== null) is left
  // as it is; an explicit empty string still clears it.
  for (const k of ['product','product_type','stage','eta_text','quote_ref','quote_date',
                   'unit_project','notes','po_number','lost_to_competitor',
                   'lost_to_competitor_other','lost_reason',
                   'opportunity_type','opportunity_source','opportunity_category',
                   'client_reference','suspect_reason','hold_reason','po_date','po_received_date',
                   'market','enquiry_no','enquiry_date']) {
    if (formData.get(k) === null) delete candidates[k];
  }
  // A Total Offer is required at every quote stage, so a blank one is never a
  // request to clear it: only a typed amount or a line-item sum writes it.
  if (!(offerForValue > 0)) delete candidates.offer_value_inr;
  // pump_model / pump_qty mirror the first line item; only a form with items decides them.
  if (items === null) { delete candidates.pump_model; delete candidates.pump_qty; }
  // value_cr / final_value_cr are derived from rupee inputs; guard on the source.
  // Leave value_cr alone only when NEITHER source was submitted.
  if (formData.get('value_inr') === null && formData.get('offer_value_inr') === null) {
    delete candidates.value_cr;
  }
  if (formData.get('final_value_inr') === null) delete candidates.final_value_cr;
  // Probability: only write when a code is actually chosen. A blank/absent code
  // leaves the stored code AND the numeric % untouched — so editing one of the
  // many legacy opps (which have a numeric probability but no code yet) for an
  // unrelated reason never silently wipes its probability, and marking Won via
  // OppCompletionModal (which sends no code) preserves it too.
  if (!probCode) { delete candidates.probability; delete candidates.probability_code; }

  // Every date the catalogue knows about, in the shape Postgres wants. A page
  // that ships a `date` column without casting it hands the form a serialised
  // JS Date; without this the whole save is refused (see normaliseDate).
  for (const f of OPP_FIELDS) {
    if (f.kind === 'date' && f.name in candidates) candidates[f.name] = normaliseDate(candidates[f.name]);
  }

  const cols = await writableColumns(Object.keys(candidates));
  if (cols.length === 0) return { ok: true };

  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const vals = cols.map(c => candidates[c]);
  const updateSql = `UPDATE opportunities SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${cols.length + 1}`;
  if (isWonTransition) {
    // Atomic: the Won stage flip and its Sales Orders commit together, so a
    // failed SO insert can never leave a Won with zero SOs (and then locked).
    const client = await risansiPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(updateSql, [...vals, oppId]);
      for (const r of soRows) {
        await client.query(
          `INSERT INTO opportunity_sales_orders (opportunity_id, so_number, so_date, so_value_cr, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [oppId, r.so_number, r.so_date, r.so_value_cr, user.email ?? null],
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } else {
    await risansiPool.query(updateSql, [...vals, oppId]);
  }

  if (items !== null) await replaceQuotedItems(oppId, items);
  if (formData.get('offer_revisions_json') !== null) await syncOfferRevisions(oppId, revParsed.rows, user.email ?? null);

  await logActivity('opportunity', String(oppId), `updated opportunity · ${candidates.stage}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');

  // Only on a genuine transition into Won/Lost — not every edit of a closed opp.
  if (newStage !== currentStage && (newStage === 'Won' || newStage === 'Lost')) {
    await notifyOppClosed(Number(oppId), user.email ?? '', newStage);
  }
  // First-time transition into Quoted via the Edit drawer → quotation issued.
  if (newStage === 'Quoted' && !['Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost'].includes(currentStage ?? '')) {
    await notifyQuotationIssued(Number(oppId), user.email ?? '');
  }
  return { ok: true };
}

// ── Quoted items, on their own ─────────────────────────────────
// The techno-commercial lines of a quotation — model, quantity, speed, geared
// motor, prices, specification — edited from the drawer's Quoted Items card
// without re-running the whole opportunity form. Same permission as any edit
// of the opportunity; a Won or Lost deal stays locked.
export async function saveQuotedItems(oppId: number, items: unknown): Promise<SaveResult> {
  const user = await requireSession();
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null; offer_value_inr: string | null }>(
    'SELECT stage, rep_id, client_id, offer_value_inr FROM opportunities WHERE id = $1', [oppId]);
  if (!cur[0]) return fail('Opportunity not found.');
  if (!(await userCanEditOpp(user, cur[0].rep_id, cur[0].client_id))) return fail('You do not have permission to edit this opportunity.');
  if (cur[0].stage === 'Won' || cur[0].stage === 'Lost') return fail(`This opportunity is ${cur[0].stage} and its details are locked.`);
  const rows = parseItemsJson(typeof items === 'string' ? items : JSON.stringify(items ?? [])) ?? [];
  await replaceQuotedItems(oppId, rows);
  // The first line names the pump on the card; a blank Total Offer takes the sum.
  const sum = rows.reduce((a, it) => a + (itemNum(it.offer_value_inr) ?? 0), 0);
  await risansiPool.query(
    `UPDATE opportunities
        SET pump_model = $2, pump_qty = $3,
            offer_value_inr = CASE WHEN offer_value_inr IS NULL OR offer_value_inr = 0 THEN NULLIF($4, 0) ELSE offer_value_inr END,
            value_cr = CASE WHEN (value_cr IS NULL OR value_cr = 0) AND $4 > 0 THEN $4 / 10000000 ELSE value_cr END,
            updated_at = NOW()
      WHERE id = $1`,
    [oppId, itemStr(rows[0]?.pump_model), itemInt(rows[0]?.pump_qty), sum]);
  await logActivity('opportunity', String(oppId), `quoted items updated · ${rows.length} line${rows.length === 1 ? '' : 's'}`, user.email!);
  revalidatePath('/risansi/pipeline');
  return { ok: true };
}

// ── Sales Orders (against a Won opportunity) ───────────────────
// SOs fulfil a Won opp over time. They deliberately bypass the Won "edit lock":
// the deal itself is frozen once Won, but SO progress keeps moving until the SO
// values cover the final value (Won · Open → Won · Closed).

async function insertSalesOrders(oppId: number, rows: SoInput[], email: string | null): Promise<void> {
  for (const r of rows) {
    await risansiPool.query(
      `INSERT INTO opportunity_sales_orders (opportunity_id, so_number, so_date, so_value_cr, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [oppId, r.so_number, r.so_date, r.so_value_cr, email],
    );
  }
}

export async function listSalesOrders(oppId: number): Promise<SalesOrder[]> {
  await assertCanViewOpp(oppId);
  const { rows } = await risansiPool.query<SalesOrder>(
    `SELECT id, opportunity_id, so_number, so_date::text AS so_date,
            so_value_cr::float8 AS so_value_cr, created_by
       FROM opportunity_sales_orders WHERE opportunity_id = $1 ORDER BY so_date, id`,
    [oppId],
  );
  return rows;
}

export async function addSalesOrder(oppId: number, formData: FormData): Promise<Result<SalesOrder[]>> {
  const user = await requireSession();
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!cur[0]) return fail('Opportunity not found.');
  if (!(await userCanEditOpp(user, cur[0].rep_id, cur[0].client_id))) return fail('You do not have permission to edit this opportunity.');
  if (cur[0].stage !== 'Won') return fail('Sales Orders can only be recorded against a Won opportunity.');

  const num  = (formData.get('so_number') as string | null)?.trim() ?? '';
  const date = (formData.get('so_date')   as string | null)?.trim() ?? '';
  const inr  = parseFloat(((formData.get('so_value_inr') as string | null) ?? '').replace(/[^0-9.\-]/g, ''));
  if (!num || !date || !Number.isFinite(inr) || inr <= 0) {
    return fail('An SO Number, SO Date and SO Value greater than zero are all required.');
  }
  await insertSalesOrders(oppId, [{ so_number: num, so_date: date, so_value_cr: inrToCr(inr) }], user.email ?? null);
  await logActivity('opportunity', String(oppId), `added sales order ${num}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  await notifySalesOrder(oppId, user.email ?? '', num);
  return ok(await listSalesOrders(oppId));
}

export async function deleteSalesOrder(soId: number): Promise<Result<SalesOrder[]>> {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ opportunity_id: number; rep_id: number | null; client_id: number | null; so_number: string }>(
    `SELECT so.opportunity_id, o.rep_id, o.client_id, so.so_number
       FROM opportunity_sales_orders so JOIN opportunities o ON o.id = so.opportunity_id
      WHERE so.id = $1`,
    [soId],
  );
  if (!rows[0]) return fail('Sales order not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) return fail('You do not have permission to edit this opportunity.');
  await risansiPool.query('DELETE FROM opportunity_sales_orders WHERE id = $1', [soId]);
  await logActivity('opportunity', String(rows[0].opportunity_id), `removed sales order ${rows[0].so_number}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return ok(await listSalesOrders(rows[0].opportunity_id));
}

// Adjust a Won opportunity's final value. The rest of a Won is frozen, but the
// final value (with the SOs) decides Open vs Closed, so it stays editable —
// same permission, bypassing the Won edit lock like the SO actions do.
export async function updateWonFinalValue(oppId: number, formData: FormData): Promise<Result> {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) return fail('Opportunity not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) return fail('You do not have permission to edit this opportunity.');
  if (rows[0].stage !== 'Won') return fail('Only a Won opportunity’s final value can be adjusted here.');

  const inr = parseFloat(((formData.get('final_value_inr') as string | null) ?? '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(inr) || inr <= 0) return fail('Enter a final value greater than zero.');

  await risansiPool.query('UPDATE opportunities SET final_value_cr = $1, updated_at = NOW() WHERE id = $2', [inr / 10_000_000, oppId]);
  await logActivity('opportunity', String(oppId), `final value updated to ₹${Math.round(inr)}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return ok(null);
}

// ── Purchase Orders (customer POs against a Won opportunity) ────
// A free-standing record of the customer's POs, independent of the SO coverage
// maths. Same Won-only gate and permission as the SO actions.

export async function listPurchaseOrders(oppId: number): Promise<PurchaseOrder[]> {
  await assertCanViewOpp(oppId);
  const { rows } = await risansiPool.query<PurchaseOrder>(
    `SELECT id, opportunity_id, po_number, po_date::text AS po_date,
            po_value_cr::float8 AS po_value_cr, created_by
       FROM opportunity_purchase_orders WHERE opportunity_id = $1 ORDER BY po_date, id`,
    [oppId],
  );
  return rows;
}

export async function addPurchaseOrder(oppId: number, formData: FormData): Promise<Result<PurchaseOrder[]>> {
  const user = await requireSession();
  const { rows: cur } = await risansiPool.query<{ stage: string; rep_id: number | null; client_id: number | null }>(
    'SELECT stage, rep_id, client_id FROM opportunities WHERE id = $1', [oppId],
  );
  if (!cur[0]) return fail('Opportunity not found.');
  if (!(await userCanEditOpp(user, cur[0].rep_id, cur[0].client_id))) return fail('You do not have permission to edit this opportunity.');
  if (cur[0].stage !== 'Won') return fail('Purchase Orders can only be recorded against a Won opportunity.');

  const num  = (formData.get('po_number') as string | null)?.trim() ?? '';
  const date = (formData.get('po_date')   as string | null)?.trim() ?? '';
  const inr  = parseFloat(((formData.get('po_value_inr') as string | null) ?? '').replace(/[^0-9.\-]/g, ''));
  if (!num || !date || !Number.isFinite(inr) || inr <= 0) {
    return fail('A PO Number, PO Date and PO Value greater than zero are all required.');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
    return fail('Enter a valid PO Date (YYYY-MM-DD).');
  }
  const cr = poInrToCr(inr);
  if (cr >= 9_999_999) return fail('That PO value is unrealistically large — please check it.');

  await risansiPool.query(
    `INSERT INTO opportunity_purchase_orders (opportunity_id, po_number, po_date, po_value_cr, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [oppId, num, date, cr, user.email ?? null],
  );
  await logActivity('opportunity', String(oppId), `added purchase order ${num}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return ok(await listPurchaseOrders(oppId));
}

export async function deletePurchaseOrder(poId: number): Promise<Result<PurchaseOrder[]>> {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ opportunity_id: number; rep_id: number | null; client_id: number | null; po_number: string }>(
    `SELECT po.opportunity_id, o.rep_id, o.client_id, po.po_number
       FROM opportunity_purchase_orders po JOIN opportunities o ON o.id = po.opportunity_id
      WHERE po.id = $1`,
    [poId],
  );
  if (!rows[0]) return fail('Purchase order not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) return fail('You do not have permission to edit this opportunity.');
  await risansiPool.query('DELETE FROM opportunity_purchase_orders WHERE id = $1', [poId]);
  await logActivity('opportunity', String(rows[0].opportunity_id), `removed purchase order ${rows[0].po_number}`, user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return ok(await listPurchaseOrders(rows[0].opportunity_id));
}

// ── Pipeline: delete opportunity ───────────────────────────────

export async function deleteOpportunity(oppId: number): Promise<Result> {
  const user = await requireSession();
  const { rows } = await risansiPool.query<{ rep_id: number | null; client_id: number | null; stage: string }>(
    'SELECT rep_id, client_id, stage FROM opportunities WHERE id = $1', [oppId],
  );
  if (!rows[0]) return fail('Opportunity not found.');
  if (!(await userCanEditOpp(user, rows[0].rep_id, rows[0].client_id))) {
    return fail('You do not have permission to delete this opportunity.');
  }
  // A Won or Lost deal is locked against edits everywhere else; deleting one
  // hard-removes it AND cascades its Sales Orders (migration 0029), destroying
  // booked-revenue records. Only an admin may delete a closed deal.
  if ((rows[0].stage === 'Won' || rows[0].stage === 'Lost') && !hasRole(user.role, 'admin')) {
    throw new Error('A Won or Lost opportunity is locked. Ask an admin to delete it.');
  }
  await risansiPool.query('DELETE FROM opportunities WHERE id = $1', [oppId]);
  await logActivity('opportunity', String(oppId), 'deleted opportunity', user.email!);
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi');
  return ok(null);
}

// ── Visit plan: edit / delete (planned, not-yet-submitted visits) ──

// Permission for both: admin/sysadmin · the assigned rep · the rep's tour manager.
// Edits are refused once the visit report has been submitted.
export async function updateVisitPlan(visitId: string, formData: FormData): Promise<SaveResult> {
  const user = await requireSession();

  const { rows } = await risansiPool.query<{ rep_id: number | null; submitted_at: string | null; client_id: number }>(
    'SELECT rep_id, submitted_at, client_id FROM visits WHERE id = $1', [visitId],
  );
  const visit = rows[0];
  if (!visit) throw new Error('Visit not found.');
  if (visit.submitted_at) return fail('A submitted visit can no longer be edited.');
  if (!(await userCanEditOpp(user, visit.rep_id, visit.client_id))) {
    return fail('You do not have permission to edit this visit.');
  }

  const visitDate = (formData.get('visit_date') as string | null)?.trim();
  if (!visitDate) return fail('Pick the date of the visit.');
  const purpose = (formData.get('purpose') as string | null)?.trim() || 'Routine';

  // Owner: reps stay locked to themselves; managers/admins may reassign within
  // their allowed set. Blank → keep the current owner.
  let repId = visit.rep_id;
  const role = user.role ?? 'rep';
  if (role !== 'rep') {
    const raw = (formData.get('rep_id') as string | null)?.trim();
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isInteger(parsed)) {
      if (role === 'manager' && typeof user.repId === 'number') {
        const allowed = await getManagerAssignableReps(user.repId);
        if (!allowed.includes(parsed)) {
          return fail('You can only assign to people on your team.');
        }
      }
      repId = parsed;
    }
  }

  await risansiPool.query(
    `UPDATE visits SET visit_date = $1, purpose = $2, rep_id = $3, updated_at = NOW()
     WHERE id = $4 AND submitted_at IS NULL`,
    [visitDate, purpose, repId, visitId],
  );

  await logActivity('client', String(visit.client_id), `visit plan updated · ${visitDate} · ${purpose}`, user.email!);
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/visits');
  revalidatePath(`/risansi/visits/${visitId}`);
  revalidatePath(`/risansi/clients/${visit.client_id}`);
  return { ok: true };
}

export async function deleteVisitPlan(visitId: string): Promise<SaveResult> {
  const user = await requireSession();

  const { rows } = await risansiPool.query<{ rep_id: number | null; submitted_at: string | null; client_id: number }>(
    'SELECT rep_id, submitted_at, client_id FROM visits WHERE id = $1', [visitId],
  );
  const visit = rows[0];
  if (!visit) throw new Error('Visit not found.');
  if (visit.submitted_at) return fail('A submitted visit cannot be deleted.');
  if (!(await userCanEditOpp(user, visit.rep_id))) {
    return fail('You do not have permission to delete this visit.');
  }

  // The visit's own reports and photos cascade automatically, but equipment,
  // competitor sightings and tasks are FK-restricted — a bare DELETE throws once
  // any of them exist (which surfaces as the generic "Server Components render"
  // error). Clear those visit-scoped rows first, and DETACH opportunities rather
  // than delete them, so pipeline records raised off the visit survive. All in
  // one transaction so a failure leaves nothing half-removed.
  const client = await risansiPool.connect();
  let submittedMeanwhile = false;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM equipment            WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM competitor_sightings WHERE visit_id = $1', [visitId]);
    await client.query('DELETE FROM tasks                WHERE visit_id = $1', [visitId]);
    await client.query('UPDATE opportunities SET visit_id = NULL WHERE visit_id = $1', [visitId]);
    // Guard again in SQL so a concurrent submit can't be deleted out from under.
    // Rolled back and reported rather than thrown: a throw here would be caught
    // below, rethrown, and redacted by the time it reached the page.
    const res = await client.query('DELETE FROM visits WHERE id = $1 AND submitted_at IS NULL', [visitId]);
    if (res.rowCount === 0) { submittedMeanwhile = true; await client.query('ROLLBACK'); }
    else await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  if (submittedMeanwhile) {
    return fail('This visit was submitted a moment ago, so it can no longer be deleted. Reload the page to see it.');
  }

  await logActivity('client', String(visit.client_id), 'visit plan deleted', user.email!);
  revalidatePath('/risansi/field');
  revalidatePath('/risansi/visits');
  revalidatePath(`/risansi/clients/${visit.client_id}`);
  return { ok: true };
}

// ── Pipeline: update value / probability ──────────────────────

// ── Visits: assign visit ───────────────────────────────────────

// Refusals are returned, not thrown: a thrown message is redacted in production
// and the drawer would show "Failed to schedule visit" for every one of them.
export async function assignVisit(formData: FormData): Promise<SaveResult> {
  const user = await requireSession();

  const clientId  = (formData.get('client_id')  as string | null)?.trim() ?? '';
  const visitDate = (formData.get('visit_date')  as string | null)?.trim();
  const purpose   = (formData.get('purpose')     as string | null)?.trim() ?? 'Routine';
  const notes     = (formData.get('notes')       as string | null)?.trim() || null;

  // A missing client must surface as an error — never report a fake success.
  if (!clientId) return fail('Please select a client before scheduling a visit.');

  // Only schedule for a client you can see.
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) return fail('You do not have access to this client.');

  const date = visitDate ?? new Date().toISOString().slice(0, 10);

  // Rep assignment rule (enforced server-side regardless of the form):
  //   rep role          → ALWAYS themselves; resolved fresh by login email
  //                       (session.user.repId can't be trusted — see note below),
  //                       never the submitted rep_id.
  //   admin/manager/...  → the submitted dropdown selection.
  // Single explicit owner (flat model): rep → self; manager → required & within
  // team; admin → required. No client-primary fallback.
  let repId: number;
  try {
    repId = await resolveAssignableRepId(user, (formData.get('rep_id') as string | null)?.trim() ?? null);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Please select who this visit is for.');
  }

  // And that person must work the client — owner, covering rep, or their
  // manager. An admin choosing anyone from the list was how a rep ended up on a
  // visit they could open and not save. See whyCannotVisitClient.
  const refusal = await whyCannotVisitClient(repId, Number(clientId));
  if (refusal) return fail(refusal);

  // Try full insert with optional columns; fall back to minimal ONLY if the
  // full insert fails (e.g. a column is missing). Errors propagate to the UI.
  let insertedId: number | null = null;
  try {
    const { rows } = await risansiPool.query<{ id: number }>(
      `INSERT INTO visits
         (client_id, rep_id, visit_date, purpose, status, is_planned, summary, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'planned', TRUE, $5, NOW(), NOW())
       RETURNING id`,
      [clientId, repId, date, purpose, notes],
    );
    insertedId = rows[0]?.id ?? null;
  } catch (err) {
    console.error('assignVisit: full insert failed, retrying minimal —', err);
    const { rows } = await risansiPool.query<{ id: number }>(
      `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
       VALUES ($1, $2, $3, $4, 'planned', NOW())
       RETURNING id`,
      [clientId, repId, date, purpose],
    );
    insertedId = rows[0]?.id ?? null;
  }

  if (!insertedId) return fail('Visit could not be saved — please try again.');

  await logActivity('client', clientId, `visit assigned for ${date} · ${purpose}`, user.email!);
  revalidatePath('/risansi/field');   // calendar lives here now
  revalidatePath('/risansi/visits');  // legacy redirect
  revalidatePath(`/risansi/clients/${clientId}`);
  revalidatePath('/risansi');

  await notifyVisitPlan({ plannerEmail: user.email!, clientId: Number(clientId), repId, visitDate: date, purpose });
  return { ok: true };
}

// ── Mobile: GPS check-in ───────────────────────────────────────

// Create a visit and check into it in one step — the phone's "new visit" flow.
// (checkInVisit in risansi-visits.ts checks into a visit that already exists;
// this one used to share its name, which the build's result check could not
// tell apart.)
//
// Returns the new visit id, or the reason there is none. It used to return
// null for every failure and the phone said "Check-in failed" for all of them.
export async function checkInNewVisit(data: {
  clientId: string;
  repId: string;
  visitDate: string;
  purpose: string;
  gpsLat: number | null;
  gpsLng: number | null;
}): Promise<CreateResult> {
  const user = await requireSession();

  const { clientId, repId, visitDate, purpose, gpsLat, gpsLng } = data;
  if (!clientId) return fail('Pick a client to check in to.');

  // Only check into a client you can see.
  const viewer = await getCurrentUser();
  if (!(await canViewClient(viewer, Number(clientId)))) return fail('You do not have access to this client.');

  // Whose visit it is follows the same rule as Plan Visit: a rep is always
  // themselves, whatever the page sent; a manager may name themselves or
  // someone on their team; an admin anyone. The page sends the signed-in
  // user, so on the phone this is "me" — the rule is for anything else.
  let repNum: number;
  try {
    repNum = await resolveAssignableRepId(user, repId || null);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Your account is not linked to a rep profile, so it cannot check in. Ask a sysadmin to link it under Users & Access.');
  }
  // And that person must work the client — owner, covering rep, or their
  // manager. A rep's own client list is already scoped that way, so this
  // mostly guards the admin phone and the odd stale page.
  const refusal = await whyCannotVisitClient(repNum, Number(clientId));
  if (refusal) return fail(refusal);

  // Insert core visit row
  let visitId: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ id: string }>(
      `INSERT INTO visits (client_id, rep_id, visit_date, purpose, status, created_at)
       VALUES ($1, $2, $3::date, $4, 'checked-in', NOW())
       RETURNING id`,
      [clientId, repNum, visitDate, purpose],
    );
    visitId = rows[0]?.id ?? null;
  } catch (e) {
    console.error('[checkInNewVisit] insert failed', e);
    return fail('Check-in could not be saved — please try again.');
  }
  if (!visitId) return fail('Check-in could not be saved — please try again.');

  // Optionally record GPS (columns may not exist — non-fatal)
  if (visitId && (gpsLat != null || gpsLng != null)) {
    try {
      await risansiPool.query(
        `UPDATE visits SET gps_lat = $1, gps_lng = $2, check_in_time = NOW() WHERE id = $3`,
        [gpsLat, gpsLng, visitId],
      );
    } catch { /* column not yet added */ }
  }

  await logActivity('client', clientId, `checked in: ${purpose}`, user.email!);
  revalidatePath('/risansi/mobile');
  await notifyCheckIn(Number(clientId), repNum, user.email!);
  return { ok: true, id: visitId };
}

// ── Client: submit new opportunity (from NewOpportunityDrawer) ─


// ── Client: add new client ─────────────────────────────────────

/**
 * Returns its errors rather than throwing them.
 *
 * It used to throw, and every message it took the trouble to write was then
 * swallowed: Next redacts a thrown server-action message in production, so a
 * user who typed a code that was already taken saw "An error occurred in the
 * Server Components render" and retried the same code. The messages below are
 * the point of this function — they have to reach the person typing.
 */
export async function addClient(formData: FormData): Promise<SaveResult> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    return fail('Only an admin can add a client.');
  }
  const email = session!.user.email ?? 'system';

  // Client names are always stored uppercase, regardless of what was typed.
  const legalName = normalizeClientName((formData.get('legal_name') as string | null) ?? '');
  if (!legalName) return fail('Legal name is required.');

  const isLead    = formData.get('is_lead') === 'true';
  const rawStatus = (formData.get('status') as string | null)?.trim() || 'ACTIVE';

  let code: string;
  let status: string;
  if (isLead) {
    // Prospective-Lead: auto-generate a unique LEAD_ code from the company name.
    // Check against ALL codes (incl. soft-deleted) since the unique index isn't
    // partial. The status is locked to match the code type.
    const { rows } = await risansiPool.query<{ code: string }>('SELECT code FROM clients');
    const taken = new Set(rows.map(r => String(r.code).toUpperCase()));
    code   = uniqueLeadCode(legalName, c => taken.has(c));
    status = 'PROSPECTIVE_LEAD';
  } else {
    // Real client (Prospective-Client or Active): the admin supplies the code,
    // which must NOT be a LEAD_ code — those are reserved for auto-coded leads.
    code = (formData.get('code') as string | null)?.toUpperCase().trim() ?? '';
    if (!code) return fail('Client code is required.');
    if (isLeadCode(code)) return fail('A LEAD_ code is reserved for leads — choose "Prospective-Lead" to auto-generate one, or enter a real ERP client code.');
    // Check ALL codes (incl. soft-deleted): the clients.code unique index is not
    // partial, so a soft-deleted code would still collide on INSERT — surface the
    // friendly message rather than a raw constraint violation.
    const existing = await risansiPool.query<{ id: number; legal_name: string; archived: string | null }>(
      'SELECT id, legal_name, deleted_at::date::text AS archived FROM clients WHERE UPPER(code) = $1', [code],
    );
    const clash = existing.rows[0];
    if (clash) {
      // An archived client is the confusing half of this. It is invisible
      // everywhere in the portal, so the code looks free, and the unique index
      // is not partial so the insert collides with a row nobody can see. Say
      // which client it is and where to bring it back, rather than leaving
      // somebody to try the same code again.
      return fail(clash.archived
        ? `Code ${code} belongs to ${clash.legal_name}, which was archived on ${new Date(`${clash.archived}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}. It is hidden rather than gone, so the code is still taken — restore it from Admin → Recoverable clients instead of creating a second record, or use a different code.`
        : `Code ${code} is already in use by ${clash.legal_name}.`);
    }
    // A real code can't hold a lead status; anything unknown falls back to ACTIVE.
    status = (rawStatus !== 'PROSPECTIVE_LEAD' && (CLIENT_STATUSES as readonly string[]).includes(rawStatus))
      ? rawStatus : 'ACTIVE';
  }

  const result = await risansiPool.query<{ id: number }>(
    `INSERT INTO clients (
       code, legal_name, trade_name, group_name,
       country, state, city, address, google_maps_url,
       market_type, industry, is_sugar, client_type,
       is_tender, capacity_bracket, tcd, klpd,
       status, tier, since_year, tour_id,
       created_by, created_at, updated_at, is_end_client
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19,
       $20,$21,$22,NOW(),NOW(),$23
     ) RETURNING id`,
    [
      code,
      legalName,
      (formData.get('trade_name')        as string | null)?.trim() || null,
      (formData.get('group_name')        as string | null)?.trim() || null,
      (formData.get('country')           as string | null)?.trim() || 'India',
      (formData.get('state')             as string | null)?.trim() || null,
      (formData.get('city')              as string | null)?.trim() || null,
      (formData.get('address')           as string | null)?.trim() || null,
      (formData.get('google_maps_url')   as string | null)?.trim() || null,
      (formData.get('market_type')       as string | null)?.trim() || 'Domestic',
      normaliseIndustry((formData.get('industry') as string | null)?.trim() || null),
      formData.get('is_sugar') === 'true',
      (formData.get('client_type')       as string | null)?.trim() || null,
      formData.get('is_tender') === 'true',
      (formData.get('capacity_bracket')  as string | null)?.trim() || null,
      formData.get('tcd')  ? parseInt(formData.get('tcd')  as string) : null,
      formData.get('klpd') ? parseInt(formData.get('klpd') as string) : null,
      status,
      (formData.get('tier')              as string | null)?.trim() || 'Standard',
      (formData.get('since_year')        as string | null)?.trim() || null,
      formData.get('tour_id') ? parseInt(formData.get('tour_id') as string, 10) : null,
      email,
      formData.get('is_end_client') === 'true',
    ],
  );

  const clientId = result.rows[0].id;

  await saveClientOwnership(clientId, formData, email);

  // Save contacts
  await saveContacts(
    clientId,
    (formData.get('contacts_json') as string) ?? '[]',
    parseDeletedIds(formData.get('deleted_contact_ids')),
    email,
  );

  await logActivity('client', String(clientId), `created: ${code} · ${legalName}`, email);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/admin/clients');
  revalidatePath('/risansi');
  return { ok: true };

  // Any new prospect (Prospective-Lead or Prospective-Client) → tell the tour manager.
  if (isProspectiveStatus(status)) {
    await notifyNewLead(Number(clientId), email);
  }
}

/**
 * Convert a Prospective-Lead into a Prospective-Client: swap its auto LEAD_ code
 * for the real ERP client code and flip the status. Reuses updateClient's code
 * cascade so the denormalised client_code snapshots stay in sync. Returns the new
 * code so the caller can navigate to the client's new URL.
 */
export async function convertLeadToClient(clientId: number, erpCode: string): Promise<{ newCode: string }> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) throw new Error('Unauthorized');
  const email = session!.user.email ?? 'system';

  if (!Number.isInteger(clientId)) throw new Error('Invalid client.');
  const newCode = (erpCode ?? '').toUpperCase().trim();
  if (!newCode) throw new Error('Enter the ERP client code.');
  if (isLeadCode(newCode)) throw new Error('The new code must be a real ERP client code, not a LEAD_ code.');

  const cur = (await risansiPool.query<{ code: string; status: string; legal_name: string }>(
    'SELECT code, status, legal_name FROM clients WHERE id = $1', [clientId],
  )).rows[0];
  if (!cur) throw new Error('Client not found.');
  if (!isLeadCode(cur.code)) throw new Error('This client already has a real client code — nothing to convert.');

  const dup = await risansiPool.query('SELECT 1 FROM clients WHERE UPPER(code) = $1 AND id <> $2', [newCode, clientId]);
  if (dup.rows.length > 0) throw new Error(`Client code "${newCode}" is already in use.`);

  const oldCode = cur.code;
  const tx = await risansiPool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(
      `UPDATE clients SET code = $1, status = 'PROSPECTIVE_CLIENT', updated_by = $2, updated_at = NOW() WHERE id = $3`,
      [newCode, email, clientId],
    );
    // client_code is a plain text copy (no FK) in these tables — keep it in sync.
    for (const tbl of ['client_pumps', 'competitor_installed_base', 'complaints']) {
      await tx.query(
        `UPDATE ${tbl} SET client_code = $1 WHERE client_id = $2 OR (client_code = $3 AND client_id IS NULL)`,
        [newCode, clientId, oldCode],
      );
    }
    await tx.query('COMMIT');
  } catch (e) {
    await tx.query('ROLLBACK');
    throw e;
  } finally {
    tx.release();
  }

  try {
    await risansiPool.query(
      `INSERT INTO client_status_log (client_id, from_status, to_status, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, cur.status, 'PROSPECTIVE_CLIENT', `Converted lead to client (${oldCode} → ${newCode})`, email],
    );
  } catch (e) { console.error('opportunity_stage_log insert failed:', e); }

  await logActivity('client', String(clientId), `converted lead ${oldCode} → client ${newCode} · ${cur.legal_name}`, email);
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/admin/clients');
  revalidatePath(`/risansi/clients/${oldCode}`);
  revalidatePath(`/risansi/clients/${newCode}`);
  revalidatePath('/risansi');
  return { newCode };
}
