// Skeleton shown immediately while the exec dashboard server component fetches data.
// The real sidebar renders from layout — this only covers the main content area.
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
        <div className="shimmer" style={{ width: 260, height: 26, borderRadius: 4, marginBottom: 8 }} />
        <div className="shimmer" style={{ width: 180, height: 14, borderRadius: 4, marginBottom: 24 }} />

        {/* Hero KPI row — 4 cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div className="shimmer" style={{ height: 120, borderRadius: 6 }} />
          <div className="shimmer" style={{ height: 120, borderRadius: 6 }} />
          <div className="shimmer" style={{ height: 120, borderRadius: 6 }} />
          <div className="shimmer" style={{ height: 120, borderRadius: 6 }} />
        </div>

        {/* Mid row — 3 panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.5fr', gap: 14, marginBottom: 14 }}>
          <div className="shimmer" style={{ height: 220, borderRadius: 6 }} />
          <div className="shimmer" style={{ height: 220, borderRadius: 6 }} />
          <div className="shimmer" style={{ height: 220, borderRadius: 6 }} />
        </div>

        {/* Bottom row — 2 panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
          <div className="shimmer" style={{ height: 280, borderRadius: 6 }} />
          <div className="shimmer" style={{ height: 280, borderRadius: 6 }} />
        </div>
      </div>
    </div>
  );
}
