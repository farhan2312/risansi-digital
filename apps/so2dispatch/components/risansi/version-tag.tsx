/**
 * A Pump SO's version, as the departments see it: the number only, from v1
 * (an SO still at v0 shows nothing). Order Making, Central Visibility and
 * Admin open the versions themselves from their own tag.
 */
export function VersionTag({ order }: { order: Record<string, unknown> | null | undefined }) {
  const n = Number(order?.version_no ?? 0) || 0;
  if (n < 1) return null;
  return (
    <span
      title={`Version ${n} — the SO was revised ${n === 1 ? "once" : `${n} times`}`}
      className="mt-1 flex w-fit items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
    >
      v{n}
    </span>
  );
}
