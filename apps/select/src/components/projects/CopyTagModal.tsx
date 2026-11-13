"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Button } from "@/components/shadcn/button";
import { NativeSelect } from "@/components/shadcn/input";
import { Alert, Field, Label } from "@/components/shadcn/field";
import type { TagRecord } from "../../services/tagsService";

export type CopyDestination =
  | { kind: "same" }
  | { kind: "existing"; projectId: string }
  | { kind: "new" };

type ProjectOption = {
  id: string;
  project_code: string;
  /** Nullable on ProjectRecord - enquiries can be created without one. */
  name: string | null;
};

type Props = {
  /** The enquiry the copy is being started from. */
  sourceProject: ProjectOption;
  /** Tags available to copy. When exactly one is passed the picker is skipped. */
  tags: TagRecord[];
  /** Pre-selected tag — set when the copy started from a tag's own button. */
  initialTagId?: string;
  /** Other enquiries the tag can be copied into. */
  projects: ProjectOption[];
  busy?: boolean;
  error?: string | null;
  /** Offer "A new enquiry" - false for a worker, who cannot create one. */
  allowNew?: boolean;
  /** Offer "This enquiry" - false when the source enquiry is not one the
   *  worker may work on (they copy it into one of theirs instead). */
  allowSame?: boolean;
  onCancel: () => void;
  onConfirm: (tagId: string, destination: CopyDestination) => void;
};

/**
 * Two-step copy dialog: pick the tag, then pick where it lands. "New enquiry"
 * hands back to the page, which opens the Create Enquiry form and copies the
 * tag into whatever it creates — so the enquiry fields (client lookup, FY
 * prefix) aren't duplicated here.
 */
const CopyTagModal = ({
  sourceProject,
  tags,
  initialTagId,
  projects,
  busy = false,
  error,
  allowNew = true,
  allowSame = true,
  onCancel,
  onConfirm,
}: Props) => {
  const [tagId, setTagId] = useState(initialTagId ?? tags[0]?.id ?? "");
  const [dest, setDest] = useState<CopyDestination["kind"]>(allowSame ? "same" : "existing");
  const [targetProjectId, setTargetProjectId] = useState("");

  // Opened from the enquiry's Copy button, the tags are still loading, so the
  // initial pick above is empty. Once they arrive, pick the first one (what
  // the dropdown shows) - otherwise nothing is selected and Continue stays
  // disabled even though a tag appears chosen.
  useEffect(() => {
    if (tags.length > 0 && !tags.some((t) => t.id === tagId)) {
      setTagId(initialTagId && tags.some((t) => t.id === initialTagId) ? initialTagId : tags[0].id);
    }
  }, [tags, tagId, initialTagId]);

  const selectedTag = tags.find((t) => t.id === tagId) ?? null;
  const canConfirm =
    !busy && tagId !== "" && (dest !== "existing" || targetProjectId !== "");

  const submit = () => {
    if (!canConfirm) return;
    if (dest === "existing") onConfirm(tagId, { kind: "existing", projectId: targetProjectId });
    else if (dest === "new") onConfirm(tagId, { kind: "new" });
    else onConfirm(tagId, { kind: "same" });
  };

  // One destination choice: a radio with its title and a line under it.
  const choiceCls = (on: boolean) =>
    `flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${on ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/20" : "border-border bg-card hover:border-input hover:bg-muted/50"}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent size="sm" className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Copy tag</DialogTitle>
          <DialogDescription>
            Copies every pump-selection detail into a new tag. The generated report isn&apos;t carried over &mdash; the copy starts as its own selection run.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4">
          <Field label="Tag to copy" htmlFor={tags.length === 1 ? undefined : "copy-tag-pick"}>
            {tags.length === 1 ? (
              <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-[13px] font-medium text-foreground">
                {tags[0].name}
                <span className="text-[11.5px] font-normal text-muted-foreground">{tags[0].liquid || "no media yet"}</span>
              </div>
            ) : (
              <NativeSelect id="copy-tag-pick" className="h-9 w-full" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.liquid ? ` — ${t.liquid}` : ""} ({t.status})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <div className="grid gap-1.5">
            <Label>Copy into</Label>
            <div className="grid gap-2" role="radiogroup" aria-label="Copy into">
              {allowSame && (
                <label className={choiceCls(dest === "same")}>
                  <input type="radio" name="copy-dest" className="mt-0.5 accent-[var(--sc-primary)]" checked={dest === "same"} onChange={() => setDest("same")} />
                  <span className="grid gap-0.5">
                    <b className="text-[13px] font-medium text-foreground">This enquiry</b>
                    <em className="font-mono text-[11.5px] text-muted-foreground not-italic">{sourceProject.project_code}</em>
                  </span>
                </label>
              )}

              <label className={choiceCls(dest === "existing")}>
                <input
                  type="radio"
                  name="copy-dest"
                  className="mt-0.5 accent-[var(--sc-primary)]"
                  checked={dest === "existing"}
                  onChange={() => setDest("existing")}
                  disabled={projects.length === 0}
                />
                <span className="grid gap-0.5">
                  <b className="text-[13px] font-medium text-foreground">An existing enquiry</b>
                  <em className="text-[11.5px] text-muted-foreground not-italic">
                    {projects.length === 0
                      ? allowSame
                        ? "No other enquiries yet"
                        : "No enquiries assigned to you yet"
                      : "Add the copy as a new tag there"}
                  </em>
                </span>
              </label>

              {allowNew && (
                <label className={choiceCls(dest === "new")}>
                  <input type="radio" name="copy-dest" className="mt-0.5 accent-[var(--sc-primary)]" checked={dest === "new"} onChange={() => setDest("new")} />
                  <span className="grid gap-0.5">
                    <b className="text-[13px] font-medium text-foreground">A new enquiry</b>
                    <em className="text-[11.5px] text-muted-foreground not-italic">Enter the enquiry details next</em>
                  </span>
                </label>
              )}
            </div>
          </div>

          {dest === "existing" && (
            <Field label="Destination enquiry" htmlFor="copy-tag-dest">
              <NativeSelect id="copy-tag-dest" className="h-9 w-full" value={targetProjectId} onChange={(e) => setTargetProjectId(e.target.value)} autoFocus>
                <option value="">Select an enquiry</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code}
                    {p.name ? ` — ${p.name}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          {error && <Alert>{error}</Alert>}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canConfirm}>
            {busy ? "Copying…" : dest === "new" ? "Continue" : `Copy ${selectedTag ? selectedTag.name : "tag"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CopyTagModal;
