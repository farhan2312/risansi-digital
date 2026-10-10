'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole, getCurrentUser, whyCannotWorkClient } from '@/lib/risansi-auth';

/**
 * A refusal the person can read. Thrown server-action errors are redacted in
 * production, so every rule here is returned rather than thrown — the same
 * shape the opportunity and contact actions use.
 */
export type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
import risansiPool from '@/lib/db-risansi';
import { pumpTextOrNull } from '@/lib/risansi-pump-text';

// Each uploaded row is one installed pump (unique serial), matching the EC/Serial
// ERP export. client_code is the portal code (CUST already reversed by the client);
// customer_code is the raw CUST. Stored in client_pumps, source='upload'.
export interface PumpPayloadRow {
  client_code:   string;
  customer_code: string;
  customer_name: string;
  model:         string;   // pump_model_plate
  sr_no:         string;   // pump_sl_no
  ec_no:         string;   // ec_number
  so_no:         string;   // so_number
  liquid:        string;
  capacity:      string;
  head:          string;
  filename:      string;
}

export interface PumpUploadResult {
  inserted:     number;
  updated:      number;
  skipped:      number;
  skippedCodes: string[];
}

// A dash is not a serial number: see lib/risansi-pump-text for why, and for
// the one definition the form shares with this file.
const textOrNull = pumpTextOrNull;

