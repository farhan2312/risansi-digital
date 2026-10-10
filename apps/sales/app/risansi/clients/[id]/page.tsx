import type { CSSProperties } from 'react';
import { probabilityPctSql } from '@/lib/risansi-probability-codes';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Tag, StatusDot } from '@/components/risansi';
import { ConvertLeadButton } from '@/components/risansi/ConvertLeadButton';
import { clientStatusLabel, statusDotKind } from '@/lib/risansi-client-status';
import risansiPool from '@/lib/db-risansi';
import { fyShortLabel, formatRev, formatLastVisit, fmtUsdFromCr } from '@/lib/risansi-utils';
import { getUsdRate } from '@/lib/risansi-settings';
import { OfferRevisionsList } from '@/components/risansi/OfferRevisionsField';
import type { OfferRevision } from '@/lib/risansi-offer-revisions';
import { hasRole, getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import {
  clientPrimaryRepSql, clientRepNamesSql, clientSecondaryNamesSql, clientManagerNamesSql,
} from '@/lib/risansi-client-rep';
import { isLegacyQuotation, quotationHref, quotationLinkCount } from '@/lib/risansi-quotation-link';
import { LegacyMark } from '@/components/risansi/QuotationLinkView';
import { ClientActionButtons, PipelineOppBtn } from '@/components/risansi/ClientActionButtons';
import { AddContactButton } from '@/components/risansi/AddContactButton';
import { EditContactButton } from '@/components/risansi/EditContactButton';
import { BackButton } from '@/components/risansi/BackButton';
import { MobileTabs } from '@/components/risansi/MobileTabs';
import { ClientComplaints } from '@/components/risansi/ClientComplaints';
import { loadComplaintRows, type ComplaintListRow } from '@/lib/risansi-complaint-rows';
import { isEpcOem } from '@/lib/risansi-client-types';
import { ClientPumps, type PumpRow } from '@/components/risansi/ClientPumps';
import { ClientComments, type CommentRow } from '@/components/risansi/ClientComments';
import { ClientActivityRegister, type ActionItem } from '@/components/risansi/ClientActivityRegister';
import { ClientTourBlock } from '@/components/risansi/ClientTourBlock';
import type { DrawerRep } from '@/components/risansi/AssignVisitDrawer';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Data shapes ────────────────────────────────────────────────

interface Client {
  // Core identity
  id: string; code: string; legal_name: string; trade_name: string | null;
  group_name: string | null; business_category: string | null;
  industry: string | null; zone: string; tour_name: string | null; tour_zone: string | null;
  status: string; tier: string | null;
  market_type: string | null; client_type: string | null;
  is_sugar: boolean; is_tender: boolean;
  // EPC/OEM account intelligence (captured on the visit Client Type page)
  focus_industries: string[] | null; avg_annual_pump_req: number | null;
  ongoing_tenders: number | null; upcoming_tenders: boolean | null;
  upcoming_tenders_details: string | null; pcp_suppliers: string | null;
  // Location
  since_year: string | number | null; address: string | null; city: string | null;
  state: string | null; country: string | null;
  capacity_bracket: string | null; google_maps_url: string | null;
  tcd: number | null; klpd: number | null;
  // Reps (DB columns + joined)
  primary_rep_id: string | null; primary_rep_name: string | null;
  owner_name: string | null; secondary_rep_names: string | null;
  secondary_rep_ids: number[] | null;
  rep_name: string | null; manager_name: string | null;
  rep_zone: string | null; rep_route: string | null; rep_email: string | null;
  secondary_rep_joined: string | null; secondary_rep_zone: string | null; secondary_rep_route: string | null;
  sec_rep_name: string | null; sec_rep_zone: string | null;
  // Visit tracking
  last_visit_fy: string | null; last_visit_month: string | null;
  last_visit_date: string | null; planned_visit_2627: string | null;
  visit_count: number | null;
  // Sales intelligence / plan of action
  action_points:          string | null;
  action_target_date_raw: string | null;
  pcp_competitor:         string | null;
  mgmt_intervention:      string | boolean | null;
  mgmt_intervention2:     string | null;
  constraints_notes:      string | null;
  expected_to_pump:       number | null;
  expected_to_spare:      number | null;
  total_outstanding:      number | null;
  outstanding_as_of:      string | null;
  outstanding_owner_name: string | null;
  weightage_score:        number | null;
  competitors_observed:   string | null;
  ice_dispersal_by:       string | null;
  negotiation_by:         string | null;
  // Field intelligence
  performance_feedback: string | null;
  last_visit_summary:   string | null;
  open_remarks:         string | null;
  major_remarks:        string | null;
  complaint_notes:      string | null;
  // System
  created_by: string | null; created_at: string | null;
  updated_at: string | null; deleted_at: string | null;
}

interface Contact {
  id: number;
  name: string;
  designation: string | null;
  is_primary: boolean;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  notes: string | null;
  added_by: string | null;
  created_at: Date;
}

interface RevRow {
  financial_year: string; product_category: string; total: string; order_count: string;
}

interface ClientRevFY {
  fy: string; pump_inr: string; spare_inr: string; total_inr: string;
}

interface CompMaker { name: string; units: number; }
interface CompBreakdown {
  rilUnits: number; totalUnits: number; makers: CompMaker[];        // PCP
  rilMmp: number;   totalMmp: number;   mmpMakers: CompMaker[];     // MMP
}

/** What the most recent visit that logged equipment counted on site. */
interface LastSeen {
  visit_id: string; visit_date: string | null; rep_name: string;
  competitor_pumps: number | null; ril_pumps: number | null; makers: string | null;
}

// competitor_installed_base PCP columns → display label (RIL handled separately, as "us").
const COMPETITOR_PCP: Record<string, string> = {
  roto_pcp: 'Roto', rotomac_pcp: 'Rotomac', gita_pcp: 'Gita', psp_pcp: 'PSP',
  syno_pcp: 'Syno', ropman_pcp: 'Ropman', myto_pcp: 'Myto', vikas_pcp: 'Vikas',
  newpumps_pcp: 'Newpumps', indopump_pcp: 'Indopump', tushaco_pcp: 'Tushaco',
  yaswant_pcp: 'Yaswant', shivam_pcp: 'Shivam', saksham_pcp: 'Saksham', alpha_pcp: 'Alpha',
  gajanan_pcp: 'Gajanan', chandra_helicon_pcp: 'Chandra Helicon', netzsch_pcp: 'Netzsch',
  akanshi_pcp: 'Akanshi', pragati_pcp: 'Pragati', ropar_pcp: 'Ropar', rotor_flow_pcp: 'Rotor Flow',
  naishit_pcp: 'Naishit', delta_pcp: 'Delta', varun_pcp: 'Varun', npi_pcp: 'NPI',
  hydroprocav_pcp: 'Hydroprocav', sre_pcp: 'SRE', span_engg_pcp: 'Span Engg',
  pandey_pcp: 'Pandey', mahalaxmi_pcp: 'Mahalaxmi', ravalgoan_pcp: 'Ravalgoan', others_pcp: 'Others',
};

// competitor_installed_base MMP columns → display label (RIL handled separately).
const COMPETITOR_MMP: Record<string, string> = {
  gita_mmp: 'Gita', sintech_mmp: 'Sintech', psp_mmp: 'PSP', syno_mmp: 'Syno',
  ropman_mmp: 'Ropman', vikas_mmp: 'Vikas', indopump_mmp: 'Indopump', yaswant_mmp: 'Yaswant',
  shivam_mmp: 'Shivam', elite_mmp: 'Elite', mather_mmp: 'Mather', varun_mmp: 'Varun',
  vs_engg_mmp: 'VS Engg', span_engg_mmp: 'Span Engg', pandey_mmp: 'Pandey',
  mahalaxmi_mmp: 'Mahalaxmi', ravalgoan_mmp: 'Ravalgoan', others_mmp: 'Others',
};

interface Visit {
  id: string; rep_name: string; visit_date: Date;
  purpose: string | null; outcome: string | null;
  summary: string | null; status: string; synced: boolean;
  submitted_at: string | null;
}

interface Opportunity {
  id: string; product: string; stage: string;
  value_cr: string; probability: number | null;
  final_value_cr?: string | null; so_sum_cr?: number;
  quotation_link?: string | null; quote_ref?: string | null;
  /** Quotation PDFs held by the portal. Not the same as quotation_link being set. */
  doc_count?: number;
  offer_value_inr?: number | null;
  /** Every re-price of this quote, oldest first. See migration 0041. */
  revisions?: OfferRevision[] | null;
}

interface ActivityEntry {
  id: string; actor_email: string | null; actor_name: string | null;
  action: string; summary: string; entity_type: string; created_at: Date;
}

// ── Page ───────────────────────────────────────────────────────

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params;

  const session  = await getServerSession(authOptions);
  const role     = session?.user?.role ?? '';
  const canEdit  = hasRole(role, 'admin');

  // ── Dual-key client fetch (numeric id OR code string) ─────
  const isNumeric = /^\d+$/.test(id);
  const whereClause = isNumeric ? 'c.id = $1::bigint' : 'c.code = $1';

  const client = await q<Client | null>(async () => {
    const { rows } = await risansiPool.query<Client>(
      `SELECT c.*,
              -- The ONE rep who owns new work here: the client's own owner.
              -- Distinct from rep_name below, which names everyone working it.
              (SELECT u.name FROM users u WHERE u.id = ${clientPrimaryRepSql('c.id')}) AS owner_name,
              COALESCE(${clientRepNamesSql('c.id')}, '—') AS rep_name,
              (SELECT u.name FROM users u WHERE u.id = ${clientPrimaryRepSql('c.id')}) AS primary_rep_name,
              ${clientSecondaryNamesSql('c.id')} AS secondary_rep_names,
              ${clientManagerNamesSql('c.id')} AS manager_name,
              ${clientPrimaryRepSql('c.id')} AS primary_rep_id,
              -- Raw ids for the edit form, which replaces the covering list
              -- wholesale and therefore has to open holding the current one.
              COALESCE((SELECT array_agg(s.rep_id) FROM client_secondary_reps s
                         WHERE s.client_id = c.id), '{}') AS secondary_rep_ids,
              tr.name AS tour_name,
              tr.zone AS tour_zone,
              (SELECT name FROM users WHERE id = c.outstanding_owner_id) AS outstanding_owner_name
       FROM clients c
       LEFT JOIN tour_routes tr ON tr.id = c.tour_id
       WHERE ${whereClause} AND c.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }, null);

  if (!client) notFound();

  // Visibility guard — viewer must be able to SEE this client (admin/sysadmin always can).
  const currentUser = await getCurrentUser();
  const canViewThisClient = await canViewClient(currentUser, Number(client.id));
  if (!canViewThisClient) notFound();

  // Contacts may be managed by admins and by any rep/manager who can see this
  // client. canViewClient restricts reps to clients assigned to them, so a rep
  // can only add/edit/remove contacts for their own assigned clients.
  const canManageContacts = canViewThisClient;

  // ── Fetch supporting data in parallel ─────────────────────

  const [contacts, revRows, clientRevByFY, comp, visits, allOpps, activityLog, reps, complaints, , clientPumps, clientComments, clientActions, lastSeen] = await Promise.all([

    // 2. Contacts — single source of truth
    q<Contact[]>(async () => {
      const { rows } = await risansiPool.query<Contact>(
        `SELECT id, name, designation, is_primary,
                phone, email, whatsapp, notes,
                added_by, created_at
         FROM contacts
         WHERE client_id = $1
         ORDER BY is_primary DESC, created_at ASC`,
        [client.id],
      );
      return rows;
    }, []),

    // 3. Revenue by FY / category (orders table — for order count)
    q<RevRow[]>(async () => {
      const { rows } = await risansiPool.query<RevRow>(
        `SELECT financial_year, product_category,
                COALESCE(SUM(order_value_cr),0)::text AS total,
                COUNT(*)::text AS order_count
         FROM orders WHERE client_id = $1
         GROUP BY financial_year, product_category
         ORDER BY financial_year`,
        [client.id],
      );
      return rows;
    }, []),

    // 3b. Revenue by FY from client_revenue_monthly (authoritative values)
    q<ClientRevFY[]>(async () => {
      const { rows } = await risansiPool.query<ClientRevFY>(
        `SELECT
           LPAD((EXTRACT(YEAR FROM month)::int % 100)::text, 2, '0') || '-' ||
           LPAD(((EXTRACT(YEAR FROM month)::int + 1) % 100)::text, 2, '0') AS fy,
           COALESCE(SUM(pump_value),  0)::text AS pump_inr,
           COALESCE(SUM(spare_value), 0)::text AS spare_inr,
           COALESCE(SUM(total_value), 0)::text AS total_inr
         FROM client_revenue_monthly
         WHERE client_id = $1
           AND EXTRACT(MONTH FROM month) >= 4
         GROUP BY 1
         UNION ALL
         SELECT
           LPAD(((EXTRACT(YEAR FROM month)::int - 1) % 100)::text, 2, '0') || '-' ||
           LPAD((EXTRACT(YEAR FROM month)::int % 100)::text, 2, '0') AS fy,
           COALESCE(SUM(pump_value),  0)::text AS pump_inr,
           COALESCE(SUM(spare_value), 0)::text AS spare_inr,
           COALESCE(SUM(total_value), 0)::text AS total_inr
         FROM client_revenue_monthly
         WHERE client_id = $1
           AND EXTRACT(MONTH FROM month) < 4
         GROUP BY 1
         ORDER BY fy ASC`,
        [client.id],
      );
      return rows;
    }, []),

    // 4. Competitor installed base (PCP + MMP units by maker, from competitor_installed_base)
    q<CompBreakdown>(async () => {
      const { rows } = await risansiPool.query<Record<string, number | string | null>>(
        `SELECT * FROM competitor_installed_base WHERE client_code = $1 LIMIT 1`,
        [client.code],
      );
      const row = rows[0];
      if (!row) return { rilUnits: 0, totalUnits: 0, makers: [], rilMmp: 0, totalMmp: 0, mmpMakers: [] };

      const byMaker = (labels: Record<string, string>) =>
        Object.entries(labels)
          .map(([col, name]) => ({ name, units: Number(row[col] ?? 0) }))
          .filter(m => m.units > 0)
          .sort((a, b) => b.units - a.units);

      // PCP
      const rilUnits = Number(row.ril_pcp ?? 0);
      const makers   = byMaker(COMPETITOR_PCP);
      // Total should be at least RIL + named competitors even if total_pcp is blank.
      const sumNamed = rilUnits + makers.reduce((s, m) => s + m.units, 0);

      // MMP
      const rilMmp    = Number(row.ril_mmp ?? 0);
      const mmpMakers = byMaker(COMPETITOR_MMP);
      const sumNamedMmp = rilMmp + mmpMakers.reduce((s, m) => s + m.units, 0);

      return {
        rilUnits, totalUnits: Math.max(Number(row.total_pcp ?? 0), sumNamed), makers,
        rilMmp,   totalMmp:   Math.max(Number(row.total_mmp ?? 0), sumNamedMmp), mmpMakers,
      };
    }, { rilUnits: 0, totalUnits: 0, makers: [], rilMmp: 0, totalMmp: 0, mmpMakers: [] }),

    // 5. Visit timeline (last 20)
    q<Visit[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; rep_name: string; visit_date: Date;
        purpose: string | null; outcome: string | null;
        summary: string | null; status: string; submitted_at: string | null;
      }>(
        `SELECT v.id, COALESCE(r.name, '—') AS rep_name, v.visit_date,
                v.purpose, v.outcome, v.summary, v.status, v.submitted_at
         FROM visits v
         LEFT JOIN users r ON r.id = v.rep_id
         WHERE v.client_id = $1
         ORDER BY v.visit_date DESC
         LIMIT 20`,
        [client.id],
      );
      return rows.map(r => ({ ...r, synced: false }));
    }, []),

    // 6. Every opportunity for this client, at any stage. Won opportunities are
    //    the client's order-in-hand and must show here, so nothing is filtered
    //    out by stage. Ordered order-in-hand first, then live pipeline, then
    //    closed-lost/dropped — each band by value.
    q<Opportunity[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; product: string; stage: string;
        value_cr: string; probability: number | null;
        final_value_cr: string | null; so_sum_cr: number;
        quotation_link: string | null; quote_ref: string | null; doc_count: number;
        offer_value_inr: number | null; revisions: OfferRevision[] | null;
      }>(
        `SELECT id, product, stage, value_cr::text,
                ${probabilityPctSql('opportunities')} AS probability,
                final_value_cr::text, quotation_link, quote_ref,
                (SELECT count(*) FROM opportunity_quotation_files qf
                  WHERE qf.opportunity_id = opportunities.id)::int AS doc_count,
                offer_value_inr::float8 AS offer_value_inr,
                (SELECT COALESCE(SUM(so.so_value_cr), 0) FROM opportunity_sales_orders so WHERE so.opportunity_id = opportunities.id)::float8 AS so_sum_cr,
                -- Revised-offer history, oldest first, as JSON so one query
                -- serves the whole list without a fan-out join.
                (SELECT COALESCE(json_agg(json_build_object(
                          'id', r.id, 'value_inr', r.value_inr::float8,
                          'revised_on', r.revised_on::text, 'note', r.note,
                          'created_by', r.created_by, 'created_at', r.created_at::text
                        ) ORDER BY r.revised_on, r.id), '[]'::json)
                   FROM opportunity_offer_revisions r
                  WHERE r.opportunity_id = opportunities.id) AS revisions
         FROM opportunities
         WHERE client_id = $1
         ORDER BY CASE
                    WHEN stage = 'Won'                 THEN 0
                    WHEN stage IN ('Lost', 'Dropped')  THEN 2
                    ELSE 1
                  END,
                  value_cr DESC NULLS LAST`,
        [client.id],
      );
      return rows;
    }, []),

    // 7. Activity log — the full audit trail for this client: its own edits +
    //    contacts (entity_type 'client'), opportunities created via the pipeline
    //    ('pipeline'), edits to its opportunities ('opportunity'), and its visits
    //    ('visit'). All actions write to audit_log via recordAudit.
    q<ActivityEntry[]>(async () => {
      const { rows } = await risansiPool.query<ActivityEntry>(
        `SELECT a.id::text AS id, a.actor_email,
                COALESCE(u.name, a.actor_email) AS actor_name,
                a.action, COALESCE(a.summary, a.action) AS summary,
                a.entity_type, a.created_at
           FROM audit_log a
           LEFT JOIN users u ON lower(u.email) = lower(a.actor_email)
          WHERE (a.entity_type IN ('client','pipeline') AND a.entity_id = $1)
             OR (a.entity_type = 'opportunity' AND a.entity_id IN (SELECT id::text FROM opportunities WHERE client_id = $1::bigint))
             OR (a.entity_type = 'visit'       AND a.entity_id IN (SELECT id::text FROM visits        WHERE client_id = $1::bigint))
          ORDER BY a.created_at DESC
          LIMIT 40`,
        [String(client.id)],
      );
      return rows;
    }, []),

    // 8. Reps for Plan Visit drawer
    q<DrawerRep[]>(async () => {
      const { rows } = await risansiPool.query<{ id: string; name: string; route: string | null }>(
        `SELECT id, name, route FROM users WHERE is_active = TRUE ORDER BY name`,
      );
      return rows;
    }, []),

    // 9. Complaints for this client — every one, with who holds it now, from
    //    the same loader as the Complaints page (the page is client-access gated)
    //    includeRaisedAsOem: an OEM's own record would otherwise be empty. A
    //    complaint that came through them belongs to the mill with the pump,
    //    but it is still theirs to ask about, so it shows here marked as one
    //    they raised rather than one about them.
    q<ComplaintListRow[]>(() => loadComplaintRows(currentUser, { clientId: Number(client.id), includeRaisedAsOem: true }), []),

    // 10. (was: users to escalate complaints to — the module owns that now)
    Promise.resolve(null),

    // 11. RIL pump detail for this client (only the report fields)
    q<PumpRow[]>(async () => (await risansiPool.query<PumpRow>(`
      SELECT id,
        pump_model_plate, quantity, customer_name AS supplier, ec_number, so_number, pump_sl_no,
        liquid, capacity, head
      FROM client_pumps WHERE client_id = $1
      ORDER BY id`, [client.id])).rows, []),

    // 12. Client comments (newest first). ISO-UTC timestamps so new Date() in
    // the browser parses reliably across engines (Safari/Firefox included).
    q<CommentRow[]>(async () => (await risansiPool.query<CommentRow>(`
      SELECT id, body, author_email, author_name,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
      FROM client_comments WHERE client_id = $1
      ORDER BY created_at DESC, id DESC`, [client.id])).rows, []),

    // 13. Action items — the Activity Register for this client.
    q<ActionItem[]>(async () => (await risansiPool.query<ActionItem>(`
      SELECT t.id, t.title, t.description,
             u.name AS assigned_rep_name,
             t.assigned_to_external, t.assigned_to_external_email,
             t.due_date::text AS due_date, t.priority, t.status,
             t.created_by, t.created_at::text AS created_at, t.resolution_note,
             (t.visit_id IS NOT NULL) AS from_visit
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to_rep
      WHERE t.client_id = $1
      ORDER BY (t.status = 'completed'), COALESCE(t.due_date, t.created_at::date) DESC, t.id DESC`,
      [client.id])).rows, []),

    // 14. What the last visit to log any equipment actually saw on site.
    //
    // competitor_installed_base above is a survey — a snapshot taken once and
    // left. A TSM standing in the plant is the more recent answer, so the panel
    // says both and dates the second, rather than quietly overwriting a figure
    // somebody entered deliberately. A line "Roto · PCP · qty 4" is four pumps.
    q<LastSeen | null>(async () => {
      const { rows } = await risansiPool.query<LastSeen>(
        `SELECT v.id::text AS visit_id, v.visit_date::text AS visit_date,
                COALESCE(r.name, '—') AS rep_name,
                SUM(COALESCE(e.qty, 1)) FILTER (WHERE NOT e.is_ril)::int AS competitor_pumps,
                SUM(COALESCE(e.qty, 1)) FILTER (WHERE e.is_ril)::int      AS ril_pumps,
                string_agg(DISTINCT NULLIF(btrim(e.supplier), ''), ', ')
                  FILTER (WHERE NOT e.is_ril)                             AS makers
           FROM equipment e
           JOIN visits v ON v.id = e.visit_id
           LEFT JOIN users r ON r.id = v.rep_id
          WHERE v.client_id = $1
          GROUP BY v.id, v.visit_date, r.name
          ORDER BY v.visit_date DESC NULLS LAST, v.id DESC
          LIMIT 1`,
        [client.id]);
      return rows[0] ?? null;
    }, null),
  ]);

  // ── Derived values ────────────────────────────────────────

  // Revenue chart data — from client_revenue_monthly (INR ÷ 1L = Lakhs)
  const INR_TO_L = 100_000;

  const revByFY: Record<string, { pump: number; spare: number; orders: number }> = {};

  // Build from client_revenue_monthly (authoritative)
  for (const r of clientRevByFY) {
    revByFY[r.fy] = {
      pump:   Number(r.pump_inr)  / INR_TO_L,
      spare:  Number(r.spare_inr) / INR_TO_L,
      orders: 0,
    };
  }

  // Merge order counts from orders table
  for (const r of revRows) {
    if (!revByFY[r.financial_year]) {
      revByFY[r.financial_year] = { pump: 0, spare: 0, orders: 0 };
    }
    revByFY[r.financial_year].orders += Number(r.order_count);
  }

  // Chart FYs: all FYs with data, sorted
  const chartFYs = Object.keys(revByFY).sort();

  let lifetimePump = 0, lifetimeSpare = 0, lifetimeOrders = 0;
  for (const { pump, spare, orders } of Object.values(revByFY)) {
    lifetimePump   += pump;
    lifetimeSpare  += spare;
    lifetimeOrders += orders;
  }
  const lifetimeTotal = lifetimePump + lifetimeSpare;

  // 5yr CAGR (from master data columns)
  const chartTotals = chartFYs.map(f => (revByFY[f]?.pump ?? 0) + (revByFY[f]?.spare ?? 0));
  const cagr5yr = (() => {
    const nonZero = chartTotals.filter(v => v > 0);
    if (nonZero.length < 2) return null;
    const first = nonZero[0], last = nonZero[nonZero.length - 1];
    const years = nonZero.length - 1;
    return ((last / first) ** (1 / years) - 1) * 100;
  })();

  // Competition KPIs — from competitor_installed_base (PCP + MMP units by maker)
  const rilUnits        = comp.rilUnits;
  const totalUnits      = comp.totalUnits;
  const competitorUnits = Math.max(0, totalUnits - rilUnits);
  const rilSharePct     = totalUnits > 0 ? Math.round((rilUnits / totalUnits) * 100) : 0;

  const rilMmp          = comp.rilMmp;
  const totalMmp        = comp.totalMmp;
  const competitorMmp   = Math.max(0, totalMmp - rilMmp);
  const rilMmpSharePct  = totalMmp > 0 ? Math.round((rilMmp / totalMmp) * 100) : 0;

  // Risansi's own installed pumps at this client, split by type (the headline figure).
  const rilPumpsTotal   = rilUnits + rilMmp;

  // Installed-base breakdown sections (PCP + MMP), each rendered the same way.
  const installedSections = [
    totalUnits > 0 ? { key: 'PCP', ril: rilUnits, total: totalUnits, makers: comp.makers,    sharePct: rilSharePct }    : null,
    totalMmp   > 0 ? { key: 'MMP', ril: rilMmp,   total: totalMmp,   makers: comp.mmpMakers,  sharePct: rilMmpSharePct } : null,
  ].filter(Boolean) as { key: string; ril: number; total: number; makers: CompMaker[]; sharePct: number }[];
  const competitorAll = competitorUnits + competitorMmp;

  // Last visit — from clients.last_visit_date (most recent COMPLETED visit only;
  // planned future visits never count). formatLastVisit treats future dates as "never".
  const lastVisitInfo = formatLastVisit(client.last_visit_date);
  const usdRate = await getUsdRate();

  // The opportunity panel shows every stage; these split it for the summary.
  // "Open" = live pipeline (drives the KPI tile); "Won" = order in hand.
  const CLOSED_STAGES = ['Won', 'Lost', 'Dropped'];
  const openOpps = allOpps.filter(o => !CLOSED_STAGES.includes(o.stage));
  const wonOpps  = allOpps.filter(o => o.stage === 'Won');
  const pipelineTotal = openOpps.reduce((s, o) => s + Number(o.value_cr), 0); // value_cr already in Cr
  // "Order in Hand" = Won value not yet turned into a Sales Order:
  // Σ max(final − Σ SO, 0). Legacy Wons with no SOs count their full value.
  const oihPerWon = (o: Opportunity) => {
    const finalCr = o.final_value_cr != null ? Number(o.final_value_cr) : Number(o.value_cr);
    return Math.max(0, finalCr - Number(o.so_sum_cr ?? 0));
  };
  const wonTotal    = wonOpps.reduce((s, o) => s + oihPerWon(o), 0);   // order in hand
  const openWonCount = wonOpps.filter(o => oihPerWon(o) > 0).length;   // Wons still to be fulfilled

  // ── Quotation pipeline summary (stage funnel + conversion metrics) ──
  const PIPE_STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];
  const stageAgg: Record<string, { count: number; val: number }> = {};
  for (const o of allOpps) {
    const a = (stageAgg[o.stage] ??= { count: 0, val: 0 });
    a.count += 1; a.val += Number(o.value_cr) || 0;
  }
  const pipeRows = PIPE_STAGES.filter(s => stageAgg[s]).map(s => ({ stage: s, ...stageAgg[s] }));
  const maxStageVal   = Math.max(1, ...pipeRows.map(r => r.val));
  const wonCount      = stageAgg['Won']?.count ?? 0;
  const lostCount     = (stageAgg['Lost']?.count ?? 0) + (stageAgg['Dropped']?.count ?? 0);
  const decidedCount  = wonCount + lostCount;
  const winRatePct    = decidedCount > 0 ? Math.round((wonCount / decidedCount) * 100) : null;
  const quotedPlusVal = allOpps.filter(o => ['Quoted', 'Negotiating', 'On Hold', 'Won'].includes(o.stage)).reduce((s, o) => s + (Number(o.value_cr) || 0), 0);
  const wonValTotal   = wonOpps.reduce((s, o) => s + (o.final_value_cr != null ? Number(o.final_value_cr) : Number(o.value_cr)), 0);
  // Split rather than summed. Counting a SharePoint url from before uploads
  // existed as "with quotation" put 679 records into a number that is supposed
  // to say how many quotations this portal actually holds. Both are worth
  // knowing, so both are shown.
  //
  // Counted from the documents table rather than from the link, because
  // syncQuotationLink leaves a legacy url in place when a PDF is uploaded onto
  // one of those opportunities — so the link says SharePoint while the document
  // is right here, and that will get commoner as reps work through the backlog.
  const quotesAttached = allOpps.filter(o => (o.doc_count ?? 0) > 0).length;
  const quotesLegacy   = allOpps.filter(o => (o.doc_count ?? 0) === 0 && isLegacyQuotation(o.quotation_link)).length;
  const STAGE_HUE: Record<string, string> = {
    Suspect: '#6B7FA3', Prospect: '#1A5CB8', Quoted: '#D97706', Negotiating: '#F97316',
    'On Hold': '#7C3AED', Won: '#0E9F6E', Lost: '#E02424', Dropped: '#64748B',
  };

  // ── Outcome color ─────────────────────────────────────────

  function outcomeKind(outcome: string | null): 'pos' | 'warn' | 'neg' | undefined {
    if (!outcome) return undefined;
    const l = outcome.toLowerCase();
    if (l.includes('very positive') || l.includes('positive')) return 'pos';
    if (l.includes('needs attention') || l.includes('neutral')) return 'warn';
    if (l.includes('escalation'))  return 'neg';
    return undefined;
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={[{ label: 'Clients', href: '/risansi/clients' }, client.zone ?? '', client.trade_name ?? client.legal_name]} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Back button */}
        <BackButton />

        {/* ── Page header ─────────────────────────────────────── */}
        <div className="r-detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="r-detail-title" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                {client.legal_name}
              </span>
              <StatusDot s={statusDotKind(client.status)} />
              <span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: -4 }}>{clientStatusLabel(client.status)}</span>
              {client.tier === 'Key' && <Tag kind="accent">Key Account</Tag>}
              {client.tier && client.tier !== 'Key' && <Tag>{client.tier}</Tag>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{client.code}</span>
              <span style={{ margin: '0 8px' }}>·</span>
              {client.industry}
              {client.tcd ? ` · ${client.tcd} TCD` : ''}
              {client.klpd ? ` · ${client.klpd} KLPD` : ''}
              {client.address && <><span style={{ margin: '0 8px' }}>·</span>{client.address}</>}
              {client.since_year && <><span style={{ margin: '0 8px' }}>·</span>Customer since {client.since_year}</>}
            </div>

            {/* Responsible people. Owner and cover are shown apart rather than as
                one "Reps" list: a rep looking at this needs to know at a glance
                whether the account is theirs or whether they are backing someone
                up, and a joined string cannot say which. */}
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Owner</span>
                {client.primary_rep_name ? (
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{client.primary_rep_name}</span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--neg)' }}>Unassigned</span>
                )}
              </div>

              {client.secondary_rep_names && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Also covers</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-2)' }}>{client.secondary_rep_names}</span>
                </div>
              )}

              {client.manager_name && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Manager</span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{client.manager_name}</span>
                </div>
              )}

              {/* Tour route. Always rendered, including when there is none:
                  a client with no tour is exactly the one somebody needs to map,
                  and hiding the row hid the control along with it. */}
              <ClientTourBlock
                clientId={String(client.id)}
                tourName={client.tour_name}
                tourZone={client.tour_zone}
              />

              {/* Google Maps link */}
              {client.google_maps_url && (
                <a
                  href={client.google_maps_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  📍 View on Maps
                </a>
              )}
            </div>
          </div>
          <div className="r-detail-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <a
            href={`/print/client/${client.code}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', fontSize: 13, fontWeight: 600,
              background: 'var(--accent-soft)', color: 'var(--title)',
              border: '1px solid var(--accent-line)', borderRadius: 6, textDecoration: 'none',
            }}
          >
            🖨 Export PDF
          </a>
          {canEdit && client.status === 'PROSPECTIVE_LEAD' && (
            <ConvertLeadButton clientId={Number(client.id)} currentCode={client.code} legalName={client.legal_name} />
          )}
          <ClientActionButtons
            clientId={client.id}
            usdRate={usdRate}
            clientName={client.legal_name}
            clientCode={client.code}
            industry={client.industry ?? ''}
            repId={client.primary_rep_id ?? null}
            // repName is the owner alone, not the joined list: repId names one
            // person, and prefilling a form with one id and two names is how a
            // visit ends up filed against somebody who was only covering it.
            repName={client.primary_rep_name ?? ''}
            ownerName={client.owner_name ?? null}
            reps={reps}
            clientData={client}
            contacts={contacts.filter(c => c.added_by !== 'excel_import')}
            canEdit={canEdit}
            currentUserName={session?.user?.name ?? ''}
            currentUserRepId={session?.user?.repId ?? null}
            currentUserRole={role}
          />
          </div>
        </div>

        {/* Panels grouped into mobile tabs (Overview / Activity / Contacts).
            Desktop ignores the grouping and shows everything as before. */}
        <MobileTabs>

        {/* ── KPI cards ────────────────────────────────────────── */}
        <div data-tabgroup="overview" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
          <MiniKpi label="Order in Hand"
            value={wonTotal > 0 ? formatRev(wonTotal * 1e7) : '—'}
            valueColor={wonTotal > 0 ? 'var(--accent)' : undefined}
            sub={wonTotal > 0
              ? `${openWonCount} won order${openWonCount === 1 ? '' : 's'} to fulfil`
              : 'Nothing pending — all won orders fulfilled'} />
          <MiniKpi label="Lifetime Revenue"
            value={formatRev(lifetimeTotal * 100_000)}
            sub={`${client.since_year ?? '—'} – present · ${lifetimeOrders} orders`} />
          <MiniKpi label="Last Visit"
            value={lastVisitInfo.label}
            valueColor={lastVisitInfo.color}
            sub={lastVisitInfo.label === 'Never visited'
              ? 'No visits logged'
              : new Date(client.last_visit_date!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            neg={lastVisitInfo.isOverdue} />
          <MiniKpi label="Risansi Pumps Installed"
            value={rilPumpsTotal > 0 ? String(rilPumpsTotal) : '—'}
            sub={rilPumpsTotal > 0 ? `${rilUnits} PCP · ${rilMmp} MMP` : 'No installed-base data'} />
          <MiniKpi label="Open Pipeline"
            value={formatRev(pipelineTotal * 1e7)}
            sub={pipelineTotal > 0
              ? `≈ ${fmtUsdFromCr(pipelineTotal, usdRate)} · ${openOpps.length} opportunit${openOpps.length === 1 ? 'y' : 'ies'}`
              : 'No open opportunities'} />
          <MiniKpi label="Outstanding"
            value={client.total_outstanding != null ? formatRev(Number(client.total_outstanding)) : '—'}
            valueColor={client.total_outstanding ? 'var(--neg)' : undefined}
            sub={client.total_outstanding != null
              ? `as of ${client.outstanding_as_of ? new Date(client.outstanding_as_of).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}`
              : 'None on record'} />
        </div>

        {/* ── Main 2-col layout ────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 14 }}>

          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Revenue YoY chart */}
            <div data-tabgroup="overview" style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Year-on-Year Revenue · Pump vs Spare</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {cagr5yr != null && (
                    <Tag>{cagr5yr >= 0 ? '+' : ''}{cagr5yr.toFixed(0)}% 5-yr CAGR</Tag>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                {/* Left: data table */}
                <div style={{ borderRight: '1px solid var(--line)', display: 'flex', alignItems: 'center', minHeight: 200, padding: '16px 0' }}>
                  <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elev)' }}>
                        <th style={{ ...REV_TH, textAlign: 'left', padding: '10px 12px' }}></th>
                        {chartFYs.map(f => (
                          <th key={f} style={{ ...REV_TH, padding: '10px 12px' }}>FY {f}</th>
                        ))}
                        <th style={{ ...REV_TH, padding: '10px 12px', fontWeight: 600, color: 'var(--fg-2)' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td data-label="" style={{ padding: '9px 12px', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>Pump (₹ L)</td>
                        {chartFYs.map(f => (
                          <td key={f} data-label={`FY ${f}`} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, borderBottom: '1px solid var(--line)', color: revByFY[f].pump > 0 ? 'var(--fg)' : 'var(--fg-3)' }}>
                            {revByFY[f].pump > 0 ? revByFY[f].pump.toFixed(1) : '—'}
                          </td>
                        ))}
                        <td data-label="Lifetime" style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--line)' }}>
                          {lifetimePump.toFixed(1)}
                        </td>
                      </tr>
                      <tr>
                        <td data-label="" style={{ padding: '9px 12px', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>Spare (₹ L)</td>
                        {chartFYs.map(f => (
                          <td key={f} data-label={`FY ${f}`} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, borderBottom: '1px solid var(--line)', color: revByFY[f].spare > 0 ? 'var(--fg)' : 'var(--fg-3)' }}>
                            {revByFY[f].spare > 0 ? revByFY[f].spare.toFixed(1) : '—'}
                          </td>
                        ))}
                        <td data-label="Lifetime" style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--line)' }}>
                          {lifetimeSpare.toFixed(1)}
                        </td>
                      </tr>
                      <tr style={{ background: 'var(--bg-elev)' }}>
                        <td data-label="" style={{ padding: '9px 12px', fontSize: 11, color: 'var(--fg-2)', fontWeight: 600 }}>Total</td>
                        {chartFYs.map(f => {
                          const t = revByFY[f].pump + revByFY[f].spare;
                          return (
                            <td key={f} data-label={`FY ${f}`} style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, color: t > 0 ? 'var(--fg)' : 'var(--fg-3)' }}>
                              {t > 0 ? t.toFixed(1) : '—'}
                            </td>
                          );
                        })}
                        <td data-label="Lifetime" style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11, color: 'var(--title)' }}>
                          {lifetimeTotal.toFixed(1)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* Right: bar chart */}
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                  <RevenueChart fyKeys={chartFYs} revByFY={revByFY} />
                </div>
              </div>
            </div>

            {/* Competition · installed base (RIL vs competitors at this client, PCP + MMP) */}
            <div data-tabgroup="overview" style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Competition · Installed Base</span>
                {competitorAll > 0 && (
                  <div style={{ marginLeft: 'auto' }}>
                    <Tag kind="warn">{competitorAll} competitor unit{competitorAll !== 1 ? 's' : ''}</Tag>
                  </div>
                )}
              </div>

              {/* What the last visit actually counted.
                  The figures above are a survey — taken once, and as old as the
                  day it was taken. A TSM standing in the plant is the more
                  recent answer, so it is shown beside them and dated, rather
                  than overwriting a number somebody entered deliberately. Where
                  the two disagree, that gap is the point. */}
              {lastSeen && (lastSeen.competitor_pumps ?? 0) + (lastSeen.ril_pumps ?? 0) > 0 && (() => {
                const seen = lastSeen.competitor_pumps ?? 0;
                const gap  = seen - competitorAll;
                return (
                  <div style={{
                    padding: '9px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)',
                    display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5,
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
                      Last seen on site
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--fg)' }}>{seen}</span>
                    <span style={{ color: 'var(--fg-2)' }}>
                      competitor pump{seen === 1 ? '' : 's'}
                      {lastSeen.makers ? ` · ${lastSeen.makers}` : ''}
                    </span>
                    {competitorAll > 0 && gap !== 0 && (
                      <span style={{ color: 'var(--warn-strong, var(--warn))' }}>
                        {gap > 0 ? `${gap} more than` : `${-gap} fewer than`} the survey above
                      </span>
                    )}
                    <a href={`/risansi/visits/${lastSeen.visit_id}`}
                      style={{ marginLeft: 'auto', color: 'var(--brand-blue)', textDecoration: 'none' }}>
                      {lastSeen.visit_date ? new Date(lastSeen.visit_date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'the visit'} · {lastSeen.rep_name} →
                    </a>
                  </div>
                );
              })()}
              {installedSections.length > 0 ? (
                <div style={{ padding: 14 }}>
                  {/* Headline: how many pumps here are ours, split by type */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                    <div style={RIL_STAT}>
                      <div style={RIL_STAT_LBL}>Risansi pumps here</div>
                      <div style={RIL_STAT_VAL}>{rilPumpsTotal}</div>
                      <div style={RIL_STAT_SUB}>{rilUnits} PCP · {rilMmp} MMP</div>
                    </div>
                    <div style={RIL_STAT}>
                      <div style={RIL_STAT_LBL}>PCP share</div>
                      <div style={{ ...RIL_STAT_VAL, color: totalUnits === 0 ? 'var(--fg-3)' : rilSharePct >= 50 ? 'var(--pos)' : 'var(--neg)' }}>
                        {totalUnits > 0 ? `${rilSharePct}%` : '—'}
                      </div>
                      <div style={RIL_STAT_SUB}>{rilUnits} of {totalUnits} pumps</div>
                    </div>
                    <div style={RIL_STAT}>
                      <div style={RIL_STAT_LBL}>MMP share</div>
                      <div style={{ ...RIL_STAT_VAL, color: totalMmp === 0 ? 'var(--fg-3)' : rilMmpSharePct >= 50 ? 'var(--pos)' : 'var(--neg)' }}>
                        {totalMmp > 0 ? `${rilMmpSharePct}%` : '—'}
                      </div>
                      <div style={RIL_STAT_SUB}>{rilMmp} of {totalMmp} pumps</div>
                    </div>
                  </div>

                  {/* Per-type breakdown: RIL vs each competitor make */}
                  {installedSections.map((sec, si) => (
                    <div key={sec.key} style={{ marginTop: si > 0 ? 16 : 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                        {sec.key} · {sec.total} pump{sec.total !== 1 ? 's' : ''}
                      </div>
                      {[{ name: 'RIL', units: sec.ril, isRil: true }, ...sec.makers.map(m => ({ ...m, isRil: false }))]
                        .filter(m => m.units > 0)
                        .map(m => {
                          const pct = sec.total > 0 ? (m.units / sec.total) * 100 : 0;
                          const color = m.isRil ? 'var(--brand-blue)' : '#94A3B8';
                          return (
                            <div key={m.name} style={{ marginBottom: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                                <span style={{ fontWeight: m.isRil ? 600 : 400, color: m.isRil ? 'var(--accent)' : 'var(--fg-2)' }}>
                                  {m.name}{m.isRil ? ' (us)' : ''}
                                </span>
                                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{m.units} · {pct.toFixed(0)}%</span>
                              </div>
                              <div style={{ height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No competitor installed-base data for this client
                </div>
              )}
            </div>

            {/* RIL pump detail + installed-base discrepancy */}
            <ClientPumps pumps={clientPumps} installedRil={rilPumpsTotal} clientName={String(client.legal_name)} clientId={Number(client.id)} />

            {/* Complaints */}
            <ClientComplaints complaints={complaints} clientId={Number(client.id)} />

            {/* EPC / OEM account profile — captured on the visit Client Type page */}
            {isEpcOem(client.client_type) && (
              <div data-tabgroup="overview" style={PANEL}>
                <div style={PANEL_H}>
                  <span style={PANEL_TITLE}>{client.client_type} Profile</span>
                  <div style={{ marginLeft: 'auto' }}><Tag kind="accent">{client.client_type}</Tag></div>
                </div>
                <div style={{ padding: '14px' }}>
                  {client.focus_industries && client.focus_industries.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={MICRO_LBL}>Focus Industries</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {client.focus_industries.map(i => <Tag key={i}>{i}</Tag>)}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    {client.avg_annual_pump_req != null && (
                      <div>
                        <div style={MICRO_LBL}>Avg Annual Pump Req.</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 3, color: 'var(--fg)' }}>{client.avg_annual_pump_req}</div>
                      </div>
                    )}
                    {client.ongoing_tenders != null && (
                      <div>
                        <div style={MICRO_LBL}>Ongoing Tenders</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 3, color: 'var(--fg)' }}>{client.ongoing_tenders}</div>
                      </div>
                    )}
                    {client.upcoming_tenders != null && (
                      <div>
                        <div style={MICRO_LBL}>Upcoming Tenders / Projects</div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, color: client.upcoming_tenders ? 'var(--pos)' : 'var(--fg-2)' }}>{client.upcoming_tenders ? 'YES' : 'No'}</div>
                      </div>
                    )}
                  </div>
                  {client.upcoming_tenders && client.upcoming_tenders_details && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                      <div style={MICRO_LBL}>Upcoming Tenders — Details</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap' }}>{client.upcoming_tenders_details}</div>
                    </div>
                  )}
                  {client.pcp_suppliers && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                      <div style={MICRO_LBL}>PC Pump Suppliers · Competitor Footprint</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap' }}>{client.pcp_suppliers}</div>
                    </div>
                  )}
                  {!(client.focus_industries && client.focus_industries.length) && client.avg_annual_pump_req == null
                    && client.ongoing_tenders == null && client.upcoming_tenders == null && !client.pcp_suppliers && (
                    <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                      No {client.client_type} details captured yet — add them from a visit’s Client Type page.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Plan of Action */}
            {(client.action_points || client.expected_to_pump || client.expected_to_spare || client.mgmt_intervention) && (
              <div data-tabgroup="activity" style={PANEL}>
                <div style={PANEL_H}>
                  <span style={PANEL_TITLE}>Plan of Action</span>
                  {client.mgmt_intervention && (
                    <div style={{ marginLeft: 'auto' }}>
                      <Tag kind="warn">Mgmt Intervention</Tag>
                    </div>
                  )}
                </div>
                <div style={{ padding: '14px' }}>
                  {client.action_points && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Action Points</div>
                      <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.6 }}>{client.action_points}</div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    {client.expected_to_pump != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Expected Pump</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 3, color: 'var(--pos)' }}>
                          {formatRev(client.expected_to_pump ?? 0)}
                        </div>
                      </div>
                    )}
                    {client.expected_to_spare != null && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Expected Spare</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginTop: 3, color: 'var(--pos)' }}>
                          {formatRev(client.expected_to_spare ?? 0)}
                        </div>
                      </div>
                    )}
                    {client.mgmt_intervention && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Mgmt Intervention</div>
                        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3, color: 'var(--warn)' }}>YES</div>
                      </div>
                    )}
                  </div>
                  {client.constraints_notes && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Constraints</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>{client.constraints_notes}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Field Intelligence */}
            {(client.performance_feedback || client.last_visit_summary || client.open_remarks || client.complaint_notes) && (
              <div data-tabgroup="activity" style={PANEL}>
                <div style={PANEL_H}>
                  <span style={PANEL_TITLE}>Field Intelligence</span>
                  {client.performance_feedback && (
                    <Tag kind={
                      client.performance_feedback.toLowerCase().includes('good') ? 'pos'
                      : client.performance_feedback.toLowerCase().includes('poor') ? 'neg'
                      : 'warn'
                    }>{client.performance_feedback}</Tag>
                  )}
                  {client.last_visit_fy && (
                    <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                      Last: FY {client.last_visit_fy}
                    </span>
                  )}
                </div>
                <div style={{ padding: '14px' }}>
                  {client.last_visit_summary && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Last Visit Summary</div>
                      <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.6 }}>{client.last_visit_summary}</div>
                    </div>
                  )}
                  {client.open_remarks && (
                    <div style={{ marginBottom: 14, paddingTop: client.last_visit_summary ? 12 : 0, borderTop: client.last_visit_summary ? '1px solid var(--line)' : 'none' }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Open Remarks</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.6 }}>{client.open_remarks}</div>
                    </div>
                  )}
                  {client.complaint_notes && (
                    <div style={{ paddingTop: (client.last_visit_summary || client.open_remarks) ? 12 : 0, borderTop: (client.last_visit_summary || client.open_remarks) ? '1px solid var(--line)' : 'none' }}>
                      <div style={{ fontSize: 10, color: 'var(--neg)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500, marginBottom: 6 }}>Open Complaints</div>
                      <div style={{ fontSize: 12, color: 'var(--neg)', lineHeight: 1.6 }}>{client.complaint_notes}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Activity Register — action items logged for this client, + record a new one */}
            <ClientActivityRegister
              clientId={Number(client.id)}
              actions={clientActions}
              reps={reps.map(r => ({ id: Number(r.id), name: r.name, zone: r.route }))}
              ownerRepId={client.primary_rep_id ? Number(client.primary_rep_id) : null}
            />

            {/* Visit Timeline */}
            <div data-tabgroup="activity" style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Visit Timeline · {visits.length > 0 ? `${visits.length} visits` : 'No visits'}</span>
              </div>
              {visits.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No visit history
                </div>
              ) : (
                <div>
                  {visits.map((v, i) => {
                    const d = new Date(v.visit_date);
                    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                    const submitted = !!v.submitted_at;
                    return (
                      <div
                        key={v.id}
                        style={{
                          display: 'flex', gap: 14, padding: '14px',
                          borderBottom: i < visits.length - 1 ? '1px solid var(--line)' : 'none',
                          alignItems: 'flex-start',
                        }}
                      >
                        {/* Clickable area → opens this visit report */}
                        <Link
                          href={`/risansi/visits/${v.id}`}
                          style={{ flex: 1, minWidth: 0, display: 'flex', gap: 14, alignItems: 'flex-start', textDecoration: 'none', color: 'inherit' }}
                        >
                          <div style={{ width: 110, flexShrink: 0 }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>{dateStr}</div>
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>
                              {v.rep_name?.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 3)}
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: v.summary ? 6 : 0 }}>
                              <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--accent)' }}>{v.purpose ?? 'Visit'}</span>
                              {v.outcome && <Tag kind={outcomeKind(v.outcome)} dot>{v.outcome}</Tag>}
                              {submitted
                                ? <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--pos)', fontFamily: 'var(--font-mono)' }}>● Submitted</span>
                                : <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', textTransform: 'capitalize' }}>{v.status?.replace('-', ' ')}</span>}
                            </div>
                            {v.summary && (
                              <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{v.summary}</div>
                            )}
                          </div>
                        </Link>

                        {/* Direct PDF — only for submitted (closed) reports */}
                        {submitted && (
                          <a
                            href={`/print/visit/${v.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open PDF of this visit report"
                            style={{
                              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 9px', fontSize: 11, fontWeight: 600,
                              background: 'var(--accent-soft)', color: 'var(--title)',
                              border: '1px solid var(--accent-line)', borderRadius: 6, textDecoration: 'none',
                            }}
                          >
                            📄 PDF
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Location */}
            <div data-tabgroup="contacts" style={PANEL}>
              <div style={PANEL_H}><span style={PANEL_TITLE}>Location</span></div>
              {(client.address || client.city || client.state || client.country || client.google_maps_url) ? (
                <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {client.address && (
                    <div>
                      <div style={LOC_LBL}>Address</div>
                      <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.5 }}>{client.address}</div>
                    </div>
                  )}
                  {(client.city || client.state || client.country) && (
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                      {client.city    && <div><div style={LOC_LBL}>City</div><div style={LOC_VAL}>{client.city}</div></div>}
                      {client.state   && <div><div style={LOC_LBL}>State</div><div style={LOC_VAL}>{client.state}</div></div>}
                      {client.country && <div><div style={LOC_LBL}>Country</div><div style={LOC_VAL}>{client.country}</div></div>}
                    </div>
                  )}
                  {client.google_maps_url && (
                    <a href={client.google_maps_url} target="_blank" rel="noreferrer" style={MAPS_BTN}>
                      📍 View on Google Maps
                    </a>
                  )}
                </div>
              ) : (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No location on file
                </div>
              )}
            </div>

            {/* Contacts */}
            <div data-tabgroup="contacts" style={PANEL}>
              <div style={{
                ...PANEL_H,
                justifyContent: 'space-between',
                borderBottom: contacts.length > 0 ? '1px solid var(--line)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={PANEL_TITLE}>Contacts</span>
                  {contacts.length > 0 && (
                    <span style={{
                      background: 'var(--bg-sunk)', color: 'var(--fg-3)',
                      borderRadius: 10, padding: '1px 7px',
                      fontSize: 11, fontWeight: 600,
                    }}>
                      {contacts.length}
                    </span>
                  )}
                </div>
                {canManageContacts && <AddContactButton clientId={Number(client.id)} clientCode={client.code} />}
              </div>

              {contacts.length === 0 ? (
                <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
                  No contacts recorded yet.
                  <br />
                  <span style={{ fontSize: 12 }}>Click + Add Contact to add the first contact.</span>
                </div>
              ) : (
                <div>
                  {contacts.map((c, i) => (
                    <div
                      key={c.id}
                      style={{
                        padding: '12px 16px',
                        borderBottom: i < contacts.length - 1 ? '1px solid var(--line)' : 'none',
                        display: 'flex', gap: 12, alignItems: 'flex-start',
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                        background: c.is_primary ? 'var(--accent-fill)' : 'var(--bg-sunk)',
                        color: c.is_primary ? 'var(--on-accent)' : 'var(--fg-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      }}>
                        {c.name.split(' ').map((w: string) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?'}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Name row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)' }}>{c.name}</span>
                          {c.is_primary && (
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              background: 'rgba(26,92,184,0.08)',
                              color: 'var(--brand-blue)',
                              border: '1px solid rgba(26,92,184,0.2)',
                              borderRadius: 10, padding: '1px 7px',
                              textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>
                              Primary
                            </span>
                          )}
                          {c.added_by === 'excel_import' && (
                            <span style={{
                              fontSize: 10, background: 'var(--bg-sunk)',
                              color: 'var(--fg-3)', borderRadius: 4, padding: '1px 5px',
                            }}>
                              Imported
                            </span>
                          )}
                        </div>

                        {/* Designation */}
                        {c.designation && (
                          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                            {c.designation}
                          </div>
                        )}

                        {/* Contact links */}
                        <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {c.phone && (
                            <a href={`tel:${c.phone}`} className="r-tap-link" style={CONTACT_LINK}>
                              📞 {c.phone}
                            </a>
                          )}
                          {c.email && (
                            <a href={`mailto:${c.email}`} className="r-tap-link" style={CONTACT_LINK}>
                              ✉ {c.email}
                            </a>
                          )}
                          {c.whatsapp && (
                            <a
                              href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`}
                              target="_blank" rel="noopener noreferrer"
                              className="r-tap-link"
                              style={{ ...CONTACT_LINK, color: '#25D366' }}
                            >
                              💬 WhatsApp
                            </a>
                          )}
                        </div>

                        {/* Notes */}
                        {c.notes && (
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 5, fontStyle: 'italic', lineHeight: 1.4 }}>
                            {c.notes}
                          </div>
                        )}

                        {/* Edit — live contacts only (Excel-imported show the Imported badge, no edit) */}
                        {canManageContacts && c.added_by !== 'excel_import' && (
                          <EditContactButton
                            contact={{
                              id: c.id,
                              name: c.name,
                              designation: c.designation,
                              phone: c.phone,
                              email: c.email,
                              whatsapp: c.whatsapp,
                              notes: c.notes,
                              is_primary: c.is_primary,
                            }}
                            clientId={Number(client.id)}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Opportunities — every stage. Won opportunities are the client's
                order in hand and lead the list; open pipeline follows. */}
            {allOpps.length > 0 && (
              <div data-tabgroup="activity" style={{ ...PANEL, marginBottom: 12 }}>
                <div style={PANEL_H}>
                  <span style={PANEL_TITLE}>Quotation Pipeline</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                    {allOpps.length} opp{allOpps.length === 1 ? '' : 's'} · {quotesAttached} attached
                    {quotesLegacy > 0 && ` · ${quotesLegacy} legacy`}
                  </span>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    <PipeStat label="Quoted value" value={formatRev(quotedPlusVal * 1e7)} sub={`≈ ${fmtUsdFromCr(quotedPlusVal, usdRate)}`} />
                    <PipeStat label="Won value" value={formatRev(wonValTotal * 1e7)} sub={`${wonCount} won`} color="var(--pos)" />
                    <PipeStat label="Win rate" value={winRatePct != null ? `${winRatePct}%` : '—'} sub={decidedCount > 0 ? `${wonCount}W · ${lostCount}L` : 'no decisions yet'} />
                    <PipeStat label="Order in hand" value={formatRev(wonTotal * 1e7)} sub="won · not yet in SO" color="var(--accent)" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {pipeRows.map(r => {
                      const hue = STAGE_HUE[r.stage] ?? '#6B7FA3';
                      const pct = Math.round((r.val / maxStageVal) * 100);
                      // The whole bar opens the pipeline board on this client and
                      // this stage. A summary that cannot be drilled into leaves
                      // the reader retyping the client code into a filter.
                      return (
                        <a
                          key={r.stage}
                          href={`/risansi/pipeline?client=${encodeURIComponent(client.code)}&stage=${encodeURIComponent(r.stage)}`}
                          title={`Open ${r.count} ${r.stage} opportunit${r.count === 1 ? 'y' : 'ies'} for ${client.code}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}
                        >
                          <span style={{ width: 82, flexShrink: 0, fontSize: 11, fontWeight: 600, color: hue }}>{r.stage}</span>
                          <div style={{ flex: 1, height: 18, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.max(pct, 3)}%`, background: `${hue}22`, borderLeft: `3px solid ${hue}` }} />
                          </div>
                          <span style={{ width: 40, flexShrink: 0, textAlign: 'right', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{r.count}</span>
                          <span style={{ width: 76, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{formatRev(r.val * 1e7)}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div data-tabgroup="activity" style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Opportunities{allOpps.length > 0 ? ` · ${allOpps.length}` : ''}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                  {wonTotal > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pos)' }}>
                      {formatRev(wonTotal * 1e7)} order in hand
                    </span>
                  )}
                  {pipelineTotal > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                      {formatRev(pipelineTotal * 1e7)} open
                    </span>
                  )}
                  <PipelineOppBtn />
                </div>
              </div>
              {allOpps.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No opportunities yet
                </div>
              ) : (
                <div>
                  {allOpps.map((o, i) => {
                    const isWon    = o.stage === 'Won';
                    const isClosed = o.stage === 'Lost' || o.stage === 'Dropped';
                    const tagKind  = isWon ? 'pos' : isClosed ? 'neg' : undefined;
                    return (
                    <div
                      key={o.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                        padding: '10px 14px',
                        borderBottom: i < allOpps.length - 1 ? '1px solid var(--line)' : 'none',
                        opacity: isClosed ? 0.6 : 1,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* The reference and the product open the opportunity
                            itself, on the pipeline board where it is edited. The
                            value on the right still opens the quotation document
                            — two different things to want, so two targets rather
                            than one row that guesses. */}
                        <a
                          href={`/risansi/pipeline?client=${encodeURIComponent(client.code)}&opp=${o.id}`}
                          title="Open this opportunity"
                          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                        >
                          <div style={{ fontSize: 11, color: 'var(--brand-blue)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                            {`OPP-${String(o.id).padStart(4, '0')}`}{o.quote_ref ? ` · ${o.quote_ref}` : ''}
                          </div>
                          <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 4 }}>{o.product}</div>
                        </a>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <Tag kind={tagKind} dot>{o.stage}</Tag>
                          {isWon && (() => {
                            const inHand = oihPerWon(o);
                            return inHand > 0
                              ? <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Open · {formatRev(inHand * 1e7)} in hand</span>
                              : <span style={{ fontSize: 11, color: 'var(--pos)', fontWeight: 600 }}>Closed · fully in SO</span>;
                          })()}
                          {!isWon && o.probability != null && (
                            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{o.probability}%</span>
                          )}
                          {o.revisions && o.revisions.length > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                              · re-priced {o.revisions.length}×
                            </span>
                          )}
                        </div>

                        {/* Revised-offer history — every re-price of this quote,
                            oldest first, so the movement is readable at a glance. */}
                        {o.revisions && o.revisions.length > 0 && (
                          <div style={{
                            marginTop: 7, paddingTop: 7, paddingLeft: 9,
                            borderTop: '1px solid var(--line)', borderLeft: '2px solid var(--accent-line)',
                          }}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                              Offer history
                            </div>
                            <OfferRevisionsList
                              revisions={o.revisions}
                              baseOfferInr={o.offer_value_inr ?? null}
                              usdRate={usdRate}
                              compact
                            />
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, marginLeft: 8, textAlign: 'right' }}>
                        {((o.doc_count ?? 0) > 0 ? `/api/risansi/opportunities/${o.id}/quotation` : quotationHref(o.quotation_link)) ? (
                          <a
                            href={(o.doc_count ?? 0) > 0
                              ? `/api/risansi/opportunities/${o.id}/quotation`
                              : quotationHref(o.quotation_link)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={(o.doc_count ?? 0) > 0
                              ? `Open the attached quotation${(o.doc_count ?? 0) > 1 ? ` (${o.doc_count} documents)` : ''}`
                              : `Legacy quotation link${quotationLinkCount(o.quotation_link) > 1
                                  ? ` (first of ${quotationLinkCount(o.quotation_link)})` : ''} — opens SharePoint`}
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
                              color: isWon ? 'var(--pos)' : 'var(--brand-blue)', textDecoration: 'none',
                            }}
                          >
                            {formatRev(Number(o.value_cr) * 1e7)} <span style={{ fontSize: 11 }}>↗</span>
                          </a>
                        ) : (
                          // No quotation to open, so the value opens the
                          // opportunity instead. Left as plain text it was the
                          // one part of the row that did nothing when clicked.
                          <a
                            href={`/risansi/pipeline?client=${encodeURIComponent(client.code)}&opp=${o.id}`}
                            title="No quotation attached — opens the opportunity"
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
                              color: isWon ? 'var(--pos)' : 'var(--fg)', textDecoration: 'none',
                            }}
                          >
                            {formatRev(Number(o.value_cr) * 1e7)}
                          </a>
                        )}
                        {/* A legacy record has to look different from a document
                            the portal holds, or the 679 of them keep reading as
                            attachments. A name-only record has nothing to link at
                            all, so without this badge it would vanish from the row
                            while the panel header above still counted it. */}
                        {(o.doc_count ?? 0) === 0 && isLegacyQuotation(o.quotation_link) && (
                          <div style={{ marginTop: 2 }}>
                            <LegacyMark
                              count={quotationLinkCount(o.quotation_link)}
                              noFile={quotationLinkCount(o.quotation_link) === 0}
                            />
                          </div>
                        )}
                        {Number(o.value_cr) > 0 && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 400, color: 'var(--fg-3)', marginTop: 1 }}>
                            ≈ {fmtUsdFromCr(Number(o.value_cr), usdRate)}
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Comments / notes — sits just above the Activity Log */}
            <ClientComments
              comments={clientComments}
              me={{ id: currentUser.id, email: currentUser.email, role: currentUser.role }}
              clientId={Number(client.id)}
            />

            {/* Activity log — full audit trail for this client */}
            <div data-tabgroup="activity" style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Activity Log{activityLog.length > 0 ? ` · ${activityLog.length}` : ''}</span>
              </div>
              {activityLog.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                  No activity logged
                </div>
              ) : (
                <div>
                  {activityLog.map((entry, i) => {
                    const d = new Date(entry.created_at);
                    const when = `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
                    const kind = activityKind(entry.entity_type, entry.summary);
                    return (
                      <div
                        key={entry.id}
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 3,
                          padding: '9px 14px',
                          borderBottom: i < activityLog.length - 1 ? '1px solid var(--line)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{
                            flexShrink: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.03em',
                            textTransform: 'uppercase', padding: '2px 7px', borderRadius: 10,
                            background: 'var(--bg-elev)', color: kind.color, border: `1px solid ${kind.color}33`,
                          }}>{kind.label}</span>
                          <span style={{ fontSize: 12, flex: 1, color: 'var(--fg)', lineHeight: 1.35 }}>{entry.summary}</span>
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--fg-3)', paddingLeft: 2 }}>
                          {entry.actor_name ?? 'Unknown'} · {when}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
        </MobileTabs>
      </div>
    </div>
  );
}

// Classify an audit_log entry into a display kind (label + accent colour).
// entity_type='client' covers several things, so we look at the summary text to
// tell a contact change / visit-plan change / opportunity / creation apart from
// a plain client-detail edit.
function activityKind(entityType: string, summary: string): { label: string; color: string } {
  const s = (summary || '').toLowerCase();
  if (entityType === 'visit') return { label: 'Visit', color: '#1A5CB8' };
  if (entityType === 'opportunity' || entityType === 'pipeline') return { label: 'Opportunity', color: '#c69347' };
  // entity_type === 'client' — disambiguate by the summary text (opportunity
  // check comes before pump so "opportunity … pump" still reads as Opportunity).
  if (s.includes('comment')) return { label: 'Comment', color: '#6366F1' };
  if (s.includes('contact')) return { label: 'Contact', color: '#0E7C6B' };
  if (s.includes('opportunity') || s.includes('quoted')) return { label: 'Opportunity', color: '#c69347' };
  if (s.includes('pump') || s.includes('equipment')) return { label: 'Equipment', color: '#B45309' };
  if (s.includes('visit')) return { label: 'Visit', color: '#1A5CB8' };
  if (s.startsWith('created:') || s.startsWith('created ')) return { label: 'New', color: '#1B873F' };
  return { label: 'Client', color: '#6B7280' };
}

// ── Sub-components ─────────────────────────────────────────────

function MiniKpi({ label, value, sub, neg = false, valueColor }: { label: string; value: string; sub?: string; neg?: boolean; valueColor?: string }) {
  return (
    <div style={PANEL}>
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500 }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, marginTop: 4, color: valueColor ?? (neg ? 'var(--neg)' : 'var(--fg)'), fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11, color: neg ? 'var(--neg)' : 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function PipeStat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, marginTop: 3, color: color ?? 'var(--fg)', lineHeight: 1.1, overflowWrap: 'anywhere' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RevenueChart({
  fyKeys,
  revByFY,
}: {
  fyKeys: string[];
  revByFY: Record<string, { pump: number; spare: number }>;
}) {
  const height = 100;
  const bw     = 28;
  const gap    = 12;
  const maxVal = Math.max(...fyKeys.map(f => revByFY[f].pump + revByFY[f].spare), 1);
  const totalW = fyKeys.length * (bw + gap) - gap;
  const padL   = 28;

  return (
    <svg width="100%" height="160" viewBox={`0 0 ${totalW + padL + 20} ${height + 30}`} preserveAspectRatio="xMinYMin meet" style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map(p => {
        const y = height - p * height;
        const label = (maxVal * p).toFixed(1);
        return (
          <g key={p}>
            <line x1={padL} x2={totalW + padL} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 3" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">
              {label}
            </text>
          </g>
        );
      })}

      {fyKeys.map((fyKey, i) => {
        const pump  = revByFY[fyKey].pump;
        const spare = revByFY[fyKey].spare;
        const ph    = (pump / maxVal) * height;
        const sh    = (spare / maxVal) * height;
        const x     = padL + i * (bw + gap);
        const total = pump + spare;
        return (
          <g key={fyKey}>
            {sh > 0 && <rect x={x} y={height - ph - sh} width={bw} height={sh} rx={1.5} fill="var(--brand-cyan)" />}
            {ph > 0 && <rect x={x} y={height - ph} width={bw} height={ph} rx={1.5} fill="var(--accent)" />}
            {total > 0 && (
              <text x={x + bw / 2} y={height - ph - sh - 3} textAnchor="middle" fontSize="9" fill="var(--fg-2)" fontFamily="var(--font-mono)">
                {total.toFixed(1)}
              </text>
            )}
            <text x={x + bw / 2} y={height + 12} textAnchor="middle" fontSize="10" fill="var(--fg-3)" fontFamily="var(--font-mono)">
              {fyShortLabel(fyKey)}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${padL}, ${height + 22})`}>
        <rect width="8" height="8" rx="1" fill="var(--accent)" />
        <text x="12" y="8" fontSize="11" fill="var(--fg-2)" fontFamily="var(--font-mono)">Pump</text>
        <rect x="50" width="8" height="8" rx="1" fill="var(--brand-cyan)" />
        <text x="62" y="8" fontSize="11" fill="var(--fg-2)" fontFamily="var(--font-mono)">Spare</text>
      </g>
    </svg>
  );
}

// ── Style constants ────────────────────────────────────────────

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
};

const PANEL_H: CSSProperties = {
  padding: '12px 14px', borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center', gap: 10,
};

const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };

const MICRO_LBL: CSSProperties = { fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 500 };

const REV_TH: CSSProperties = {
  padding: '5px 8px', textAlign: 'right', fontSize: 10,
  fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', fontWeight: 400,
};

// Compact stat tiles for the "Risansi pumps here" headline (PCP/MMP counts + share).
const RIL_STAT: CSSProperties = {
  flex: '1 1 120px', minWidth: 120, padding: '8px 10px',
  background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8,
};
const RIL_STAT_LBL: CSSProperties = {
  fontSize: 9.5, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.08em',
};
const RIL_STAT_VAL: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.2, marginTop: 2,
};
const RIL_STAT_SUB: CSSProperties = { fontSize: 10, color: 'var(--fg-3)', marginTop: 1 };


const CONTACT_LINK: CSSProperties = {
  fontSize: 12, color: 'var(--brand-blue)',
  textDecoration: 'none', display: 'flex',
  alignItems: 'center', gap: 4,
};

const LOC_LBL: CSSProperties = {
  fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase',
  letterSpacing: '0.10em', fontWeight: 500, marginBottom: 3,
};

const LOC_VAL: CSSProperties = { fontSize: 13, color: 'var(--fg)' };

const MAPS_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
  padding: '8px 12px', fontSize: 12, fontWeight: 500,
  background: 'var(--accent-soft)', color: 'var(--title)', border: '1px solid var(--accent-line)',
  borderRadius: 6, textDecoration: 'none',
};
