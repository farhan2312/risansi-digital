'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { checkInNewVisit } from '@/app/actions/risansi';
import type { ClientOption } from './page';

const PURPOSES = ['Routine', 'Quote Follow-up', 'New Opp', 'Complaint', 'Equipment Assessment', 'Mgmt Relationship'];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function NewVisitClient({
  repId,
  repName,
  clients,
}: {
  repId: string | null;
  repName: string;
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<ClientOption | null>(null);
  const [purpose,  setPurpose]  = useState('Routine');
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'done' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');

  // Show the whole client list by default; filter it as the rep types.
  const filtered = search.trim()
    ? clients.filter(c =>
        c.legal_name.toLowerCase().includes(search.toLowerCase()) ||
        c.client_code.toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  const handleSelect = (client: ClientOption) => {
    setSelected(client);
    setSearch('');
  };

  const handleCheckIn = () => {
    if (!selected || !repId) return;
    setGpsState('locating');
    setStatusMsg('Getting your location…');

    const doCheckIn = async (lat: number | null, lng: number | null) => {
      setStatusMsg('Checking in…');
      let res: Awaited<ReturnType<typeof checkInNewVisit>>;
      try {
        res = await checkInNewVisit({
          clientId: selected.id,
          repId,
          visitDate: todayStr(),
          purpose,
          gpsLat: lat,
          gpsLng: lng,
        });
      } catch {
        res = { ok: false, error: 'Check-in failed. Please try again.' };
      }
      if (res.ok) {
        setGpsState('done');
        setStatusMsg('Checked in! Opening report…');
        const visitId = res.id;
        startTransition(() => {
          // The unified report (same one the mobile home page's "resume visit"
          // links use) — it's already responsive; the old mobile-only wizard at
          // /risansi/mobile/visit/[id]/report was retired (see risansi.ts).
          router.push(`/risansi/visits/${visitId}`);
        });
      } else {
        // The reason, not "failed": which rep the client belongs to, or that
        // nobody owns it yet.
        setGpsState('error');
        setStatusMsg(res.error);
      }
    };

    if (!navigator.geolocation) {
      doCheckIn(null, null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => doCheckIn(pos.coords.latitude, pos.coords.longitude),
      ()    => {
        setStatusMsg('Location unavailable — checking in without GPS…');
        doCheckIn(null, null);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const isChecking = gpsState === 'locating' || gpsState === 'done';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={HEADER}>
        <button onClick={() => router.back()} style={BACK_BTN} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4L6 9l5 5"/>
          </svg>
        </button>
        <span style={{ fontSize: 16, fontWeight: 500 }}>Start Visit</span>
        <div style={{ width: 32 }} />
      </div>

      <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>

        {/* No rep configured warning */}
        {!repId && (
          <div style={{
            background: 'oklch(0.97 0.06 80)', border: '1px solid oklch(0.88 0.10 80)',
            borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: 'oklch(0.40 0.14 60)',
          }}>
            Your account is not linked to a rep profile. Check-ins will not be attributed.
          </div>
        )}

        {/* Client search / selected card */}
        {!selected ? (
          <div>
            <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', paddingBottom: 8 }}>
              <label style={LABEL}>Select Client</label>
              <div style={{ position: 'relative', marginTop: 6 }}>
                <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)', pointerEvents: 'none' }}
                  width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/>
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or code…"
                  style={{ ...INPUT, paddingLeft: 36 }}
                  autoFocus
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
                {filtered.length} client{filtered.length !== 1 ? 's' : ''}{search.trim() ? ' match' : ' · tap one to start'}
              </div>
            </div>

            {clients.length === 0 ? (
              <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
                No clients available for your account.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
                No clients match “{search}”.
              </div>
            ) : (
              <div style={{
                marginTop: 4, background: 'var(--bg-paper)',
                border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden',
              }}>
                {filtered.map((c, i) => (
                  <button key={c.id} onClick={() => handleSelect(c)} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '12px 14px',
                    background: 'none', border: 'none',
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none',
                    cursor: 'pointer',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{c.legal_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {c.client_code}{c.industry ? ` · ${c.industry}` : ''}
                      {c.days_since != null ? ` · ${c.days_since}d ago` : ' · Never visited'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* Selected client card */}
            <div style={{
              background: 'var(--bg-paper)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg)' }}>{selected.legal_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                    {selected.client_code} · {selected.industry}
                  </div>
                  <div style={{ fontSize: 12, color: selected.days_since != null && selected.days_since > 90 ? 'var(--neg)' : 'var(--fg-3)', marginTop: 8 }}>
                    {selected.days_since != null
                      ? `Last visited ${selected.days_since} day${selected.days_since !== 1 ? 's' : ''} ago`
                      : 'No previous visits'}
                  </div>
                </div>
                <button onClick={() => { setSelected(null); setGpsState('idle'); setStatusMsg(''); }}
                  style={{ ...BACK_BTN, width: 30, height: 30, borderRadius: 8, fontSize: 18, color: 'var(--fg-3)' }}>
                  ×
                </button>
              </div>
            </div>

            {/* Purpose selector */}
            <div style={{ marginTop: 16 }}>
              <label style={LABEL}>Visit Purpose</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {PURPOSES.map(p => (
                  <button key={p} onClick={() => setPurpose(p)} style={{
                    padding: '7px 14px', borderRadius: 20, fontSize: 12,
                    fontFamily: 'inherit', cursor: 'pointer',
                    fontWeight: purpose === p ? 500 : 400,
                    background: purpose === p ? 'var(--accent)' : 'var(--bg-elev)',
                    color: purpose === p ? '#fff' : 'var(--fg)',
                    border: purpose === p ? '1px solid var(--accent)' : '1px solid var(--line)',
                  }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* GPS status */}
            {statusMsg && (
              <div style={{
                marginTop: 16, padding: '10px 14px',
                background: gpsState === 'error' ? 'oklch(0.97 0.04 15)' : 'var(--accent-soft)',
                border: `1px solid ${gpsState === 'error' ? 'oklch(0.88 0.07 15)' : 'var(--accent-line)'}`,
                borderRadius: 8, fontSize: 12,
                color: gpsState === 'error' ? 'var(--neg)' : 'var(--accent)',
              }}>
                {statusMsg}
              </div>
            )}

            {/* Check In button */}
            <button
              onClick={handleCheckIn}
              disabled={isChecking}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', marginTop: 20, padding: '14px',
                fontSize: 15, fontFamily: 'inherit', fontWeight: 600,
                background: isChecking ? 'var(--bg-sunk)' : 'var(--accent)',
                color: isChecking ? 'var(--fg-3)' : '#fff',
                border: 'none', borderRadius: 12, cursor: isChecking ? 'not-allowed' : 'pointer',
              }}
            >
              {gpsState === 'locating' ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="8" cy="8" r="5"/>
                    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>
                  </svg>
                  Locating…
                </>
              ) : gpsState === 'done' ? (
                'Opening report…'
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="5"/>
                    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>
                    <path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>
                  </svg>
                  Check In
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────

const HEADER: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px',
  background: 'var(--bg-paper)',
  borderBottom: '1px solid var(--line)',
  position: 'sticky', top: 0, zIndex: 10,
};

const BACK_BTN: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 8,
  background: 'var(--bg-elev)', border: '1px solid var(--line)',
  color: 'var(--fg)', cursor: 'pointer',
};

const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.10em', color: 'var(--fg-3)',
};

const INPUT: CSSProperties = {
  width: '100%', height: 44, padding: '0 12px',
  fontSize: 14, fontFamily: 'inherit',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  borderRadius: 8, color: 'var(--fg)', outline: 'none',
  boxSizing: 'border-box',
};
