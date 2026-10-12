'use client';

/**
 * Only my accounts.
 *
 * Unticked — the default — shows everything the person can reach: the
 * accounts they own and the ones they cover for a colleague. Ticked narrows
 * it to the accounts they are primary rep on.
 *
 * It exists because two pages answered that question differently without
 * saying so. On 12 Oct the Executive Review showed a rep ₹1.69 Cr of lost
 * business and the Opportunities board showed ₹2.74 Cr, and the whole
 * difference was one covered account worth ₹1.13 Cr. Neither page was wrong;
 * neither said which question it was answering. Now it is a box you can see.
 *
 * The state lives in the URL rather than in component state, so the view
 * survives a refresh, can be sent to somebody, and the server renders the
 * right figures first time instead of flashing the wrong ones.
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

export function OwnedOnlyToggle({ coveredCount }: { coveredCount?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const on = params.get('owned') === '1';

  function toggle(next: boolean) {
    const q = new URLSearchParams(params.toString());
    if (next) q.set('owned', '1');
    else q.delete('owned');
    // Drop any page cursor: the row that was on page three of the wider set
    // is rarely on page three of the narrower one.
    q.delete('page');
    start(() => router.push(`${pathname}${q.size ? `?${q}` : ''}`, { scroll: false }));
  }

  return (
    <label
      title="Unticked shows the accounts you own and the ones you cover. Ticked shows only the accounts you own."
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        fontSize: 12.5, color: 'var(--fg-2)', cursor: 'pointer',
        opacity: pending ? 0.6 : 1, userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={e => toggle(e.target.checked)}
        style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
      Only my accounts
      {!on && coveredCount != null && coveredCount > 0 && (
        <span style={{ color: 'var(--fg-3)' }}>
          · {coveredCount} covered included
        </span>
      )}
    </label>
  );
}
