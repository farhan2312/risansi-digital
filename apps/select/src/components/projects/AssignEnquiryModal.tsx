"use client";

import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import { NativeSelect } from "@/components/shadcn/input";
import { Field } from "@/components/shadcn/field";
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
    <ConfirmDialog
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
      confirmDisabled={!pick}
    >
      <Field
        label="Assign to"
        htmlFor="assign-to"
        hint="Only the person it is assigned to can work on it; everyone can still view it and copy its tags."
        error={err || undefined}
      >
      <NativeSelect
        id="assign-to"
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        disabled={assignees === null || busy}
        className="h-9 w-full"
      >
        <option value="">{assignees === null ? "Loading…" : "Select who works this enquiry"}</option>
        {(assignees ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.is_me ? `Me (${a.name || a.email})` : `${a.name || a.email} · ${roleLabel(a.role)}`}
          </option>
        ))}
      </NativeSelect>
      </Field>
    </ConfirmDialog>
  );
}
