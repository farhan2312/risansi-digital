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
 *
 * The email survives a failed attempt and the password does not. React clears
 * an uncontrolled form when its action resolves, so both used to go, and the
 * person had to retype their address to try again — which is how a misspelled
 * address can be entered over and over while the screen says nothing about the
 * address at all. `defaultValue` is what the reset restores to, so handing the
 * address back through state is enough to put it there.
 */

import { useActionState, useEffect, useRef } from 'react';
import { signInAction, type FormState } from '@/app/actions/auth';

const EMPTY: FormState = {};

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, EMPTY);

  // Put the cursor in the password box after a failure, so the retry is one
  // field and not a hunt. autoFocus cannot do this: React applies it when the
  // input mounts, and a failed action re-renders this form rather than
  // remounting it. The dependency is the state object, which useActionState
  // replaces on every submit — keying on state.error would skip the second
  // failure in a row, which is the one that matters most.
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state.error) passwordRef.current?.focus(); }, [state]);

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
          defaultValue={state.email ?? ''}
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          ref={passwordRef}
        />
      </div>

      {state.error && <p className="notice notice-bad" aria-live="polite">{state.error}</p>}

      <button className="btn btn-wide" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
