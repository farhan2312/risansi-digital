'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deletePumpUpload } from '@/app/actions/risansi-pumps';

export function DeletePumpUploadButton({ logId }: { logId: number }) {
  const router    = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  if (confirming) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              await deletePumpUpload(logId);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Delete failed');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          style={{
            padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit',
            background: 'var(--neg-fill)', color: 'var(--on-accent)',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 11,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '…' : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          style={{
            padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit',
            background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          Cancel
        </button>
        {error && <span style={{ fontSize: 10.5, color: 'var(--neg)', alignSelf: 'center' }}>{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit',
        background: 'transparent', border: '1px solid #F87171',
        color: 'var(--neg)', cursor: 'pointer', fontSize: 11,
      }}
    >
      Delete
    </button>
  );
}
