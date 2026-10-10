// Render the schema as ER diagrams — one per domain, plus a core spine.
//
// Exports drawCluster(), used by build-data-dictionary.mjs to embed PNGs into
// the workbook's ER Diagram sheet. One picture of all 53 tables would be a hairball
// nobody can read, so each cluster is drawn on its own and cross-cluster links
// are shown as labelled stubs rather than being hidden.
import sharp from 'sharp';

const NAVY = '#0A3D8F';
const INK = '#0F172A';
const GREY = '#64748B';
const LINE = '#CBD5E1';
const SOFT = '#EFF3FA';
const GOLD = '#B45309';

// Domain → the tables drawn together. The order here is the order of the sheet.
export const CLUSTERS = [
  ['Core spine — what everything hangs off',
    ['clients', 'users', 'tour_routes', 'client_secondary_reps', 'manager_reps', 'contacts', 'visits', 'opportunities', 'orders']],
  ['Sales pipeline',
    ['opportunities', 'opportunity_items', 'opportunity_offer_revisions', 'opportunity_sales_orders',
     'opportunity_purchase_orders', 'opportunity_stage_log', 'opportunity_quotation_files', 'orders', 'order_corrections']],
  ['Visits and field reports',
    ['visits', 'visit_sugar_report', 'visit_nonsugar_report', 'visit_photos', 'equipment', 'tasks']],
  ['Exhibitions',
    ['exhibitions', 'exhibition_team', 'exhibition_approvals', 'exhibition_meetings',
     'exhibition_meeting_cards', 'exhibition_expenses', 'exhibition_expense_files', 'exhibition_reviews']],
  ['Clients, competitors and revenue',
    ['clients', 'client_comments', 'client_pumps', 'client_revenue_monthly', 'competitors',
     'competitor_installed_base', 'competitor_sightings', 'industries']],
  ['Service and support',
    ['complaints', 'complaint_updates', 'complaint_photos', 'bugs', 'bug_screenshots']],
  ['Operations, audit and uploads',
    ['audit_log', 'auth_audit', 'page_activity', 'assignment_audit', 'notifications',
     'notification_runs', 'app_settings', 'revenue_upload_log', 'pump_upload_log',
     'outstanding_upload_log', 'schema_migrations', 'opportunities_merge_archive']],
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Lay a cluster out in columns by dependency depth: a table sits one column to
 * the right of everything it points at, so arrows run right-to-left and the
 * dimensions end up on the left. Depth is computed with a visited set because
 * the schema contains at least one cycle (visits.id <- opportunities.visit_id
 * and opportunities.id <- ... ), which a naive recursion would follow forever.
 */
function layout(tables, edges) {
  const out = new Map(tables.map(t => [t, edges.filter(e => e.from === t).map(e => e.to)]));
  const depth = new Map();
  const compute = (t, seen) => {
    if (depth.has(t)) return depth.get(t);
    if (seen.has(t)) return 0;                       // cycle — stop here
    seen.add(t);
    const targets = (out.get(t) ?? []).filter(x => x !== t);
    const d = targets.length ? 1 + Math.max(...targets.map(x => compute(x, seen))) : 0;
    seen.delete(t);
    depth.set(t, d);
    return d;
  };
  tables.forEach(t => compute(t, new Set()));

  const byDepth = new Map();
  for (const t of tables) {
    const d = depth.get(t) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(t);
  }
  for (const list of byDepth.values()) list.sort();
  return byDepth;
}

/**
 * Draw one cluster. `schema` is the parsed schema dump.
 * Returns { png, width, height } — width/height in the final (1x) pixel space.
 */
export async function drawCluster(schema, title, tables, opts = {}) {
  const present = new Set(tables);
  const fks = schema.constraints.filter(c => c.contype === 'f');

  const edges = [];
  for (const c of fks) {
    if (!present.has(c.table_name)) continue;
    if (present.has(c.ref_table)) {
      edges.push({ from: c.table_name, to: c.ref_table, col: c.columns[0], del: c.confdeltype });
    }
  }
  // Links leaving the cluster, listed on the box so nothing is silently dropped.
  const external = new Map();
  for (const c of fks) {
    if (!present.has(c.table_name) || present.has(c.ref_table)) continue;
    if (!external.has(c.table_name)) external.set(c.table_name, new Set());
    external.get(c.table_name).add(c.ref_table);
  }

  const pk = new Map();
  for (const c of schema.constraints.filter(x => x.contype === 'p')) pk.set(c.table_name, c.columns);

  const byDepth = layout(tables, edges);
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  // Geometry
  const BW = 214, ROW = 15, HEAD = 26, PAD = 9;
  const COL_GAP = 96, ROW_GAP = 22, MARGIN = 26, TITLE_H = 40;

  // Each box lists the key columns only — the Columns sheet has the full list,
  // and a box with 45 rows in it stops being a diagram.
  const boxRows = t => {
    const keys = pk.get(t) ?? [];
    const fkCols = [...new Set(fks.filter(c => c.table_name === t).map(c => c.columns[0]))];
    const rows = [];
    keys.forEach(k => rows.push({ text: k, kind: 'pk' }));
    fkCols.filter(k => !keys.includes(k)).forEach(k => rows.push({ text: k, kind: 'fk' }));
    const ext = [...(external.get(t) ?? [])];
    if (ext.length) rows.push({ text: `→ ${ext.slice(0, 3).join(', ')}${ext.length > 3 ? '…' : ''}`, kind: 'ext' });
    const n = schema.stats[t]?.rows ?? 0;
    rows.push({ text: `${n.toLocaleString('en-IN')} rows`, kind: 'meta' });
    return rows;
  };

  const boxes = new Map();
  let x = MARGIN;
  let maxY = 0;

  if (edges.length === 0) {
    // No relationships to show: lay the tables out as a grid, four across.
    const PER_ROW = 4, GRID_GAP = 26;
    let gx = MARGIN, gy = MARGIN + TITLE_H, rowH = 0;
    tables.slice().sort().forEach((t, i) => {
      if (i && i % PER_ROW === 0) { gx = MARGIN; gy += rowH + GRID_GAP; rowH = 0; }
      const rows = boxRows(t);
      const h = HEAD + rows.length * ROW + PAD;
      boxes.set(t, { x: gx, y: gy, w: BW, h, rows });
      rowH = Math.max(rowH, h);
      gx += BW + GRID_GAP;
    });
    maxY = gy + rowH;
    x = MARGIN + PER_ROW * (BW + GRID_GAP) - GRID_GAP + COL_GAP;
  } else {
    for (const d of depths) {
      let y = MARGIN + TITLE_H;
      for (const t of byDepth.get(d)) {
        const rows = boxRows(t);
        const h = HEAD + rows.length * ROW + PAD;
        boxes.set(t, { x, y, w: BW, h, rows });
        y += h + ROW_GAP;
      }
      maxY = Math.max(maxY, y);
      x += BW + COL_GAP;
    }
  }
  const W = x - COL_GAP + MARGIN;
  const H = Math.max(maxY, MARGIN + TITLE_H + 60) + MARGIN;

  // ── SVG ──
  const p = [];
  p.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  p.push(`<text x="${MARGIN}" y="${MARGIN + 14}" font-family="Segoe UI,Arial" font-size="15" font-weight="700" fill="${NAVY}">${esc(title)}</text>`);
  p.push(`<text x="${MARGIN}" y="${MARGIN + 31}" font-family="Segoe UI,Arial" font-size="10.5" fill="${GREY}">`
    + `${tables.length} tables · ${edges.length} relationships drawn · arrows point from the many side to the one side</text>`);

  // Edges first, so boxes sit on top of the lines.
  const labelSlot = new Map();
  for (const e of edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    if (!a || !b || a === b) continue;
    const ay = a.y + HEAD / 2 + 4;
    const by = b.y + HEAD / 2 + 4;
    let x1, x2, dir;
    if (a.x > b.x) { x1 = a.x; x2 = b.x + b.w; dir = -1; }            // child right of parent
    else if (a.x < b.x) { x1 = a.x + a.w; x2 = b.x; dir = 1; }
    else { x1 = a.x + a.w; x2 = b.x + b.w; dir = 1; }                  // same column
    const midX = x1 + (x2 - x1) / 2;
    const path = a.x === b.x
      ? `M ${x1} ${ay} C ${x1 + 48} ${ay}, ${x2 + 48} ${by}, ${x2} ${by}`
      : `M ${x1} ${ay} C ${midX} ${ay}, ${midX} ${by}, ${x2} ${by}`;
    p.push(`<path d="${path}" fill="none" stroke="${e.del === 'c' ? GOLD : LINE}" stroke-width="1.4"/>`);
    // Crow's foot on the many end (the child).
    // Sign follows dir so the prongs sit OUTSIDE the box. Negated, they pointed
    // back into it and were hidden under the box, which is painted afterwards.
    const f = 7 * dir;
    p.push(`<path d="M ${x1} ${ay} l ${f} -5 M ${x1} ${ay} l ${f} 0 M ${x1} ${ay} l ${f} 5" `
      + `fill="none" stroke="${e.del === 'c' ? GOLD : GREY}" stroke-width="1.3"/>`);
    // The "one" end.
    p.push(`<circle cx="${x2}" cy="${by}" r="2.6" fill="${e.del === 'c' ? GOLD : GREY}"/>`);
    // Two edges spanning the same gap at the same height would print on top of
    // each other; stagger by how many have already claimed this slot.
    const slotKey = `${Math.round(midX / 40)}:${Math.round(((ay + by) / 2) / 14)}`;
    const slot = labelSlot.get(slotKey) ?? 0;
    labelSlot.set(slotKey, slot + 1);
    p.push(`<text x="${midX}" y="${(ay + by) / 2 - 4 + slot * 11}" text-anchor="middle" font-family="Segoe UI,Arial" `
      + `font-size="8.5" fill="${GREY}">${esc(e.col)}</text>`);
  }

  for (const [t, b] of boxes) {
    p.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="5" fill="#ffffff" stroke="${NAVY}" stroke-width="1.2"/>`);
    p.push(`<path d="M ${b.x} ${b.y + 5} a 5 5 0 0 1 5 -5 h ${b.w - 10} a 5 5 0 0 1 5 5 v ${HEAD - 5} h ${-b.w} z" fill="${NAVY}"/>`);
    p.push(`<text x="${b.x + 9}" y="${b.y + 17}" font-family="Segoe UI,Arial" font-size="11" font-weight="700" fill="#ffffff">${esc(t)}</text>`);
    b.rows.forEach((r, i) => {
      const y = b.y + HEAD + 11 + i * ROW;
      if (r.kind === 'meta') {
        p.push(`<text x="${b.x + b.w - 9}" y="${y}" text-anchor="end" font-family="Segoe UI,Arial" font-size="8.5" fill="${GREY}">${esc(r.text)}</text>`);
      } else if (r.kind === 'ext') {
        p.push(`<text x="${b.x + 9}" y="${y}" font-family="Segoe UI,Arial" font-size="8.5" font-style="italic" fill="${GOLD}">${esc(r.text)}</text>`);
      } else {
        p.push(`<rect x="${b.x + 6}" y="${y - 9}" width="${b.w - 12}" height="13" fill="${i % 2 ? SOFT : '#ffffff'}"/>`);
        p.push(`<text x="${b.x + 9}" y="${y}" font-family="Consolas,monospace" font-size="9" fill="${INK}">`
          + `<tspan font-weight="700" fill="${r.kind === 'pk' ? NAVY : GREY}">${r.kind.toUpperCase()}</tspan> ${esc(r.text)}</text>`);
      }
    });
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p.join('')}</svg>`;
  // 2x then down to 1x keeps the text crisp when Excel scales the image.
  const png = await sharp(Buffer.from(svg), { density: 144 })
    .resize(Math.round(W * (opts.scale ?? 1.6)))
    .png()
    .toBuffer();
  return { png, width: W, height: H, tables: tables.length, edges: edges.length };
}
