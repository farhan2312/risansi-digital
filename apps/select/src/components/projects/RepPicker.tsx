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
      className={`h-9 rounded-lg border px-2.5 text-[12.5px] font-semibold outline-none transition focus:ring-2 focus:ring-accent-soft ${
        value ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-fg-2 hover:border-fg-3"
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
