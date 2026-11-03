"use client";

import { useState } from "react";

import ConfirmModal from "../ui/ConfirmModal";
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
    <ConfirmModal
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
    >
      <label className="mt-3 block text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase" htmlFor="copy-spare-to">
        Copy into
      </label>
      <select
        id="copy-spare-to"
        value={pick}
        disabled={busy}
        onChange={(e) => setPick(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-fg outline-none focus:border-accent"
      >
        {allowNew ? <option value={NEW}>A new enquiry</option> : <option value="">Select an enquiry</option>}
        {targets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.project_code}
            {p.name ? ` - ${p.name}` : ""}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[12px] text-fg-3">If the enquiry already has models, these are added after them.</p>
      {error && <p className="mt-2 text-[12.5px] font-medium text-neg">{error}</p>}
    </ConfirmModal>
  );
}
