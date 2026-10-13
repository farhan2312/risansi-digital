"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { usePathname } from "next/navigation";
import {
  Bug,
  CheckCircle2,
  Lightbulb,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { submitBugReportAction } from "@/app/risansi/bug-reports/actions";

type Kind = "bug" | "feature";

/** "Report a Bug" button + modal. Lives in the app-shell top bar. */
export function ReportBugTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
      >
        <Bug className="h-4 w-4 text-rose-600" />
        <span className="hidden sm:inline">Report a Bug</span>
      </button>
      {open && <ReportBugModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportBugModal({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [kind, setKind] = useState<Kind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("Medium");
  const [pagePath, setPagePath] = useState(pathname ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep the pagePath sync'd if the user navigates without closing.
  useEffect(() => {
    setPagePath(pathname ?? "");
  }, [pathname]);

  // Preview thumbnail when a file is selected/pasted.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFile(f: File | null | undefined) {
    if (!f) return;
    if (!/^image\//i.test(f.type)) {
      setError("Screenshot must be an image.");
      return;
    }
    if (f.size > 4 * 1024 * 1024) {
      setError("Screenshot is larger than 4MB.");
      return;
    }
    setError(null);
    setFile(f);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    handleFile(e.target.files?.[0]);
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith("image/")
    );
    if (!item) return;
    const f = item.getAsFile();
    if (f) handleFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("title", title);
    fd.append("description", description);
    // Severity is a bug-only field; don't send it on a feature request.
    if (kind === "bug") fd.append("severity", severity);
    fd.append("page_path", pagePath);
    if (file) fd.append("screenshot", file);
    const res = await submitBugReportAction(fd);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
    // Auto-close after a moment so the user sees the confirmation.
    setTimeout(onClose, 1400);
  }

  const inputClass =
    "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
      // Paste anywhere inside the modal to attach a screenshot.
      onPaste={onPaste}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div
          className={`mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider ${
            kind === "bug" ? "text-rose-600" : "text-amber-600"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              kind === "bug" ? "bg-rose-500" : "bg-amber-500"
            }`}
          />
          {kind === "bug" ? "Report a Bug" : "Feature request"}
        </div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          {kind === "bug" ? "Report a Bug" : "Suggest a feature"}
        </h2>
        <p className="mb-5 text-sm text-muted">
          {kind === "bug"
            ? "Tell us what went wrong — it goes straight to the admin's Bug Tracker. Follow it under My Bug Reports; you'll be notified as it moves."
            : "Tell us what you'd like to see — it goes straight to the admin's Bug Tracker. Follow it under My Bug Reports; you'll be notified as it moves."}
        </p>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <p className="text-sm font-medium text-foreground">Thanks — submitted.</p>
            <p className="text-xs text-muted">
              Admin will review shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <div
                role="alert"
                className="rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger"
              >
                {error}
              </div>
            )}

            <div>
              <div className="mb-1.5 text-[13px] font-medium text-brand-label">Type</div>
              <div className="grid grid-cols-2 gap-2 rounded-[10px] bg-background p-1">
                <button
                  type="button"
                  onClick={() => setKind("bug")}
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${
                    kind === "bug"
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <Bug className="h-4 w-4 text-rose-600" />
                  Bug
                </button>
                <button
                  type="button"
                  onClick={() => setKind("feature")}
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${
                    kind === "feature"
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  Feature
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="bug-title"
                className="mb-1.5 block text-[13px] font-medium text-brand-label"
              >
                Title <span className="text-danger">*</span>
              </label>
              <input
                id="bug-title"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  kind === "bug"
                    ? "Short summary of the issue"
                    : "One line — what would you like?"
                }
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="bug-desc"
                className="mb-1.5 block text-[13px] font-medium text-brand-label"
              >
                {kind === "bug" ? "What happened?" : "What would you like?"}
              </label>
              <textarea
                id="bug-desc"
                rows={4}
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  kind === "bug"
                    ? "Steps to reproduce, what you expected, what actually happened…"
                    : "Describe the feature and how it would help your workflow…"
                }
                className="w-full rounded-[10px] border border-input-border bg-surface p-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            {/* Severity is a bug concept — features skip it and get the full
                width for Page / where. */}
            <div
              className={`grid grid-cols-1 gap-4 ${
                kind === "bug" ? "sm:grid-cols-2" : ""
              }`}
            >
              {kind === "bug" && (
                <div>
                  <label
                    htmlFor="bug-sev"
                    className="mb-1.5 block text-[13px] font-medium text-brand-label"
                  >
                    Severity
                  </label>
                  <select
                    id="bug-sev"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className={`${inputClass} cursor-pointer`}
                  >
                    {["Low", "Medium", "High", "Critical"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label
                  htmlFor="bug-page"
                  className="mb-1.5 block text-[13px] font-medium text-brand-label"
                >
                  Page / where
                </label>
                <input
                  id="bug-page"
                  value={pagePath}
                  onChange={(e) => setPagePath(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[13px] font-medium text-brand-label">
                Screenshot (optional)
              </div>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-input-border bg-background/40 px-4 py-4 text-center text-sm transition-colors hover:bg-background">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Screenshot preview"
                    className="max-h-48 rounded-md border border-card-border object-contain"
                  />
                ) : (
                  <>
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted">
                      Attach a screenshot — or paste one (Ctrl/⌘+V)
                    </span>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onFileChange}
                />
                {file && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className="text-foreground">{file.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="font-medium text-danger hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </label>
            </div>

            <div className="mt-2 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="h-11 flex-1 rounded-[10px] border border-input-border bg-surface text-sm font-medium text-foreground transition-colors hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim()}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Submitting…" : kind === "bug" ? "Submit Bug" : "Submit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
