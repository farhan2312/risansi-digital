import Link from 'next/link';

/**
 * Consistent empty-state block: an icon, a title, an optional hint, and an
 * optional call-to-action. Use it wherever a list / panel has no data so reps
 * can tell "nothing here" apart from "still loading" or "something broke".
 */
export function EmptyState({
  icon = '📭',
  title,
  hint,
  action,
  tone = 'neutral',
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: { label: string; href: string };
  tone?: 'neutral' | 'positive';
}) {
  return (
    <div style={{
      textAlign: 'center', padding: '28px 20px',
      border: '1px dashed var(--line-strong)', borderRadius: 12,
      background: tone === 'positive' ? 'var(--pos-soft)' : 'var(--bg-paper)',
      color: 'var(--fg-3)',
    }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)', marginBottom: hint ? 4 : 0 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{hint}</div>}
      {action && (
        <Link href={action.href} style={{
          display: 'inline-flex', alignItems: 'center', marginTop: 14, minHeight: 40,
          padding: '8px 16px', borderRadius: 8, background: 'var(--accent-soft)',
          color: 'var(--accent)', fontWeight: 600, fontSize: 13, textDecoration: 'none',
        }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
