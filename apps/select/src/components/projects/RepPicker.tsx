"use client";

import { useEffect, useState } from "react";

import apiClient from "../../services/apiClient";

// Rep Manager: whose enquiries to show - the whole team (default), themselves,
// or one rep under them (sales manager_reps). Value = a sales user id, "" =
// everyone. Renders nothing for anyone else, or a manager with no team.

type Person = { id: number; name: string };
type RepContext = { role: string; me: Person | null; team: Person[] } | null;

let cache: Promise<RepContext> | null = null;
const loadContext = () =>
  (cache ??= apiClient
    .get<RepContext>("/rep-scope")
    .then((r) => r.data)
    .catch(() => {
      cache = null;
      return null;
    }));

export default function RepPicker({ value, onChange }: { value: string; onChange: (rep: string) => void }) {
  const [ctx, setCtx] = useState<RepContext>(null);
  useEffect(() => {
    loadContext().then(setCtx);
  }, []);
  if (!ctx || ctx.role !== "rep_manager" || ctx.team.length === 0) return null;
  return (
    <select
      aria-label="Rep"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 rounded-md border px-2.5 text-[12.5px] font-medium shadow-xs outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 ${
        value ? "border-primary/40 bg-primary/8 text-primary" : "border-input bg-card text-foreground hover:bg-muted"
      }`}
    >
      <option value="">My team (all)</option>
      {ctx.me && <option value={String(ctx.me.id)}>Me ({ctx.me.name})</option>}
      {ctx.team.map((p) => (
        <option key={p.id} value={String(p.id)}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
