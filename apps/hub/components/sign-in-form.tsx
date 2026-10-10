'use client';

/**
 * The sign-in form.
 *
 * `next` arrives as a prop, already run through `safeReturnUrl()` on the
 * server, and travels on as a hidden field so the submit itself carries no
 * query string. The action validates it again on the way out — a hidden field
 * is client-supplied data like any other, and the whole point of that check is
 * that it is not skipped anywhere.
 *
 * One message covers every failure, deliberately. See the action.
 */

import { useActionState } from 'react';
import { signInAction, type FormState } from '@/app/actions/auth';

const EMPTY: FormState = {};

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, EMPTY);

  return (
    <form action={formAction} className="panel stack">
      <input type="hidden" name="next" value={next} />

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
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {state.error && <p className="notice notice-bad" aria-live="polite">{state.error}</p>}

      <button className="btn btn-wide" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
