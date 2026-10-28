"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { switchRoleAction } from "@/app/risansi/actions";
import { roleLabel } from "@/lib/roles";

/**
 * For a person with more than one department: which one they are working as,
 * one button each, the current one marked. Picking another reloads the app as
 * that department (its pages, cards, notifications and chat side). Nothing for
 * a person with one.
 */
export function RoleSwitcher({ role, roles, variant }: { role: string; roles: string[]; variant: "sidebar" | "header" }) {
  const [pending, start] = useTransition();
  const [asked, setAsked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (roles.length < 2) return null;
  const change = (next: string) => {
    if (next === role || pending) return;
    setError(null);
    setAsked(next);
    start(async () => {
      const res = await switchRoleAction(next);
      if (res && !res.ok) {
        setError(res.error);
        setAsked(null);
      }
    });
  };
  const sidebar = variant === "sidebar";
  return (
    <div role="group" aria-label="Working as" className={sidebar ? "px-3 pb-3" : "flex items-center gap-1 overflow-x-auto"}>
      {sidebar && (
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">Working as</p>
      )}
      <div className={sidebar ? "flex flex-wrap gap-1.5 px-1" : "flex gap-1"}>
        {roles.map((r) => {
          const on = r === role;
          const busy = pending && asked === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => change(r)}
              disabled={pending}
              aria-pressed={on}
              className={
                sidebar
                  ? `inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-wait ${
                      on ? "bg-primary text-primary-foreground shadow-sm" : "bg-white/5 text-sidebar-foreground ring-1 ring-white/10 hover:bg-sidebar-hover"
                    }`
                  : `inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:cursor-wait ${
                      on ? "bg-primary text-primary-foreground" : "border border-card-border bg-surface text-foreground hover:bg-background"
                    }`
              }
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : on ? <Check className="h-3 w-3" /> : null}
              {roleLabel(r)}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className={`mt-1.5 px-1 text-[11px] ${sidebar ? "text-rose-300" : "text-rose-600"}`}>
          {error}
        </p>
      )}
    </div>
  );
}
