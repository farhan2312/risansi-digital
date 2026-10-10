export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar placeholder */}
      <div style={{
        height: 52, flexShrink: 0,
        background: 'var(--bg-paper)',
        borderBottom: '1px solid var(--line)',
      }} />

      <div style={{ flex: 1, padding: '22px 24px 40px', background: 'var(--bg)', overflowY: 'auto' }}>
        {/* Header skeleton */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: 20,
        }}>
          <div>
            <div className="shimmer" style={{ height: 28, width: 300, borderRadius: 4, marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              {[80, 70, 90, 60].map((w, i) => (
                <div key={i} className="shimmer" style={{ height: 22, width: w, borderRadius: 10 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <div className="shimmer" style={{ height: 14, width: 140, borderRadius: 3 }} />
              <div className="shimmer" style={{ height: 14, width: 100, borderRadius: 3 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {[100, 130, 90].map((w, i) => (
              <div key={i} className="shimmer" style={{ height: 34, width: w, borderRadius: 6 }} />
            ))}
          </div>
        </div>

        {/* 4 KPI cards skeleton */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12, marginBottom: 16,
        }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{
              background: 'var(--bg-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius)', padding: 12,
            }}>
              <div className="shimmer" style={{ height: 11, width: 80, borderRadius: 3, marginBottom: 8 }} />
              <div className="shimmer" style={{ height: 24, width: 100, borderRadius: 4 }} />
              <div className="shimmer" style={{ height: 11, width: 120, borderRadius: 3, marginTop: 6 }} />
            </div>
          ))}
        </div>

        {/* Two-column content skeleton */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.8fr 1fr',
          gap: 14,
        }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="shimmer" style={{ height: 280, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 200, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 160, borderRadius: 6 }} />
          </div>
          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="shimmer" style={{ height: 180, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 200, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 120, borderRadius: 6 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
