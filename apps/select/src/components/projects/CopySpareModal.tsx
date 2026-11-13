"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import { NativeSelect } from "@/components/shadcn/input";
import { Field } from "@/components/shadcn/field";
import type { ProjectRecord } from "../../services/projectService";

const NEW = "__new__";

/** Copy a spare enquiry's models and parts into another spare enquiry or a new one.
 *  "New" hands back to the page, which opens the Create Enquiry form. */
export default function CopySpareModal({
  source,
  targets,
  allowNew,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  source: ProjectRecord;
  /** Spare enquiries the caller may work on, other than the source. */
  targets: ProjectRecord[];
  /** False for a worker, who cannot create an enquiry. */
  allowNew: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (target: string | "new") => void;
}) {
  const [pick, setPick] = useState(allowNew ? NEW : "");
  return (
    <ConfirmDialog
      open
      title="Copy this spare quotation"
      description={
        <>
          Copies the models and parts of <b className="font-mono">{source.project_code}</b>, with quantities and
          prices. The reference PO and quotation number are not copied.
        </>
      }
      confirmLabel={busy ? "Copying…" : pick === NEW ? "Continue" : "Copy"}
      busy={busy}
      onConfirm={() => pick && onConfirm(pick === NEW ? "new" : pick)}
      onClose={() => !busy && onCancel()}
      confirmDisabled={!pick}
    >
      <Field label="Copy into" htmlFor="copy-spare-to" hint="If the enquiry already has models, these are added after them." error={error || undefined}>
      <NativeSelect
        id="copy-spare-to"
        value={pick}
        disabled={busy}
        onChange={(e) => setPick(e.target.value)}
        className="h-9 w-full"
      >
        {allowNew ? <option value={NEW}>A new enquiry</option> : <option value="">Select an enquiry</option>}
        {targets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.project_code}
            {p.name ? ` - ${p.name}` : ""}
          </option>
        ))}
      </NativeSelect>
      </Field>
    </ConfirmDialog>
  );
}
