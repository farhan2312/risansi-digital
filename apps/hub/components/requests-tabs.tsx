/**
 * The two views an approver has.
 *
 * Links, not client-side tab state. Both are their own route, so a matrix
 * worth looking at is a URL worth sending to somebody, the back button means
 * what it looks like it means, and neither view costs a query until it is
 * opened. A server component with no JavaScript behind it.
 */

import Link from 'next/link';

const TABS = [
  { href: '/requests',        key: 'requests', label: 'Requests' },
  { href: '/requests/access', key: 'access',   label: 'Who has what' },
] as const;

export function RequestsTabs({ active }: { active: 'requests' | 'access' }) {
  return (
    <nav className="tabs" aria-label="Access">
      {TABS.map(t => (
        <Link
          key={t.key}
          href={t.href}
          className={t.key === active ? 'tab tab-on' : 'tab'}
          aria-current={t.key === active ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
