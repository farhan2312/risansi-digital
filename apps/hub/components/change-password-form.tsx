'use client';

/**
 * Set a new password.
 *
 * The current one is asked for even when the person is here because the
 * password they hold was issued rather than chosen — they typed it a moment ago
 * to get in, and requiring it means a stolen session cookie cannot be used to
 * lock the owner out of their own account.
 */

import { useActionState } from 'react';
import { changePasswordAction, type FormState } from '@/app/actions/auth';
import { MIN_PASSWORD_LENGTH } from '@risansi/identity';

const EMPTY: FormState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, EMPTY);

  return (
    <form action={formAction} className="panel stack">
      <div className="field">
        <label htmlFor="current">Current password</label>
        <input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="next_password">New password</label>
        <input
          id="next_password"
          name="next_password"
          type="password"
          autoComplete="new-password"
          required
        />
        <p className="field-hint">
          {`At least ${MIN_PASSWORD_LENGTH} characters. Length helps more than symbols do.`}
        </p>
      </div>

      <div className="field">
        <label htmlFor="confirm">New password again</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

      {state.error && <p className="notice notice-bad" aria-live="polite">{state.error}</p>}

      <button className="btn btn-wide" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set password'}
      </button>
    </form>
  );
}
