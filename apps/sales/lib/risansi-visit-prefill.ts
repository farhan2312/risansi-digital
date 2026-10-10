// Copy-forward of a visit's per-visit pump data (competitor equipment + sugar /
// non-sugar pump counts) from the client's most recent submitted visit. The RIL
// installed base lives at the client level (client_pumps) so it already persists;
// this handles the two per-visit stores that would otherwise start blank.
//
// Runs at most once per visit, guarded by visits.prefilled_from_visit_id, and
// only on a genuinely empty, not-yet-submitted visit — so it never clobbers data
// the rep has already started entering.

import type { PoolClient } from 'pg';
import risansiPool from '@/lib/db-risansi';

// Every equipment column carried forward — excludes id (serial), visit_id (set to
// the new visit) and is_opportunity (reset; the submit flow re-derives EOL opps).
const EQUIP_COLS =
  'client_id, pump_type, supplier, is_ril, model, qty, application, capacity_m3h, ' +
  'head_m, kw, drive_system, moc, condition, condition_remark, performance_feedback, ' +
  'reason_for_competitor, competitor_activity_type';

// Copy the single per-visit report row (all columns except id/visit_id) forward.
// `table` is a hard-coded literal and column names come from the catalog, so the
// interpolation is injection-safe.
async function copyReportRow(
  client: PoolClient,
  table: 'visit_sugar_report' | 'visit_nonsugar_report',
  prevId: number,
  curId: number,
): Promise<void> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND column_name NOT IN ('id', 'visit_id')
      ORDER BY ordinal_position`,
    [table],
  );
  if (!rows.length) return;
  const list = rows.map(r => `"${r.column_name}"`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${list}, visit_id)
     SELECT ${list}, $1 FROM ${table} WHERE visit_id = $2`,
    [curId, prevId],
  );
}

export async function prefillVisitFromPrevious(currentVisitId: number, clientId: number): Promise<void> {
  const client = await risansiPool.connect();
  try {
    await client.query('BEGIN');

    // Lock the visit row and re-check the guard inside the transaction.
    const cur = await client.query<{ prefilled_from_visit_id: number | null; submitted_at: string | null }>(
      `SELECT prefilled_from_visit_id, submitted_at FROM visits WHERE id = $1 FOR UPDATE`,
      [currentVisitId],
    );
    const row = cur.rows[0];
    if (!row || row.prefilled_from_visit_id != null || row.submitted_at != null) {
      await client.query('ROLLBACK');
      return;
    }

    // Only seed a genuinely empty visit — never overwrite work already in progress.
    const started = await client.query<{ eq: boolean; sugar: boolean; nonsugar: boolean }>(
      `SELECT
         EXISTS(SELECT 1 FROM equipment WHERE visit_id = $1 AND is_ril = false) AS eq,
         EXISTS(SELECT 1 FROM visit_sugar_report WHERE visit_id = $1) AS sugar,
         EXISTS(SELECT 1 FROM visit_nonsugar_report WHERE visit_id = $1) AS nonsugar`,
      [currentVisitId],
    );
    const s = started.rows[0];
    if (s.eq || s.sugar || s.nonsugar) {
      await client.query('ROLLBACK');
      return;
    }

    // Most recent submitted visit for this client that could hold data.
    const prev = await client.query<{ id: number }>(
      `SELECT id FROM visits
        WHERE client_id = $1 AND id <> $2 AND submitted_at IS NOT NULL
        ORDER BY visit_date DESC NULLS LAST, id DESC LIMIT 1`,
      [clientId, currentVisitId],
    );
    const prevId = prev.rows[0]?.id;
    if (!prevId) {
      // No source yet — leave the marker null so a later load can still seed once
      // a previous visit exists.
      await client.query('ROLLBACK');
      return;
    }

    await client.query(
      `INSERT INTO equipment (${EQUIP_COLS}, is_opportunity, visit_id, created_at)
       SELECT ${EQUIP_COLS}, false, $1, NOW()
         FROM equipment WHERE visit_id = $2 AND is_ril = false`,
      [currentVisitId, prevId],
    );
    await copyReportRow(client, 'visit_sugar_report', prevId, currentVisitId);
    await copyReportRow(client, 'visit_nonsugar_report', prevId, currentVisitId);

    await client.query(
      `UPDATE visits SET prefilled_from_visit_id = $1 WHERE id = $2`,
      [prevId, currentVisitId],
    );
    await client.query('COMMIT');
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
  } finally {
    client.release();
  }
}
