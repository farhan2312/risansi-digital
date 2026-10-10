'use client';

import { useEffect } from 'react';

export default function RisansiError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[Risansi]', error);
  }, [error]);

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
        padding:   '48px 32px',
        maxWidth:  400,
      }}>
        {/* Error icon strip */}
        <div style={{
          width:        44,
          height:       44,
          borderRadius: 8,
          background:   'var(--neg-soft)',
          border:       '1px solid rgba(220,38,38,0.20)',
          display:      'grid',
          placeItems:   'center',
          margin:       '0 auto 20px',
          fontSize:     22,
        }}>
          ⚠
        </div>

        <h1 style={{
          fontSize:      18,
          fontWeight:    500,
          letterSpacing: '-0.01em',
          color:         'var(--fg)',
          margin:        '0 0 10px',
        }}>
          Something went wrong
        </h1>

        <p style={{
          fontSize:   13,
          color:      'var(--fg-3)',
          lineHeight: 1.6,
          margin:     '0 0 6px',
        }}>
          An unexpected error occurred while rendering this page.
        </p>

        {/* digest for server-side log correlation */}
        {error.digest && (
          <p style={{
            fontSize:   11,
            color:      'var(--fg-3)',
            fontFamily: 'var(--font-mono)',
            margin:     '0 0 28px',
          }}>
            Error ID: {error.digest}
          </p>
        )}
        {!error.digest && <div style={{ marginBottom: 28 }} />}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={unstable_retry}
            style={{
              display:       'inline-flex',
              alignItems:    'center',
              gap:           6,
              padding:       '9px 18px',
              minHeight:     40,
              fontSize:      13,
              fontFamily:    'inherit',
              fontWeight:    500,
              background:    'var(--accent-fill)',
              color:         'var(--on-accent)',
              border:        'none',
              borderRadius:  6,
              cursor:        'pointer',
              letterSpacing: '-0.005em',
            }}
          >
            Try again
          </button>
          {/* Escape route — if retry keeps failing the rep isn't stuck here. */}
          <a
            href="/risansi"
            style={{
              display:       'inline-flex',
              alignItems:    'center',
              padding:       '9px 18px',
              minHeight:     40,
              fontSize:      13,
              fontWeight:    500,
              background:    'var(--bg-paper)',
              color:         'var(--fg-2)',
              border:        '1px solid var(--line-strong)',
              borderRadius:  6,
              textDecoration: 'none',
            }}
          >
            Go to Home
          </a>
        </div>
      </div>
    </div>
  );
}
