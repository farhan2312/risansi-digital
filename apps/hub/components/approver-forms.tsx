'use client';

/**
 * Granting and removing the approver role.
 *
 * One select of everybody who could be one, and a Remove next to each person
 * who already is. Deliberately not a list of every user with a toggle beside
 * each: the question being answered is "who decides access", and a screen
 * showing forty rows of mostly-off switches buries the three that matter.
 *
 * The select carries no default, same reasoning as the role select next door
 * — a pre-filled first name is one stray click from being granted.
 */

import { useActionState, useState } from 'react';
import {
  grantApproverAction,
  revokeApproverAction,
} from '@/app/actions/approvers';
import type { ActionState } from '@/app/actions/grants';

const EMPTY: ActionState = {};

export interface Candidate {
  id: string;
  name: string;
  email: string;
}

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p className="notice notice-bad" aria-live="polite">{state.error}</p>;
  if (state.notice) return <p className="notice notice-good" aria-live="polite">{state.notice}</p>;
  return null;
}

export function GrantApproverForm({ candidates }: { candidates: Candidate[] }) {
  const [state, formAction, pending] = useActionState(grantApproverAction, EMPTY);
  const [chosen, setChosen] = useState('');

  if (candidates.length === 0) {
    return <p className="empty">Everybody with an active account is already an approver.</p>;
  }

  return (
    <form action={formAction} className="decision">
      <div className="field">
        <label htmlFor="new-approver">Give approver access to</label>
        <select
          id="new-approver"
          name="userId"
          value={chosen}
          onChange={e => setChosen(e.target.value)}
          required
        >
          <option value="">Choose somebody…</option>
          {candidates.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.email}
            </option>
          ))}
        </select>
        <p className="field-hint">
          They will be able to approve, refuse and withdraw access to every
          portal, and will start receiving the daily list of what is waiting.
        </p>
      </div>

      <Result state={state} />

      <button className="btn btn-small" type="submit" disabled={pending || !chosen}>
        {pending ? 'Granting…' : 'Make approver'}
      </button>
    </form>
  );
}

/**
 * The add control, sized to sit in the last row of the approvers table.
 *
 * In the table rather than in a card underneath it: the list and the way to
 * add to it are the same thought, and splitting them puts a second panel on
 * screen that says nothing the column heading did not.
 */
export function GrantApproverInline({ candidates }: { candidates: Candidate[] }) {
  const [state, formAction, pending] = useActionState(grantApproverAction, EMPTY);
  const [chosen, setChosen] = useState('');

  if (candidates.length === 0) {
    return <span className="cell-no">Everybody active is already an approver.</span>;
  }

  return (
    <form action={formAction} className="row-action">
      <select
        name="userId"
        aria-label="Give approver access to"
        value={chosen}
        onChange={e => setChosen(e.target.value)}
        required
      >
        <option value="">Choose somebody…</option>
        {candidates.map(c => (
          <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
        ))}
      </select>
      <button className="btn btn-small" type="submit" disabled={pending || !chosen}>
        {pending ? 'Adding…' : 'Add approver'}
      </button>
      {(state.error || state.notice) && <Result state={state} />}
    </form>
  );
}

/** Remove, sized for a table row. */
export function RevokeApproverInline({
  userId, name, isSelf,
}: {
  userId: string; name: string; isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState(revokeApproverAction, EMPTY);

  if (isSelf) return <span className="cell-no">This is you</span>;

  return (
    <form action={formAction} className="row-action">
      <input type="hidden" name="userId" value={userId} />
      <button className="btn btn-small btn-quiet" type="submit" disabled={pending}>
        {pending ? 'Removing…' : `Remove ${name.split(' ')[0]}`}
      </button>
      {(state.error || state.notice) && <Result state={state} />}
    </form>
  );
}

export function RevokeApproverForm({
  userId, name, isSelf,
}: {
  userId: string; name: string; isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState(revokeApproverAction, EMPTY);

  if (isSelf) {
    return (
      <p className="field-hint">
        This is you. Removing your own approver access would leave you unable
        to put it back, so another approver has to do it.
      </p>
    );
  }

  return (
    <form action={formAction} className="decision">
      <input type="hidden" name="userId" value={userId} />
      <Result state={state} />
      <button className="btn btn-small btn-quiet" type="submit" disabled={pending}>
        {pending ? 'Removing…' : `Remove ${name.split(' ')[0]}`}
      </button>
    </form>
  );
}
