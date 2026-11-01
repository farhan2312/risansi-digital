"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { saveViewPagesAction } from "@/app/risansi/actions";
import { roleLabel } from "@/lib/roles";
import { VIEW_PAGES } from "@/lib/view-pages";

type Person = { id: string; full_name: string; email: string; role: string; pages: string[] };

/**
 * Admin: the pages each 360° View account sees, ticked. Everyone holding the
 * role — as their main one or an extra department — is listed; the sidebar
 * shows them only what is ticked, read-only.
 */
export function ViewPagesEditor({ people }: { people: Person[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(p: Person) {
    setEditing(p.id);
    setPicked(p.pages);
    setError(null);
  }

  async function save(p: Person) {
    setSaving(true);
    setError(null);
    const res = await saveViewPagesAction(p.id, picked);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  if (people.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-card-border px-4 py-6 text-center text-sm text-muted">
        Nobody has 360° View yet. Give it at Risansi Digital as a main role, or tick it under Extra departments.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-card-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-card-border bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Person</th>
            <th className="px-3 py-2">Pages they see</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className="border-b border-card-border/60 align-top last:border-b-0">
              <td className="px-3 py-2.5">
                <span className="block font-medium text-foreground">{p.full_name}</span>
                <span className="block text-xs text-muted">{p.email}</span>
                {p.role !== "view_360" && (
                  <span className="mt-0.5 block text-[11px] text-muted">Extra department · main role {roleLabel(p.role)}</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                {editing === p.id ? (
                  <div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                      {VIEW_PAGES.map((page) => (
                        <label key={page.href} className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={picked.includes(page.href)}
                            onChange={(e) =>
                              setPicked((xs) => (e.target.checked ? [...xs, page.href] : xs.filter((x) => x !== page.href)))
                            }
                            className="h-4 w-4 accent-primary"
                          />
                          {page.label}
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPicked(picked.length === VIEW_PAGES.length ? [] : VIEW_PAGES.map((x) => x.href))}
                        disabled={saving}
                        className="inline-flex h-8 items-center rounded-lg border border-input-border px-3 text-xs font-medium text-foreground hover:bg-background"
                      >
                        {picked.length === VIEW_PAGES.length ? "Clear all" : "Select all"}
                      </button>
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
                ) : p.pages.length ? (
                  <span className="flex flex-wrap gap-1">
                    {VIEW_PAGES.filter((x) => p.pages.includes(x.href)).map((x) => (
                      <span key={x.href} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        {x.label}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-amber-700">None yet — they see nothing</span>
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
        </tbody>
      </table>
    </div>
  );
}
