'use client';

/**
 * The sign-up form.
 *
 * Three fields and no role picker. The old sales sign-up let the requester
 * choose whether they were a rep, a manager or an admin; the approver sets
 * that now, at the moment of approval, per application. A request carries a
 * reason, not a claim.
 *
 * Password rules are not restated here. `passwordProblem()` in the identity
 * package returns the sentence to show, and the hint below says the one thing
 * worth saying in advance.
 */

import { useActionState } from 'react';
import { signUpAction, type FormState } from '@/app/actions/auth';
import { MIN_PASSWORD_LENGTH } from '@risansi/identity';

const EMPTY: FormState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, EMPTY);

  return (
    <form action={formAction} className="panel stack">
      <div className="field">
        <label htmlFor="name">Full name</label>
        <input id="name" name="name" type="text" autoComplete="name" required />
      </div>

      <div className="field">
        <label htmlFor="email">Risansi email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="you@risansi.com"
        />
        <p className="field-hint">Has to end in @risansi.com.</p>
      </div>

      <div className="field">
        <label htmlFor="password">Choose a password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
        <p className="field-hint">
          {`At least ${MIN_PASSWORD_LENGTH} characters. Length helps more than symbols do.`}
        </p>
      </div>

      {state.error && <p className="notice notice-bad" aria-live="polite">{state.error}</p>}

      <button className="btn btn-wide" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
