'use client';

import { useState } from 'react';
import { AddContactDrawer } from './AddContactDrawer';

export function AddContactButton({
  clientId,
  clientCode: _clientCode,
}: {
  clientId:   number;
  clientCode: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 10px',
          background: 'var(--title)',
          color: 'white', border: 'none',
          borderRadius: 6, fontSize: 12,
          fontWeight: 500, fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        + Add Contact
      </button>

      {open && (
        <AddContactDrawer
          clientId={clientId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
