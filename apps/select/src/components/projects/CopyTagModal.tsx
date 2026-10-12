"use client";

import { useEffect, useState } from "react";
import "./CreateProjectModal.css";
import "./CopyTagModal.css";
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
  onCancel,
  onConfirm,
}: Props) => {
  const [tagId, setTagId] = useState(initialTagId ?? tags[0]?.id ?? "");
  const [dest, setDest] = useState<CopyDestination["kind"]>("same");
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

  return (
    <div className="modal-overlay">
      <div className="modal copy-modal">
        <h2>Copy tag</h2>
        <p className="copy-lead">
          Copies every pump-selection detail into a new tag. The generated
          report isn&apos;t carried over &mdash; the copy starts as its own
          selection run.
        </p>

        <div className="modal-form">
          <div className="form-group">
            <label>Tag to copy</label>
            {tags.length === 1 ? (
              <div className="copy-static">
                {tags[0].name}
                <span className="copy-static-sub">
                  {tags[0].liquid || "no media yet"}
                </span>
              </div>
            ) : (
              <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.liquid ? ` — ${t.liquid}` : ""} ({t.status})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-group">
            <label>Copy into</label>
            <div className="copy-choices">
              <label className={`copy-choice${dest === "same" ? " is-on" : ""}`}>
                <input
                  type="radio"
                  name="copy-dest"
                  checked={dest === "same"}
                  onChange={() => setDest("same")}
                />
                <span>
                  <b>This enquiry</b>
                  <em>{sourceProject.project_code}</em>
                </span>
              </label>

              <label className={`copy-choice${dest === "existing" ? " is-on" : ""}`}>
                <input
                  type="radio"
                  name="copy-dest"
                  checked={dest === "existing"}
                  onChange={() => setDest("existing")}
                  disabled={projects.length === 0}
                />
                <span>
                  <b>An existing enquiry</b>
                  <em>
                    {projects.length === 0
                      ? "No other enquiries yet"
                      : "Add the copy as a new tag there"}
                  </em>
                </span>
              </label>

              <label className={`copy-choice${dest === "new" ? " is-on" : ""}`}>
                <input
                  type="radio"
                  name="copy-dest"
                  checked={dest === "new"}
                  onChange={() => setDest("new")}
                />
                <span>
                  <b>A new enquiry</b>
                  <em>Enter the enquiry details next</em>
                </span>
              </label>
            </div>
          </div>

          {dest === "existing" && (
            <div className="form-group">
              <label>Destination enquiry</label>
              <select
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                autoFocus
              >
                <option value="">Select an enquiry</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code}
                    {p.name ? ` — ${p.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="cancel-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="create-btn" onClick={submit} disabled={!canConfirm}>
            {busy
              ? "Copying…"
              : dest === "new"
                ? "Continue"
                : `Copy ${selectedTag ? selectedTag.name : "tag"}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CopyTagModal;
