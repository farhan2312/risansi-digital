"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, X } from "lucide-react";
import type { RepAccount, UnclaimedRep } from "@/lib/reps";
import { setRepNameAction } from "@/app/risansi/reps/actions";

function shortDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-gray-100 text-gray-600 ring-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function RepNameCell({ account, repNames }: { account: RepAccount; repNames: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(account.rep_name ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await setRepNameAction(account.id, value);
    setBusy(false);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        {account.rep_name ? (
          <span className="font-medium text-foreground">{account.rep_name}</span>
        ) : (
          <Chip tone="warn">No rep linked</Chip>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Change the rep for ${account.email}`}
          className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 max-w-[220px] rounded-lg border border-input-border bg-surface px-2 text-sm text-foreground"
      >
        <option value="">— None —</option>
        {repNames.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        aria-label="Save"
        className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => {
          setValue(account.rep_name ?? "");
          setEditing(false);
        }}
        aria-label="Cancel"
        className="rounded-md p-1.5 text-muted hover:bg-background"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Reps: which account is which rep on the orders. Accounts are made and
 * switched off at Risansi Digital; this only says which SOs a Rep sees.
 */
export function RepsView({
  accounts,
  unclaimed,
  repNames,
}: {
  accounts: RepAccount[];
  unclaimed: UnclaimedRep[];
  repNames: string[];
}) {
  const linkedReps = accounts.filter((a) => a.rep_name?.trim()).length;
  const th = "px-4 py-3";
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Reps</h1>
        <p className="text-sm text-muted">
          {accounts.length} Rep accounts · {linkedReps} linked to a rep on the orders
          {unclaimed.length > 0 && ` · ${unclaimed.length} rep${unclaimed.length === 1 ? "" : "s"} on orders with no account`}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          A Rep sees the SOs whose rep matches theirs. It is filled in from the sales portal, by email, the first
          time they sign in. Change it here only if it is wrong. Accounts and roles are managed at Risansi Digital.
        </p>
      </div>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className={th}>Account</th>
                <th className={th}>Rep on orders</th>
                <th className={`${th} text-right`}>SOs</th>
                <th className={th}>Risansi Digital</th>
                <th className={th}>Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">
                    No Rep accounts yet.
                  </td>
                </tr>
              )}
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{a.full_name}</div>
                    <div className="text-xs text-muted">{a.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <RepNameCell account={a} repNames={repNames} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{a.rep_name ? a.orders : "—"}</td>
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
            Nobody sees these SOs as their Rep. Give the person a Rep grant at Risansi Digital; their account is made,
            and linked here, when they first sign in.
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
