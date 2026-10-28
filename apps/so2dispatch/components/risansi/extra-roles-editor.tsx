"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Search } from "lucide-react";
import { saveExtraRolesAction } from "@/app/risansi/actions";
import { roleLabel } from "@/lib/roles";

type Person = { id: string; full_name: string; email: string; role: string; extra: string[] };

/**
 * Admin: who works for more than one department. Each person's main role is
 * Risansi Digital's; here they get extra departments, ticked, and switch
 * between them in the sidebar.
 */
export function ExtraRolesEditor({ people, choices }: { people: Person[]; choices: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? people.filter((p) => `${p.full_name} ${p.email} ${roleLabel(p.role)} ${p.extra.map(roleLabel).join(" ")}`.toLowerCase().includes(t))
      : people;
    // Those with extra departments first.
    return [...list].sort((a, b) => b.extra.length - a.extra.length || a.full_name.localeCompare(b.full_name));
  }, [people, q]);

  function open(p: Person) {
    setEditing(p.id);
    setPicked(p.extra);
    setError(null);
  }

  async function save(p: Person) {
    setSaving(true);
    setError(null);
    const res = await saveExtraRolesAction(p.id, picked);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  return (
    <div>
      <label className="mb-3 flex h-10 max-w-sm items-center gap-2 rounded-[10px] border border-input-border bg-surface px-3">
        <Search className="h-4 w-4 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or department"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
        />
      </label>
      <div className="overflow-x-auto rounded-xl border border-card-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-card-border bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Main role</th>
              <th className="px-3 py-2">Extra departments</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-b border-card-border/60 align-top last:border-b-0">
                <td className="px-3 py-2.5">
                  <span className="block font-medium text-foreground">{p.full_name}</span>
                  <span className="block text-xs text-muted">{p.email}</span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-foreground">{roleLabel(p.role)}</td>
                <td className="px-3 py-2.5">
                  {editing === p.id ? (
                    <div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                        {choices
                          .filter((r) => r !== p.role)
                          .map((r) => (
                            <label key={r} className="flex items-center gap-2 text-sm text-foreground">
                              <input
                                type="checkbox"
                                checked={picked.includes(r)}
                                onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, r] : xs.filter((x) => x !== r)))}
                                className="h-4 w-4 accent-primary"
                              />
                              {roleLabel(r)}
                            </label>
                          ))}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => save(p)}
                          disabled={saving}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                        >
                          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          disabled={saving}
                          className="inline-flex h-8 items-center rounded-lg border border-input-border px-3 text-xs font-medium text-foreground hover:bg-background"
                        >
                          Cancel
                        </button>
                        {error && <span className="text-xs text-rose-600">{error}</span>}
                      </div>
                    </div>
                  ) : p.extra.length ? (
                    <span className="flex flex-wrap gap-1">
                      {p.extra.map((r) => (
                        <span key={r} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                          {roleLabel(r)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {editing !== p.id && (
                    <button
                      type="button"
                      onClick={() => open(p)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground hover:bg-background"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted">
                  Nobody matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
