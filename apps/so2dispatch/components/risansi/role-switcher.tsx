"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { switchRoleAction } from "@/app/risansi/actions";
import { roleLabel } from "@/lib/roles";

/**
 * For a person with more than one department: which one they are working as.
 * Picking another reloads the app as that department (its pages, cards,
 * notifications and chat side). Nothing for a person with one.
 */
export function RoleSwitcher({ role, roles, variant }: { role: string; roles: string[]; variant: "sidebar" | "header" }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (roles.length < 2) return null;
  const change = (next: string) => {
    if (next === role) return;
    setError(null);
    start(async () => {
      const res = await switchRoleAction(next);
      if (res && !res.ok) setError(res.error);
    });
  };
  const sidebar = variant === "sidebar";
  return (
    <label
      title={error ?? "Switch the department you are working as"}
      className={
        sidebar
          ? "mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5"
          : "inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border bg-surface px-2"
      }
    >
      {pending ? (
        <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${sidebar ? "text-sidebar-muted" : "text-muted"}`} />
      ) : (
        <ArrowLeftRight className={`h-3.5 w-3.5 shrink-0 ${sidebar ? "text-sidebar-muted" : "text-primary"}`} />
      )}
      <span className={sidebar ? "text-[11px] text-sidebar-muted" : "sr-only"}>Working as</span>
      <select
        value={role}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label="Working as"
        className={
          sidebar
            ? "min-w-0 flex-1 cursor-pointer truncate bg-transparent text-sm font-medium text-white focus:outline-none [&>option]:text-foreground"
            : "max-w-[9rem] cursor-pointer truncate bg-transparent text-sm font-medium text-foreground focus:outline-none"
        }
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
      {error && <span className="sr-only" role="alert">{error}</span>}
    </label>
  );
}
