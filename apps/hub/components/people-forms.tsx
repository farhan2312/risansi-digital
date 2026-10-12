'use client';

/**
 * Account management, in one place.
 *
 * Each portal used to have its own version of creating a person, resetting a
 * password and switching somebody off. Four implementations of the same three
 * jobs meant the answer to "how do I get Priya into Testing" depended on who
 * you asked, and switching somebody off properly meant remembering all four.
 * These replace them.
 */

import { useActionState, useState } from 'react';
import type { AppRole } from '@risansi/identity';
import {
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  type CreateUserState,
} from '@/app/actions/users';
import type { ActionState } from '@/app/actions/grants';
import { isHeavyRole } from '@/lib/roles';

const EMPTY_CREATE: CreateUserState = {};
const EMPTY_ACTION: ActionState = {};

export interface GrantableApp {
  slug: string;
  name: string;
  /** On the grid but not open yet. A grant here waits until it is. */
  comingSoon?: boolean;
  roles: AppRole[];
}

/**
 * The password, shown once.
 *
 * Deliberately loud and deliberately not an email. It exists in readable form
 * for exactly as long as this panel is on screen — it is stored only as a
 * bcrypt hash, so there is nowhere to go and look it up afterwards. If it is
 * lost before being passed on, reset it again; that is cheaper than any way
 * of making it recoverable.
 */
function Handover({ state }: { state: CreateUserState }) {
  if (!state.created) return null;
  const { name, email, password, apps } = state.created;
  return (
    <div className="handover">
      <p className="handover-head">{name} can sign in now</p>
      <p className="handover-sub">{email}</p>
      <p className="handover-pw">{password}</p>
      <p className="handover-note">
        Tell them this password directly — it is not emailed, and it cannot be
        looked up later. They will have to choose their own before they can
        reach anything.
        {apps.length > 0 && ` Already open to them: ${apps.join(', ')}.`}
      </p>
    </div>
  );
}

function Result({ state }: { state: { error?: string; notice?: string } }) {
  if (state.error) return <p className="notice notice-bad" aria-live="polite">{state.error}</p>;
  if (state.notice) return <p className="notice notice-good" aria-live="polite">{state.notice}</p>;
  return null;
}

/** Create somebody, with their access already decided. */
export function NewUserForm({ apps }: { apps: GrantableApp[] }) {
  const [state, formAction, pending] = useActionState(createUserAction, EMPTY_CREATE);

  return (
    <form action={formAction} className="new-user">
      <div className="new-user-who">
        <div className="field">
          <label htmlFor="nu-name">Name</label>
          <input id="nu-name" name="name" type="text" required maxLength={120} placeholder="Priya Sharma" />
        </div>
        <div className="field">
          <label htmlFor="nu-email">Email</label>
          <input id="nu-email" name="email" type="email" required maxLength={200} placeholder="priya.sharma@risansi.com" />
        </div>
      </div>

      <p className="field-hint">
        Pick what they need now. Anything left on <em>No access</em> they can
        request later in the ordinary way. A portal marked{' '}
        <em>Not open yet</em> can still be set up — the grant waits, and works
        the day that portal goes live.
      </p>

      <div className="new-user-apps">
        {apps.map(a => (
          <div className="field" key={a.slug}>
            <label htmlFor={`nu-${a.slug}`}>
              {a.name}
              {a.comingSoon && <span className="pill">Not open yet</span>}
            </label>
            <select id={`nu-${a.slug}`} name={`role:${a.slug}`} defaultValue="">
              <option value="">No access</option>
              {a.roles.map(r => (
                <option key={r.role} value={r.role}>
                  {isHeavyRole(a.slug, r.role) ? `${r.label} — heaviest` : r.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {state.error && <Result state={state} />}
      <Handover state={state} />

      <button className="btn btn-small" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}

/** Reset, and deactivate or reactivate, for one row. */
export function PersonActions({
  email, name, isActive, isSelf,
}: {
  email: string; name: string; isActive: boolean; isSelf: boolean;
}) {
  const [reset, resetAction, resetting] = useActionState(resetPasswordAction, EMPTY_CREATE);
  const [active, activeAction, switching] = useActionState(setActiveAction, EMPTY_ACTION);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="row-action row-action-stack">
      {isActive && (
        <form action={resetAction}>
          <input type="hidden" name="email" value={email} />
          <button className="btn btn-small btn-quiet" type="submit" disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      )}

      {isSelf ? (
        <span className="cell-no">This is you</span>
      ) : (
        <form
          action={activeAction}
          // Deactivating reaches all four portals at once, so it asks first.
          // Reactivating does not: it can only give back what was already
          // decided, and the grants were never touched.
          onSubmit={e => {
            if (isActive && !confirming) {
              e.preventDefault();
              setConfirming(true);
            }
          }}
        >
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="active" value={String(!isActive)} />
          <button
            className={isActive ? 'btn btn-small btn-quiet' : 'btn btn-small'}
            type="submit"
            disabled={switching}
          >
            {switching
              ? 'Saving…'
              : isActive
                ? (confirming ? `Really lock ${name.split(' ')[0]} out?` : 'Deactivate')
                : 'Reactivate'}
          </button>
        </form>
      )}

      <Result state={active} />
      {reset.error && <Result state={reset} />}
      <Handover state={reset} />
    </div>
  );
}
