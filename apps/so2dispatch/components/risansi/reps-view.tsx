import type { RepAccount, UnclaimedRep } from "@/lib/reps";

function shortDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : tone === "info"
          ? "bg-sky-50 text-sky-700 ring-sky-200"
          : "bg-gray-100 text-gray-600 ring-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function TeamCell({ account, teamsRead }: { account: RepAccount; teamsRead: boolean }) {
  if (!teamsRead && account.role === "rep_manager") {
    return <span className="text-xs text-muted">Sales portal unavailable</span>;
  }
  if (!account.team) return <span className="text-muted">—</span>;
  if (account.team.length === 0) {
    return <Chip tone="warn">Nobody under them in the sales portal</Chip>;
  }
  return (
    <div className="space-y-1">
      {account.role === "rep" && (
        <div>
          <Chip tone="warn">Manages reps in sales: needs Rep Manager at the hub</Chip>
        </div>
      )}
      <ul className="space-y-0.5 text-xs">
        {account.team.map((t) => (
          <li key={t.name}>
            <span className="text-foreground">{t.name}</span>
            <span className="text-muted"> · {t.orders} SOs</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Reps and Rep Managers, and whose SOs each sees. Nothing on it is edited
 * here: accounts and roles at Risansi Digital, teams in the sales portal.
 */
export function RepsView({
  accounts,
  unclaimed,
  teamsRead,
}: {
  accounts: RepAccount[];
  unclaimed: UnclaimedRep[];
  teamsRead: boolean;
}) {
  const managers = accounts.filter((a) => a.role === "rep_manager").length;
  const th = "px-4 py-3";
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Reps</h1>
        <p className="text-sm text-muted">
          {accounts.length - managers} Reps · {managers} Rep Managers
          {unclaimed.length > 0 && ` · ${unclaimed.length} rep${unclaimed.length === 1 ? "" : "s"} on orders with no account`}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          A Rep sees the SOs whose rep is their name. A Rep Manager also sees the SOs of the reps under them in the
          sales portal. Accounts and roles are managed at Risansi Digital; teams in the sales portal.
        </p>
        {!teamsRead && (
          <p className="mt-2 text-sm text-danger">
            The sales portal could not be read, so teams are not shown. Rep Managers see only their own SOs until it
            can.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className={th}>Account</th>
                <th className={th}>Role</th>
                <th className={`${th} text-right`}>Own SOs</th>
                <th className={th}>Team (sales portal)</th>
                <th className={th}>Risansi Digital</th>
                <th className={th}>Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                    No Rep accounts yet.
                  </td>
                </tr>
              )}
              {accounts.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{a.full_name}</div>
                    <div className="text-xs text-muted">{a.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {a.role === "rep_manager" ? <Chip tone="info">Rep Manager</Chip> : <Chip tone="muted">Rep</Chip>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {a.orders > 0 ? a.orders : <span className="text-muted">0</span>}
                  </td>
                  <td className="px-4 py-3">
                    <TeamCell account={a} teamsRead={teamsRead} />
                  </td>
                  <td className="px-4 py-3">
                    {a.linked ? <Chip tone="ok">Linked</Chip> : <Chip tone="muted">Not linked</Chip>}
                  </td>
                  <td className="px-4 py-3 text-muted">{shortDate(a.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {unclaimed.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-semibold text-foreground">Reps on orders with no account</h2>
          <p className="mb-3 text-sm text-muted">
            No Rep here has this name, so only a Rep Manager over them (if any) sees these SOs. Give the person a Rep
            grant at Risansi Digital; their account is made when they first sign in. If they do have an account, its
            name must match the orders exactly.
          </p>
          <div className="rounded-xl border border-card-border bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className={th}>Rep</th>
                  <th className={`${th} text-right`}>SOs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {unclaimed.map((r) => (
                  <tr key={r.rep_name}>
                    <td className="px-4 py-3 font-medium text-foreground">{r.rep_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
