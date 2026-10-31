"use client";

import { useEffect, useState } from "react";

import ConfirmModal from "../ui/ConfirmModal";
import { roleLabel } from "../../lib/roles";
import { assignProject, listAssignees, type Assignee, type ProjectRecord } from "../../services/projectService";

/** Reassign an enquiry to a worker or to yourself (User-Master / system admins). */
export default function AssignEnquiryModal({
  project,
  onClose,
  onAssigned,
}: {
  project: ProjectRecord | null;
  onClose: () => void;
  onAssigned: (projectId: string, assignedTo: string, assignedToName: string | null) => void;
}) {
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!project) return;
    setPick(project.assigned_to ?? "");
    setErr("");
    listAssignees()
      .then(setAssignees)
      .catch(() => setErr("Couldn't load the people you can assign to."));
  }, [project]);

  const save = async () => {
    if (!project || !pick) return;
    if (pick === project.assigned_to) return onClose();
    setBusy(true);
    setErr("");
    try {
      const res = await assignProject(project.id, pick);
      onAssigned(project.id, res.assigned_to, res.assigned_to_name);
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't reassign the enquiry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmModal
      open={project !== null}
      title="Assign enquiry"
      description={
        project ? (
          <>
            <b className="font-mono">{project.project_code}</b>
            {project.name ? ` · ${project.name}` : ""} - now with{" "}
            <b>{project.assigned_to_name || "nobody"}</b>.
          </>
        ) : null
      }
      confirmLabel={busy ? "Assigning…" : "Assign"}
      busy={busy}
      onConfirm={save}
      onClose={() => !busy && onClose()}
    >
      <label className="mt-3 block text-[11.5px] font-semibold tracking-[0.09em] text-fg-3 uppercase" htmlFor="assign-to">
        Assign to
      </label>
      <select
        id="assign-to"
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        disabled={assignees === null || busy}
        className="mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-fg outline-none focus:border-accent"
      >
        <option value="">{assignees === null ? "Loading…" : "Select who works this enquiry"}</option>
        {(assignees ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.is_me ? `Me (${a.name || a.email})` : `${a.name || a.email} · ${roleLabel(a.role)}`}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[12px] text-fg-3">The new person is e-mailed; the old one no longer sees it (unless they are the User-Master).</p>
      {err && <p className="mt-2 text-[12.5px] font-medium text-neg">{err}</p>}
    </ConfirmModal>
  );
}
