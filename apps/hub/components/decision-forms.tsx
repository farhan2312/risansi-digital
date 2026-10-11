'use client';

/**
 * The three things an approver can do to a grant.
 *
 * Approve carries the role. Since migration 0002 the roles are a table rather
 * than a free string, and `app_grants` has a composite foreign key onto it, so
 * a role that does not exist cannot be stored. The select is the convenience;
 * the constraint is the rule — and the action re-checks both anyway, because a
 * Server Function is reachable by direct POST whether or not this form sent it.
 *
 * The description under the select is the point of this screen. "Billing &
 * Operations" and "Central Visibility" mean nothing to somebody outside that
 * department, and an approver guessing between them grants the wrong access to
 * the right person. It changes with the choice rather than listing all eleven,
 * which would bury the queue.
 */

import { useActionState, useState } from 'react';
import type { AppRole } from '@risansi/identity';
import {
  approveGrantAction,
  changeRoleAction,
  rejectGrantAction,
  revokeGrantAction,
  type ActionState,
} from '@/app/actions/grants';
import { isHeavyRole } from '@/lib/roles';

const EMPTY: ActionState = {};

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p className="notice notice-bad" aria-live="polite">{state.error}</p>;
  if (state.notice) return <p className="notice notice-good" aria-live="polite">{state.notice}</p>;
  return null;
}

export function ApproveForm({
  grantId, appSlug, roles,
}: {
  grantId: string; appSlug: string; roles: AppRole[];
}) {
  const [state, formAction, pending] = useActionState(approveGrantAction, EMPTY);
  // No pre-selection. The role is a decision, and a default would get accepted
  // by whoever is clicking through the queue quickly.
  const [chosen, setChosen] = useState('');

  const role = roles.find(r => r.role === chosen);
  const heavy = role ? isHeavyRole(appSlug, role.role) : false;
  const selectId = `role-${grantId}`;

  return (
    <form action={formAction} className="decision">
      <input type="hidden" name="grantId" value={grantId} />

      <div className="field">
        <label htmlFor={selectId}>Role in that portal</label>
        <select
          id={selectId}
          name="role"
          value={chosen}
          onChange={e => setChosen(e.target.value)}
          required
        >
          <option value="">Choose a role…</option>
          {roles.map(r => (
            <option key={r.role} value={r.role}>
              {isHeavyRole(appSlug, r.role) ? `${r.label} — heaviest` : r.label}
            </option>
          ))}
        </select>
      </div>

      {role && (
        <p className={heavy ? 'role-desc role-desc-heavy' : 'role-desc'}>
          {role.description}
        </p>
      )}

      <Result state={state} />

      {/* Disabled until a role is picked. The foreign key is MATCH SIMPLE, so a
          null role satisfies it — an approved grant with no role would save
          happily and leave the person approved and unable to do anything. */}
      <button className="btn btn-small" type="submit" disabled={pending || !chosen}>
        {pending ? 'Approving…' : 'Approve'}
      </button>
    </form>
  );
}

/**
 * Changing the role on a grant somebody already holds.
 *
 * Pre-selected with what they have now, unlike the approval form next door.
 * There the blank is the point — a default role is one stray click from being
 * granted. Here the current value is the thing being edited, and starting
 * blank would hide what it is. Submit stays disabled until the choice differs.
 */
export function ChangeRoleForm({
  grantId, appSlug, roles, current,
}: {
  grantId: string; appSlug: string; roles: AppRole[]; current: string | null;
}) {
  const [state, formAction, pending] = useActionState(changeRoleAction, EMPTY);
  const [chosen, setChosen] = useState(current ?? '');

  const role = roles.find(r => r.role === chosen);
  const heavy = role ? isHeavyRole(appSlug, role.role) : false;
  const selectId = `change-role-${grantId}`;

  return (
    <form action={formAction} className="decision">
      <input type="hidden" name="grantId" value={grantId} />

      <div className="field">
        <label htmlFor={selectId}>Role in that portal</label>
        <select
          id={selectId}
          name="role"
          value={chosen}
          onChange={e => setChosen(e.target.value)}
          required
        >
          {!current && <option value="">Choose a role…</option>}
          {roles.map(r => (
            <option key={r.role} value={r.role}>
              {isHeavyRole(appSlug, r.role) ? `${r.label} — heaviest` : r.label}
            </option>
          ))}
        </select>
      </div>

      {role && (
        <p className={heavy ? 'role-desc role-desc-heavy' : 'role-desc'}>
          {role.description}
        </p>
      )}

      <Result state={state} />

      <button
        className="btn btn-small"
        type="submit"
        disabled={pending || !chosen || chosen === current}
      >
        {pending ? 'Changing…' : 'Change role'}
      </button>
    </form>
  );
}

export function RejectForm({ grantId }: { grantId: string }) {
  const [state, formAction, pending] = useActionState(rejectGrantAction, EMPTY);
  const noteId = `reject-note-${grantId}`;

  return (
    <form action={formAction} className="decision">
      <input type="hidden" name="grantId" value={grantId} />

      <div className="field">
        <label htmlFor={noteId}>Why not? Optional</label>
        <input id={noteId} name="note" type="text" maxLength={500} />
        <p className="field-hint">They see this on the tile. Worth writing.</p>
      </div>

      <Result state={state} />

      <button className="btn btn-small btn-quiet" type="submit" disabled={pending}>
        {pending ? 'Refusing…' : 'Reject'}
      </button>
    </form>
  );
}

export function RevokeForm({ grantId }: { grantId: string }) {
  const [state, formAction, pending] = useActionState(revokeGrantAction, EMPTY);
  const noteId = `revoke-note-${grantId}`;

  return (
    <form action={formAction} className="decision">
      <input type="hidden" name="grantId" value={grantId} />

      <div className="field">
        <label htmlFor={noteId}>Why? Optional</label>
        <input id={noteId} name="note" type="text" maxLength={500} />
        <p className="field-hint">
          Takes effect on their next click, not when their session expires.
        </p>
      </div>

      <Result state={state} />

      <button className="btn btn-small btn-quiet" type="submit" disabled={pending}>
        {pending ? 'Withdrawing…' : 'Revoke access'}
      </button>
    </form>
  );
}
