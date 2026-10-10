import Link from 'next/link';

export default function RisansiNotFound() {
  return (
    <div style={{
      flex: 1,
      display: 'grid',
      placeItems: 'center',
      height: '100%',
      background: 'var(--bg)',
    }}>
      <div style={{
        textAlign: 'center',
        padding: '48px 32px',
        maxWidth: 360,
      }}>
        {/* Numeric callout */}
        <div style={{
          fontFamily:         'var(--font-mono)',
          fontSize:           72,
          fontWeight:         400,
          letterSpacing:      '-0.04em',
          color:              'var(--line-strong, rgba(28,26,23,0.15))',
          lineHeight:         1,
          marginBottom:       16,
          fontVariantNumeric: 'tabular-nums',
        }}>
          404
        </div>

        <h1 style={{
          fontSize:      18,
          fontWeight:    500,
          letterSpacing: '-0.01em',
          color:         'var(--fg)',
          margin:        '0 0 10px',
        }}>
          Page not found
        </h1>

        <p style={{
          fontSize:   13,
          color:      'var(--fg-3)',
          lineHeight: 1.6,
          margin:     '0 0 28px',
        }}>
          The page you requested doesn't exist or has been moved.
        </p>

        <Link href="/risansi" style={{
          display:       'inline-flex',
          alignItems:    'center',
          gap:           6,
          padding:       '8px 18px',
          fontSize:      13,
          fontFamily:    'var(--font-sans, inherit)',
          fontWeight:    500,
          background:    'var(--accent-fill)',
          color:         'var(--on-accent)',
          borderRadius:  6,
          textDecoration: 'none',
          letterSpacing: '-0.005em',
        }}>
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
