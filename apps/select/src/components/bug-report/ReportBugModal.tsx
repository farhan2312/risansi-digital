"use client";

import { useEffect, useRef, useState } from "react";
import { Bug, Lightbulb, Paperclip, X } from "lucide-react";
// shadcn/ui (user, 2026-11-13: the Report a Bug pop-up in the new look, branch select-shadcn).
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Alert, Field, Textarea } from "@/components/shadcn/field";
import { Input, NativeSelect } from "@/components/shadcn/input";
import { createBugReport, type BugReportSeverity, type BugReportType } from "../../services/bugReportService";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Current page path, pre-filled into "Page / where" (still editable). */
  page: string;
  onSubmitted?: () => void;
};

const SEVERITIES: BugReportSeverity[] = ["Low", "Medium", "High", "Critical"];

// All the copy that flips between "report a bug" and "request a feature" —
// kept in one place so the two flows read as genuinely different forms
// rather than a bug form with a mislabeled radio button.
const COPY: Record<
  BugReportType,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    submitLabel: string;
    submittingLabel: string;
  }
> = {
  bug: {
    eyebrow: "Report a bug",
    title: "Report a Bug",
    subtitle: "Tell us what went wrong — it goes straight to the admin's Bug Tracker.",
    titlePlaceholder: "Short summary of the issue",
    descriptionLabel: "What happened?",
    descriptionPlaceholder: "Steps to reproduce, what you expected, what actually happened…",
    submitLabel: "Submit Bug",
    submittingLabel: "Submitting…",
  },
  feature: {
    eyebrow: "Report a feature",
    title: "Report a Feature",
    subtitle: "Tell us what you'd like to see — it goes straight to the admin's Bug Tracker.",
    titlePlaceholder: "Short summary of the request",
    descriptionLabel: "What would you like?",
    descriptionPlaceholder: "What you're trying to do, and how this feature would help…",
    submitLabel: "Submit Feature",
    submittingLabel: "Submitting…",
  },
};

// Reads a File/Blob (from an <input> pick or a clipboard paste) into a data:
// URL — the shape the API expects for screenshotDataUrl.
const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const ReportBugModal = ({ isOpen, onClose, page, onSubmitted }: Props) => {
  const [type, setType] = useState<BugReportType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugReportSeverity>("Medium");
  const [pageWhere, setPageWhere] = useState(page);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-seed the page field and clear the form each time the modal opens fresh
  // (not on every `page` change while it's already open, so navigating away
  // mid-fill doesn't silently rewrite what the user typed).
  useEffect(() => {
    if (isOpen) {
      setType("bug");
      setTitle("");
      setDescription("");
      setSeverity("Medium");
      setPageWhere(page);
      setScreenshotName(null);
      setScreenshotDataUrl(null);
      setFormError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Ctrl/Cmd+V screenshot paste, while the modal is open.
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      const dataUrl = await readAsDataUrl(file);
      setScreenshotDataUrl(dataUrl);
      setScreenshotName(`pasted-${Date.now()}.png`);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen]);

  if (!isOpen) return null;

  const copy = COPY[type];

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setScreenshotDataUrl(dataUrl);
    setScreenshotName(file.name);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!title.trim()) {
      setFormError("Title can't be empty.");
      return;
    }
    if (!description.trim()) {
      setFormError("Tell us what happened.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await createBugReport({
        type,
        title: title.trim(),
        description: description.trim(),
        severity,
        page: pageWhere.trim(),
        screenshotDataUrl: screenshotDataUrl ?? undefined,
        screenshotFileName: screenshotName ?? undefined,
      });
      onSubmitted?.();
      onClose();
    } catch {
      setFormError("Couldn't submit — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Escape, the X, Cancel or a click outside close it, as before.
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" className="max-w-[560px]" onInteractOutside={() => undefined}>
        <DialogHeader>
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {type === "feature" ? <Lightbulb className="size-3.5 text-warning" /> : <Bug className="size-3.5 text-destructive" />}
            {copy.eyebrow}
          </div>
          <DialogTitle className="text-[16px]">{copy.title}</DialogTitle>
          <DialogDescription>{copy.subtitle}</DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-3.5">
          <Field label="Type">
            <div className="inline-flex h-8 w-fit items-center rounded-md bg-muted p-0.5 ring-1 ring-border ring-inset" role="radiogroup" aria-label="Type">
              {(
                [
                  ["bug", "Bug", <Bug key="i" className="size-3.5" />],
                  ["feature", "Feature", <Lightbulb key="i" className="size-3.5" />],
                ] as const
              ).map(([key, label, icon]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={type === key}
                  onClick={() => setType(key)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12.5px] font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
                    type === key ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1)]" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Title" htmlFor="bug-title" required>
            <Input id="bug-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={copy.titlePlaceholder} />
          </Field>

          <Field label={copy.descriptionLabel} htmlFor="bug-description" required>
            <Textarea id="bug-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={copy.descriptionPlaceholder} />
          </Field>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Severity" htmlFor="bug-severity">
              <NativeSelect id="bug-severity" value={severity} onChange={(e) => setSeverity(e.target.value as BugReportSeverity)} className="w-full">
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Page / where" htmlFor="bug-page">
              <Input id="bug-page" value={pageWhere} onChange={(e) => setPageWhere(e.target.value)} />
            </Field>
          </div>

          <Field label="Screenshot (optional)">
            {screenshotName ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-foreground">
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{screenshotName}</span>
                </span>
                <Button
                  variant="ghost-destructive"
                  size="sm"
                  onClick={() => {
                    setScreenshotName(null);
                    setScreenshotDataUrl(null);
                  }}
                >
                  <X /> Remove
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-3 text-[12.5px] text-muted-foreground transition outline-none hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/30"
              >
                <Paperclip className="size-3.5" /> Attach a screenshot — or paste one (Ctrl/⌘+V)
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={handleFilePick} />
          </Field>

          {formError && <Alert>{formError}</Alert>}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {type === "feature" ? <Lightbulb /> : <Bug />}
            {submitting ? copy.submittingLabel : copy.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportBugModal;
