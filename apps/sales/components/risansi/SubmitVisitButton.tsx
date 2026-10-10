'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitVisit } from '@/app/actions/risansi-visits';

export function SubmitVisitButton({ visitId }: { visitId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);
  // Why it would not submit. The action used to throw, and this button had no
  // catch, so a refusal arrived as nothing happening at all — the page did not
  // refresh, the spinner reset, and the rep pressed the button again.
  const [error, setError]           = useState('');
  const router = useRouter();

  if (confirming) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', maxWidth: 280, textAlign: 'right' }}>
          This will <strong>close the visit</strong> and create any auto-generated items.
          You cannot edit after submitting.
        </div>
        {error && (
          <div role="alert" style={{
            maxWidth: 320, textAlign: 'left', padding: '8px 11px', fontSize: 12, lineHeight: 1.45,
            background: 'var(--neg-soft)', border: '1px solid var(--neg)',
            borderRadius: 6, color: 'var(--neg-strong)',
          }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setConfirming(false)}
            style={{
              padding: '7px 14px', borderRadius: 6,
              border: '1px solid var(--line-strong)',
              background: 'white', cursor: 'pointer', fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setLoading(true); setError('');
              try {
                const res = await submitVisit(visitId);
                if (!res.ok) { setError(res.error); return; }
                router.refresh();
              } catch (e) {
                // Anything the action did not anticipate. Still better than
                // silence, even though the message will be a redacted one.
                setError(e instanceof Error ? e.message : 'The visit could not be submitted. Try again.');
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{
              padding: '7px 16px', borderRadius: 6,
              background: '#059669', color: 'white',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Submitting…' : '✓ Confirm Submit'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        padding: '8px 18px', borderRadius: 6,
        background: 'var(--accent-fill)', color: 'var(--on-accent)',
        border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
      }}
    >
      Submit Visit Report
    </button>
  );
}
