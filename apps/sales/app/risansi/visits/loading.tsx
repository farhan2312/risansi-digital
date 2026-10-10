export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar placeholder */}
      <div style={{
        height: 52, flexShrink: 0,
        background: 'var(--bg-paper)',
        borderBottom: '1px solid var(--line)',
      }} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header skeleton */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div className="shimmer" style={{ height: 26, width: 160, borderRadius: 4, marginBottom: 8 }} />
            <div className="shimmer" style={{ height: 14, width: 240, borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="shimmer" style={{ height: 30, width: 140, borderRadius: 20 }} />
            <div className="shimmer" style={{ height: 30, width: 100, borderRadius: 20 }} />
            <div className="shimmer" style={{ height: 32, width: 110, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 32, width: 170, borderRadius: 6 }} />
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
          <div className="shimmer" style={{ height: 34, width: 90, borderRadius: '4px 4px 0 0' }} />
          <div className="shimmer" style={{ height: 34, width: 120, borderRadius: '4px 4px 0 0', opacity: 0.5 }} />
        </div>

        {/* Grid skeleton */}
        <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '140px repeat(7, 1fr)',
            background: 'var(--bg-elev)', borderBottom: '2px solid var(--line)',
          }}>
            <div style={{ padding: '12px', borderRight: '1px solid var(--line)' }}>
              <div className="shimmer" style={{ height: 10, width: 30, borderRadius: 3 }} />
            </div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ padding: '8px 6px', textAlign: 'center', borderRight: '1px solid rgba(0,0,0,0.05)' }}>
                <div className="shimmer" style={{ height: 10, width: '60%', borderRadius: 3, margin: '0 auto 4px' }} />
                <div className="shimmer" style={{ height: 13, width: '40%', borderRadius: 3, margin: '0 auto' }} />
              </div>
            ))}
          </div>

          {/* Rep rows */}
          {Array.from({ length: 4 }).map((_, row) => (
            <div key={row} style={{
              display: 'grid', gridTemplateColumns: '140px repeat(7, 1fr)',
              borderBottom: row < 3 ? '1px solid var(--line)' : 'none',
              minHeight: 80,
            }}>
              {/* Rep cell */}
              <div style={{
                padding: '10px 10px', borderRight: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div className="shimmer" style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0 }} />
                <div>
                  <div className="shimmer" style={{ height: 11, width: 72, borderRadius: 3, marginBottom: 4 }} />
                  <div className="shimmer" style={{ height: 9, width: 48, borderRadius: 3 }} />
                </div>
              </div>
              {/* Day cells */}
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={col} style={{ padding: 4, borderRight: '1px solid rgba(0,0,0,0.04)' }}>
                  {(row * 7 + col) % 3 === 0 && (
                    <div className="shimmer" style={{ height: 52, borderRadius: 4 }} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
