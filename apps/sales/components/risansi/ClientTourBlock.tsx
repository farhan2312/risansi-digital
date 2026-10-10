'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { TourAssignPicker } from './TourAssignPicker';

// The tour line on Client 360, with a way to change it.
//
// It used to render the tour name and nothing else, and disappear entirely when
// a client had none — so the clients that most needed mapping were the ones
// showing no control at all. Anyone who can open this page can map the client;
// the server action checks the same thing.
//
// Mapping does NOT change who owns the account. Ownership lives on the client —
// clients.primary_rep_id and client_secondary_reps — and resolveClientPrimaryRep
// reads only those. The tour is the route the client sits on; tour_routes has a
// primary_rep_id of its own, but nothing resolves ownership through it. The copy
// here is careful about that, because a rep who thinks this button hands the
// account over will not press it.

export function ClientTourBlock({ clientId, tourName, tourZone }: {
  clientId: string;
  tourName: string | null;
  tourZone: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState<{ owner: string | null; tour: string | null } | null>(null);

  if (done) {
    return (
      <div style={{ fontSize: 12, color: 'var(--pos-strong, var(--pos))' }}>
        Mapped to <strong>{done.tour}</strong>
        {done.owner && <span style={{ color: 'var(--fg-3)' }}> · owner unchanged: {done.owner}</span>}
      </div>
    );
  }

  if (editing) {
    return (
      <div style={{ minWidth: 260, maxWidth: 420 }}>
        <TourAssignPicker
          clientId={clientId}
          onAssigned={(owner, tour) => {
            setDone({ owner, tour });
            setEditing(false);
            router.refresh();
          }}
        />
        <button type="button" onClick={() => setEditing(false)} style={LINK}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={LABEL}>Tour</span>
      {tourName ? (
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {tourName}
          {tourZone && <span style={{ fontWeight: 400, color: 'var(--fg-3)', marginLeft: 4 }}>· {tourZone}</span>}
        </span>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>Not mapped</span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={tourName
          ? 'Move this client to another route. This does not change who owns the account.'
          : 'Put this client on a route. This does not change who owns the account.'}
        style={LINK}
      >
        {tourName ? 'Change' : 'Map to a tour'}
      </button>
    </div>
  );
}

const LABEL: CSSProperties = {
  fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 500,
};
const LINK: CSSProperties = {
  background: 'none', border: 'none', padding: 0, marginLeft: 2,
  font: 'inherit', fontSize: 11, color: 'var(--accent)', cursor: 'pointer',
  textDecoration: 'underline', textUnderlineOffset: 2,
};
