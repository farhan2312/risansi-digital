'use client';

export function RefreshButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 11px',
        fontSize: 12,
        fontFamily: 'inherit',
        fontWeight: 500,
        background: 'var(--bg-paper)',
        border: '1px solid var(--line-strong)',
        color: 'var(--fg)',
        borderRadius: 5,
        cursor: 'pointer',
      }}
    >
      <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 8A5 5 0 1 1 8 3M13 3v5h-5"/>
      </svg>
      Refresh
    </button>
  );
}
