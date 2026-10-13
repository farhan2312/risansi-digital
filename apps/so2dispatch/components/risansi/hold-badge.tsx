/**
 * An SO on hold — by Central Visibility (clearance) or by Accounts (payment):
 * the badge says so, with the reason (and the remarks on hover), wherever a
 * department meets the SO. It is for information — the departments' work on
 * it carries on.
 */

type Hold = { by: string; reason: string; remarks: string };

function holdsOf(order: Record<string, unknown>): Hold[] {
  const s = (v: unknown) => String(v ?? "").trim();
  const out: Hold[] = [];
  if (s(order.clearance_status) === "Hold") {
    out.push({ by: "Central Visibility", reason: s(order.clearance_hold_reason), remarks: s(order.clearance_remarks) });
  }
  if (s(order.accounts_hold_status) === "Hold") {
    out.push({ by: "Accounts", reason: s(order.accounts_hold_reason), remarks: s(order.accounts_hold_remarks) });
  }
  return out;
}

export function HoldBadge({ order }: { order: Record<string, unknown> }) {
  return (
    <>
      {holdsOf(order).map((h) => (
        <span
          key={h.by}
          title={[`On hold by ${h.by}`, h.reason, h.remarks].filter(Boolean).join(" — ")}
          className="mt-1 flex w-fit max-w-[14rem] flex-col rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] leading-tight text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        >
          <span className="font-semibold">{h.by === "Accounts" ? "Accounts hold" : "On hold"}</span>
          {h.reason && <span className="whitespace-normal">{h.reason}</span>}
        </span>
      ))}
    </>
  );
}

/** The same, as a banner across the top of the SO's own page. */
export function HoldBanner({ order }: { order: Record<string, unknown> }) {
  return (
    <>
      {holdsOf(order).map((h) => (
        <div
          key={h.by}
          role="status"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
        >
          <p className="font-semibold">
            {h.by === "Accounts" ? "Accounts hold" : "On hold"}
            {h.reason ? ` — ${h.reason}` : ""}
          </p>
          {h.remarks && <p className="mt-0.5">{h.remarks}</p>}
          <p className="mt-0.5 text-xs opacity-80">{h.by} has put this SO on hold.</p>
        </div>
      ))}
    </>
  );
}
