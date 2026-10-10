'use client';

/**
 * The Request access control that sits inside a tile.
 *
 * A Client Component only because it needs `useActionState` to show what came
 * back — the error or the confirmation. Without JavaScript the form still
 * posts and the page still re-renders with the tile flipped to Requested,
 * which is the progressive-enhancement behaviour Server Actions give for free.
 *
 * The reason field is optional, and the label says so. A request carries a
 * reason, not a claim: the approver sets the role at the moment of approval,
 * so there is nothing here for the requester to ask to be.
 */

import { useActionState } from 'react';
import { requestAccessAction, type ActionState } from '@/app/actions/grants';

const EMPTY: ActionState = {};

export function RequestAccessForm({ slug, host }: { slug: string; host: string }) {
  const [state, formAction, pending] = useActionState(requestAccessAction, EMPTY);

  return (
    <form action={formAction} className="tile-request">
      <input type="hidden" name="slug" value={slug} />

      <label className="field-hint" htmlFor={`reason-${slug}`}>
        Why do you need it? Optional, and the approver reads it.
      </label>
      <textarea
        id={`reason-${slug}`}
        name="reason"
        maxLength={1000}
        placeholder="e.g. taking over the west zone from next month"
      />

      {state.error && <p className="notice notice-bad" aria-live="polite">{state.error}</p>}
      {state.notice && <p className="notice notice-good" aria-live="polite">{state.notice}</p>}

      <div className="card-foot">
        <span className="card-url">{host}</span>
        <button className="btn btn-small" type="submit" disabled={pending}>
          {pending ? 'Asking…' : 'Request access'}
        </button>
      </div>
    </form>
  );
}
