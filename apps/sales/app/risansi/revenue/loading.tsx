export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar placeholder */}
      <div style={{ height: 52, background: 'var(--bg-paper)', borderBottom: '1px solid var(--line)', flexShrink: 0 }} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <div className="skeleton" style={{ height: 26, width: 220, marginBottom: 8, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 13, width: 320, borderRadius: 4 }} />
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderLeft: '3px solid var(--brand-blue)', borderRadius: 6, padding: 16 }}>
              <div className="skeleton" style={{ height: 10, width: '55%', marginBottom: 10, borderRadius: 3 }} />
              <div className="skeleton" style={{ height: 22, width: '70%', marginBottom: 8, borderRadius: 3 }} />
              <div className="skeleton" style={{ height: 11, width: '40%', borderRadius: 3 }} />
            </div>
          ))}
        </div>

        {/* YoY + category row */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 6 }}>
            <div style={{ height: 44, borderBottom: '1px solid var(--line)', padding: '12px 16px', display: 'flex', gap: 8 }}>
              <div className="skeleton" style={{ height: 11, width: 200, borderRadius: 3 }} />
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ flex: 1, borderRadius: 2, height: `${30 + i * 10}%` }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 11, width: 30, borderRadius: 3 }} />
                ))}
              </div>
            </div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 6 }}>
            <div style={{ height: 44, borderBottom: '1px solid var(--line)', padding: '12px 16px' }}>
              <div className="skeleton" style={{ height: 11, width: 140, borderRadius: 3 }} />
            </div>
            <div style={{ padding: 16 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div className="skeleton" style={{ height: 12, width: 100, borderRadius: 3 }} />
                    <div className="skeleton" style={{ height: 12, width: 60, borderRadius: 3 }} />
                  </div>
                  <div className="skeleton" style={{ height: 5, borderRadius: 2 }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Industry + clients row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 14, marginBottom: 14 }}>
          {[1, 2].map(p => (
            <div key={p} style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 6 }}>
              <div style={{ height: 44, borderBottom: '1px solid var(--line)', padding: '12px 16px' }}>
                <div className="skeleton" style={{ height: 11, width: 160, borderRadius: 3 }} />
              </div>
              <div style={{ padding: 16 }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div className="skeleton" style={{ height: 12, width: `${50 + i * 5}%`, borderRadius: 3 }} />
                      <div className="skeleton" style={{ height: 12, width: 50, borderRadius: 3 }} />
                    </div>
                    <div className="skeleton" style={{ height: 5, borderRadius: 2 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Zone table */}
        <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ height: 44, borderBottom: '1px solid var(--line)', padding: '12px 16px' }}>
            <div className="skeleton" style={{ height: 11, width: 200, borderRadius: 3 }} />
          </div>
          <div style={{ padding: 0 }}>
            <div style={{ background: 'var(--accent-soft)', height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
              {[80, 120, 60, 80, 80, 60, 100].map((w, i) => (
                <div key={i} className="skeleton" style={{ height: 9, width: w, borderRadius: 3 }} />
              ))}
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: i < 5 ? '1px solid var(--line)' : 'none' }}>
                {[80, 120, 60, 80, 80, 60, 100].map((w, j) => (
                  <div key={j} className="skeleton" style={{ height: 12, width: w, borderRadius: 3 }} />
                ))}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
