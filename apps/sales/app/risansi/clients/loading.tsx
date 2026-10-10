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
        {/* Page title */}
        <div className="shimmer" style={{ width: 100, height: 26, borderRadius: 4, marginBottom: 8 }} />
        <div className="shimmer" style={{ width: 200, height: 14, borderRadius: 4, marginBottom: 16 }} />

        {/* Filter bar skeleton */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[120, 100, 80, 90, 110].map((w, i) => (
            <div key={i} className="shimmer" style={{ height: 34, width: w, borderRadius: 6 }} />
          ))}
        </div>
        <div style={{ height: 8, marginBottom: 8 }} />

        {/* Table skeleton */}
        <div style={{
          background: 'var(--bg-paper)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div className="shimmer" style={{ height: 44, borderRadius: 0, borderBottom: '2px solid var(--line)' }} />
          {/* Rows */}
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} style={{
              height: 52,
              borderBottom: '1px solid var(--line)',
              padding: '0 16px',
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <div className="shimmer" style={{ height: 14, width: 80,  borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ height: 14, width: 200, borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ height: 20, width: 70,  borderRadius: 10, flexShrink: 0 }} />
              <div className="shimmer" style={{ height: 14, width: 80,  borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ height: 28, width: 28,  borderRadius: 6, flexShrink: 0 }} />
              <div className="shimmer" style={{ height: 14, width: 60,  borderRadius: 3, flexShrink: 0 }} />
              <div className="shimmer" style={{ height: 14, width: 70,  borderRadius: 3, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
