import { Topbar } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';
import { SettingsForm } from './SettingsForm';
import { UsdRateForm } from './UsdRateForm';
import { RepTargetsForm } from './RepTargetsForm';
import { ComplaintEditOverrideForm } from './ComplaintEditOverrideForm';
import { DEFAULT_USD_INR_RATE, complaintEditOverride, COMPLAINT_EDIT_OVERRIDE_KEY } from '@/lib/risansi-settings';
import { getRepTargets, equalShareCr, DEFAULT_ANNUAL_TARGET_CR } from '@/lib/risansi-targets';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') {
    return <AccessDenied crumbs={['System Admin', 'Settings']} />;
  }

  let annualTarget = '32';
  let updatedBy: string | null = null;
  let updatedAt: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ value: string; updated_by: string | null; updated_at: string | null }>(
      `SELECT value, updated_by, to_char(updated_at,'DD Mon YYYY, HH24:MI') AS updated_at
         FROM app_settings WHERE key = 'annual_target_cr' LIMIT 1`,
    );
    if (rows[0]) { annualTarget = rows[0].value; updatedBy = rows[0].updated_by; updatedAt = rows[0].updated_at; }
  } catch { /* table may not exist yet */ }

  let usdRate = String(DEFAULT_USD_INR_RATE);
  let usdUpdatedBy: string | null = null;
  let usdUpdatedAt: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ value: string; updated_by: string | null; updated_at: string | null }>(
      `SELECT value, updated_by, to_char(updated_at,'DD Mon YYYY, HH24:MI') AS updated_at
         FROM app_settings WHERE key = 'usd_inr_rate' LIMIT 1`,
    );
    if (rows[0]) { usdRate = rows[0].value; usdUpdatedBy = rows[0].updated_by; usdUpdatedAt = rows[0].updated_at; }
  } catch { /* table may not exist yet */ }

  const editOverride = await complaintEditOverride();
  let ovUpdatedBy: string | null = null;
  let ovUpdatedAt: string | null = null;
  try {
    const { rows } = await risansiPool.query<{ updated_by: string | null; updated_at: string | null }>(
      `SELECT updated_by, to_char(updated_at,'DD Mon YYYY, HH24:MI') AS updated_at
         FROM app_settings WHERE key = $1 LIMIT 1`, [COMPLAINT_EDIT_OVERRIDE_KEY]);
    if (rows[0]) { ovUpdatedBy = rows[0].updated_by; ovUpdatedAt = rows[0].updated_at; }
  } catch { /* table may not exist yet */ }

  // The per-rep split. The company figure above stays the one that is edited
  // and the one the dashboards show; this list is held against it so a split
  // that does not add up is visible rather than quietly reconciled.
  const reps = await getRepTargets();
  const companyTargetCr = Number.isFinite(parseFloat(annualTarget)) && parseFloat(annualTarget) > 0
    ? parseFloat(annualTarget) : DEFAULT_ANNUAL_TARGET_CR;
  const share = equalShareCr(companyTargetCr, reps.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Settings']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Settings</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>Company-wide configuration</div>
        </div>

        <div style={{ maxWidth: 460, background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Annual Revenue Target</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 14 }}>
            Shown on the Executive Dashboard. Enter the company-wide target in Crores (₹).
          </div>
          <SettingsForm current={annualTarget} />
          {updatedAt && (
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 12 }}>
              Last updated {updatedAt}{updatedBy ? ` by ${updatedBy}` : ''}
            </div>
          )}
        </div>

        <div style={{ maxWidth: 460, background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 20, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>USD → INR Rate</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 14 }}>
            Used to show quoted values in USD alongside ₹ on the Opportunities and Client pages. Enter how many rupees equal $1.
          </div>
          <UsdRateForm current={usdRate} />
          {usdUpdatedAt && (
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 12 }}>
              Last updated {usdUpdatedAt}{usdUpdatedBy ? ` by ${usdUpdatedBy}` : ''}
            </div>
          )}
        </div>

        <div style={{ maxWidth: 560, background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 20, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Complaint Editing</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 14, lineHeight: 1.5 }}>
            Normally a complaint page is editable only by its department, the person it is assigned
            to, or the rep who works the client &mdash; and a closed complaint is read-only for
            everyone but an admin. <strong style={{ color: 'var(--fg-2)' }}>Open to all</strong> lifts
            those three rules for anyone who can already see the complaint, so documents can be
            attached to older and closed records. It does not change who can see a complaint, and it
            does not let anyone move a complaint between statuses.
          </div>
          <ComplaintEditOverrideForm current={editOverride} />
          {ovUpdatedAt && (
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 12 }}>
              Last changed {ovUpdatedAt}{ovUpdatedBy ? ` by ${ovUpdatedBy}` : ''}
            </div>
          )}
        </div>

        <div style={{ maxWidth: 680, background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 20, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Targets by Rep</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
            Each rep&rsquo;s own share of the year, in Crores. Reps and managers only; admin and
            back-office accounts carry no quota.
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 14, lineHeight: 1.5 }}>
            Provisional: every rep currently holds an equal share of the company target. Replace
            them when the split from management arrives.
          </div>
          <RepTargetsForm reps={reps} companyTargetCr={companyTargetCr} equalShareCr={share} />
        </div>
      </div>
    </div>
  );
}
