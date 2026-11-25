"use client";

// The EC import pop-up on Order Making: pick the ERP's EC export, see every
// EC it makes (rows with the same EC No. as one, their quantities added) and
// what the check found, then import those that passed.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, MinusCircle, X, XCircle } from "lucide-react";
import { importEcsAction, previewEcImportAction } from "@/app/risansi/orders/actions";
import type { EcImportPreview, ImportEc } from "@/lib/ec-import";

const STATUS: Record<ImportEc["status"], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "Ready", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300", Icon: CheckCircle2 },
  warn: { label: "Ready · fill later", cls: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300", Icon: AlertTriangle },
  skip: { label: "Already in portal", cls: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/10 dark:text-slate-300", Icon: MinusCircle },
  error: { label: "Error", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300", Icon: XCircle },
};

export function EcImportButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <FileUp className="h-4 w-4 text-primary" />
        Import ECs
      </button>
      {open && <EcImportModal onClose={() => setOpen(false)} />}
    </>
  );
}

function EcImportModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EcImportPreview | null>(null);
  const [busy, setBusy] = useState<"read" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number; failed: { ecNo: string; error: string }[] } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const read = async (f: File) => {
    setFile(f);
    setPreview(null);
    setDone(null);
    setError(null);
    setBusy("read");
    const fd = new FormData();
    fd.set("file", f);
    const r = await previewEcImportAction(fd);
    setBusy(null);
    if (r.ok) setPreview(r.preview);
    else setError(r.error);
  };

  const ready = preview?.ecs.filter((e) => e.status === "ok" || e.status === "warn") ?? [];
  const count = (s: ImportEc["status"]) => preview?.ecs.filter((e) => e.status === s).length ?? 0;

  const run = async () => {
    if (!file || !ready.length) return;
    setBusy("import");
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await importEcsAction(fd);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setDone(r);
    router.refresh();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Import ECs" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-5 py-4 text-white">
          <div>
            <h2 className="text-lg font-semibold">Import ECs</h2>
            <p className="text-xs text-white/75">
              The ERP&apos;s EC export, as it comes. Each EC goes on its SO (already in the portal); rows with the same EC No. become one EC, their quantities added.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-card-border px-5 py-3">
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50"
          >
            {busy === "read" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4 text-primary" />}
            {file ? "Choose another file" : "Choose the Excel file"}
          </button>
          {file && <span className="truncate text-sm text-muted">{file.name}</span>}
          {preview && (
            <div className="ml-auto flex flex-wrap gap-1.5 text-xs">
              {(["ok", "warn", "skip", "error"] as const).map((s) =>
                count(s) ? (
                  <span key={s} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${STATUS[s].cls}`}>
                    {STATUS[s].label} {count(s)}
                  </span>
                ) : null
              )}
            </div>
          )}
        </div>

        <div className="min-h-[12rem] flex-1 overflow-auto px-5 py-3">
          {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
          {done ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <p className="mt-3 text-base font-semibold text-foreground">
                {done.created} EC{done.created === 1 ? "" : "s"} imported
              </p>
              <p className="mt-1 text-sm text-muted">
                {done.skipped ? `${done.skipped} already in the portal, skipped. ` : ""}
                {done.failed.length ? `${done.failed.length} could not be added: ${done.failed.map((x) => x.ecNo).join(", ")}.` : ""}
              </p>
            </div>
          ) : !preview ? (
            <p className="py-10 text-center text-sm text-muted">
              {busy === "read" ? "Reading the file…" : "Choose the ERP's EC export (.xlsx). Nothing is saved until you import."}
            </p>
          ) : (
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide">
                  {["Status", "SO No.", "EC No.", "EC Date", "Type", "Model No.", "Qty", "Rows", "Notes"].map((h) => (
                    <th key={h} className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {preview.ecs.map((e, i) => {
                  const st = STATUS[e.status];
                  return (
                    <tr key={`${e.ecNo}-${i}`} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${st.cls}`}>
                          <st.Icon className="h-3 w-3" />
                          {st.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">{e.soNo || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{e.ecNo || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{e.input.ec_date ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{e.input.item_type ?? "—"}</td>
                      <td className="px-3 py-2 text-foreground">{e.input.model_no ?? "—"}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums text-foreground">{e.input.quantity ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted">{e.rows.length > 1 ? `${e.rows.length} rows (${e.rows.join(", ")})` : e.rows[0]}</td>
                      <td className="px-3 py-2 text-xs">
                        {e.errors.map((x) => (
                          <p key={x} className="text-rose-700 dark:text-rose-300">{x}</p>
                        ))}
                        {e.warnings.map((x) => (
                          <p key={x} className="text-amber-700 dark:text-amber-300">{x}</p>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-card-border bg-background/60 px-5 py-3">
          <button type="button" onClick={onClose} disabled={!!busy} className="h-9 rounded-lg border border-input-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50">
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={run}
              disabled={!ready.length || !!busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40"
            >
              {busy === "import" && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {ready.length} EC{ready.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