export async function uploadPumps(rows: PumpPayloadRow[]): Promise<PumpUploadResult> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }
  const email = session!.user!.email!;

  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;
  const skippedCodes: string[] = [];

  // Batch-lookup client IDs by the (reversed) portal code.
  const codes = [...new Set(rows.map(r => r.client_code))];
  const clientRes = await risansiPool.query<{ id: string; code: string }>(
    `SELECT id::text, UPPER(code) AS code
     FROM clients
     WHERE UPPER(code) = ANY($1::text[])
       AND deleted_at IS NULL`,
    [codes.map(c => c.toUpperCase())],
  );
  const codeToId: Record<string, string> = {};
  clientRes.rows.forEach(r => { codeToId[r.code] = r.id; });

  // Open the upload log first so every pump row can carry its upload_id.
  const logRes = await risansiPool.query<{ id: number }>(
    `INSERT INTO pump_upload_log (uploaded_by, filename, rows_total, status)
     VALUES ($1, $2, $3, 'processing') RETURNING id`,
    [email, rows[0]?.filename ?? 'unknown', rows.length],
  );
  const uploadId = logRes.rows[0].id;

  for (const row of rows) {
    const clientId = codeToId[row.client_code.toUpperCase()];
    if (!clientId) {
      skipped++;
      if (!skippedCodes.includes(row.customer_code)) skippedCodes.push(row.customer_code);
      continue;
    }

    // Upsert on serial (partial index uq_client_pumps_serial). Serial-less rows append.
    const res = await risansiPool.query<{ inserted: boolean }>(
      `INSERT INTO client_pumps
         (client_id, client_code, customer_code, customer_name, pump_model_plate,
          pump_sl_no, ec_number, so_number, liquid, capacity, head,
          quantity, source, upload_id, entered_by, entered_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'upload',$12,$13,NOW(),NOW())
       ON CONFLICT (client_id, pump_sl_no)
         WHERE pump_sl_no IS NOT NULL AND pump_sl_no <> ''
       DO UPDATE SET
         client_code      = EXCLUDED.client_code,
         customer_code    = EXCLUDED.customer_code,
         customer_name    = EXCLUDED.customer_name,
         pump_model_plate = EXCLUDED.pump_model_plate,
         ec_number        = EXCLUDED.ec_number,
         so_number        = EXCLUDED.so_number,
         liquid           = EXCLUDED.liquid,
         capacity         = EXCLUDED.capacity,
         head             = EXCLUDED.head,
         entered_by       = EXCLUDED.entered_by,
         entered_at       = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        clientId,
        row.client_code.toUpperCase(),
        textOrNull(row.customer_code),
        textOrNull(row.customer_name),
        textOrNull(row.model),
        textOrNull(row.sr_no),
        textOrNull(row.ec_no),
        textOrNull(row.so_no),
        textOrNull(row.liquid),
        textOrNull(row.capacity),
        textOrNull(row.head),
        uploadId,
        email,
      ],
    );

    if (res.rows[0]?.inserted) inserted++;
    else updated++;
  }

  const status =
    skipped === rows.length ? 'failed' :
    skipped > 0             ? 'partial' : 'success';

  await risansiPool.query(
    `UPDATE pump_upload_log
       SET rows_inserted = $2, rows_updated = $3, rows_skipped = $4,
           skipped_codes = $5, status = $6
     WHERE id = $1`,
    [uploadId, inserted, updated, skipped, skippedCodes, status],
  );

  revalidatePath('/risansi/admin/pumps');
  return { inserted, updated, skipped, skippedCodes };
}

export async function deletePumpUpload(logId: number): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!hasRole(session?.user?.role, 'admin')) {
    throw new Error('Unauthorized');
  }

  await risansiPool.query(`DELETE FROM client_pumps WHERE upload_id = $1`, [logId]);
  await risansiPool.query(`DELETE FROM pump_upload_log WHERE id = $1`, [logId]);

  revalidatePath('/risansi/admin/pumps');
}

// ── Visit-form pump editor (writes straight to client_pumps) ────────
// Used from the RIL section of the visit report so reps can add / correct a
// client's installed pumps on-site. Anyone who can SEE the client may edit.

export interface ClientPumpInput {
  id?:       number | null;   // existing row → update; null/absent → add
  clientId:  number;
  model:     string;          // pump_model_plate
  sr_no:     string;          // pump_sl_no
  ec_no:     string;          // ec_number
  so_no:     string;          // so_number
  liquid:    string;
  capacity:  string;
  head:      string;
}

const t = textOrNull;

export async function saveClientPump(input: ClientPumpInput): Promise<Result<{ id: number }>> {
  const user = await getCurrentUser();
  const denied = await whyCannotWorkClient(user, input.clientId);
  if (denied) return fail(denied);
  const email = user.email ?? null;

  if (input.id) {
    await risansiPool.query(
      `UPDATE client_pumps SET
         pump_model_plate = $2, pump_sl_no = $3, ec_number = $4, so_number = $5,
         liquid = $6, capacity = $7, head = $8, entered_by = $9, entered_at = NOW()
       WHERE id = $1 AND client_id = $10`,
      [input.id, t(input.model), t(input.sr_no), t(input.ec_no), t(input.so_no),
       t(input.liquid), t(input.capacity), t(input.head), email, input.clientId],
    );
    revalidatePath(`/risansi/clients/${input.clientId}`);
    return ok({ id: input.id });
  }

  const code = (await risansiPool.query<{ code: string }>(
    `SELECT code FROM clients WHERE id = $1`, [input.clientId])).rows[0]?.code ?? null;

  const { rows } = await risansiPool.query<{ id: number }>(
    `INSERT INTO client_pumps
       (client_id, client_code, pump_model_plate, pump_sl_no, ec_number, so_number,
        liquid, capacity, head, quantity, source, entered_by, entered_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'visit',$10,NOW(),NOW())
     ON CONFLICT (client_id, pump_sl_no)
       WHERE pump_sl_no IS NOT NULL AND pump_sl_no <> ''
     DO UPDATE SET
       pump_model_plate = EXCLUDED.pump_model_plate, ec_number = EXCLUDED.ec_number,
       so_number = EXCLUDED.so_number, liquid = EXCLUDED.liquid,
       capacity = EXCLUDED.capacity, head = EXCLUDED.head,
       entered_by = EXCLUDED.entered_by, entered_at = NOW()
     RETURNING id`,
    [input.clientId, code, t(input.model), t(input.sr_no), t(input.ec_no), t(input.so_no),
     t(input.liquid), t(input.capacity), t(input.head), email],
  );
  revalidatePath(`/risansi/clients/${input.clientId}`);
  return ok({ id: rows[0].id });
}

export async function deleteClientPump(id: number, clientId: number): Promise<Result> {
  const user = await getCurrentUser();
  const denied = await whyCannotWorkClient(user, clientId);
  if (denied) return fail(denied);
  await risansiPool.query(`DELETE FROM client_pumps WHERE id = $1 AND client_id = $2`, [id, clientId]);
  revalidatePath(`/risansi/clients/${clientId}`);
  return ok(null);
}

// ── Batch entry ────────────────────────────────────────────────

/**
 * One order of identical pumps: the attributes they share, and one row of
 * identity fields per physical pump.
 *
 * Reps were entering six pumps by filling the same seven-field form six times,
 * re-typing model, liquid, capacity and head each round. Those four belong to
 * the order; serial, SO and EC belong to the individual pump. Splitting them
 * that way is what the quantity box makes possible — pick 6 and you get 18
 * boxes, three per pump.
 */
export interface PumpBatchInput {
  clientId: number;
  /** Existing batch being edited; omit to start a new one. */
  batchId?: string | null;
  model:    string;
  liquid:   string;
  capacity: string;
  head:     string;
  /** One entry per physical pump. `id` set = an existing row being updated. */
  pumps: { id?: number | null; sr_no: string; so_no: string; ec_no: string }[];
}

export async function saveClientPumpBatch(
  input: PumpBatchInput,
): Promise<Result<{ batchId: string; saved: number }>> {
  const user = await getCurrentUser();
  const denied = await whyCannotWorkClient(user, input.clientId);
  if (denied) return fail(denied);
  const email = user.email ?? null;

  const shared = [t(input.model), t(input.liquid), t(input.capacity), t(input.head)] as const;
  if (!shared[0] && !input.pumps.some(p => t(p.sr_no))) {
    return fail('Enter at least a pump model or one serial number.');
  }

  // A batch of one is still a batch — it keeps its id so a later edit can grow
  // it into several pumps without the original row detaching from the group.
  const batchId = input.batchId
    ?? (await risansiPool.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0].id;

  const code = (await risansiPool.query<{ code: string }>(
    'SELECT code FROM clients WHERE id = $1', [input.clientId])).rows[0]?.code ?? null;

  // Does the order describe itself? If it does, every row of the quantity is a
  // pump — a rep who enters "model 4152, molasses, quantity 2" and does not know
  // the serials means two pumps, and used to get none, because a row with no
  // identity fields was skipped as a phantom.
  const describedOrder = shared.some(Boolean);

  const client = await risansiPool.connect();
  let saved = 0;
  try {
    await client.query('BEGIN');
    for (const p of input.pumps) {
      // Only a row that says nothing, in an order that says nothing either, is
      // a box the user never filled.
      if (!t(p.sr_no) && !t(p.so_no) && !t(p.ec_no) && !p.id && !describedOrder) continue;

      if (p.id) {
        await client.query(
          `UPDATE client_pumps SET
             pump_model_plate = $2, liquid = $3, capacity = $4, head = $5,
             pump_sl_no = $6, so_number = $7, ec_number = $8,
             batch_id = $9, entered_by = $10, entered_at = NOW()
           WHERE id = $1 AND client_id = $11`,
          [p.id, ...shared, t(p.sr_no), t(p.so_no), t(p.ec_no), batchId, email, input.clientId],
        );
      } else {
        await client.query(
          `INSERT INTO client_pumps
             (client_id, client_code, pump_model_plate, liquid, capacity, head,
              pump_sl_no, so_number, ec_number, quantity, batch_id, source,
              entered_by, entered_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,'visit',$11,NOW(),NOW())
           ON CONFLICT (client_id, pump_sl_no)
             WHERE pump_sl_no IS NOT NULL AND pump_sl_no <> ''
           DO UPDATE SET
             pump_model_plate = EXCLUDED.pump_model_plate, liquid = EXCLUDED.liquid,
             capacity = EXCLUDED.capacity, head = EXCLUDED.head,
             so_number = EXCLUDED.so_number, ec_number = EXCLUDED.ec_number,
             batch_id = EXCLUDED.batch_id, entered_by = EXCLUDED.entered_by,
             entered_at = NOW()`,
          [input.clientId, code, ...shared, t(p.sr_no), t(p.so_no), t(p.ec_no), batchId, email],
        );
      }
      saved++;
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

  // The form used to close on a save that wrote no rows at all, and the list
  // came back empty with nothing said. If nothing was written, say so.
  if (saved === 0) return fail('Nothing was saved — enter a pump model, or a serial, SO or EC number on at least one row.');

  revalidatePath(`/risansi/clients/${input.clientId}`);
  return ok({ batchId, saved });
}
