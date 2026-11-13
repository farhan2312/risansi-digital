"use client";

import { useEffect, useState } from "react";

import { todayYmd } from "./CreateProjectModal";
import { Field, Section } from "./EnquiryFields";
import { Button } from "@/components/shadcn/button";
import { Alert, Textarea } from "@/components/shadcn/field";
import { Input, NativeSelect } from "@/components/shadcn/input";
import { versionReady } from "../../lib/enquiry-filters";
import { roleLabel } from "../../lib/roles";
import { createEnquiryRevision, listAssignees, type Assignee, type ProjectRecord } from "../../services/projectService";

/** On the Edit Enquiry form: the next version of a technically Completed enquiry - a copy of
 *  this version with a revised enquiry date, assigned to a worker. */
export default function EnquiryVersionSection({
  step,
  project,
  hasUnsavedChanges,
  onBusyChange,
  onCreated,
}: {
  step: number;
  project: ProjectRecord;
  /** The copy is of the saved enquiry, so edits on the form go first. */
  hasUnsavedChanges: boolean;
  onBusyChange: (busy: boolean) => void;
  onCreated: () => void;
}) {
  const today = todayYmd();
  const [enquiryDate, setEnquiryDate] = useState(project.enquiry_date && project.enquiry_date > today ? project.enquiry_date : today);
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [pick, setPick] = useState(project.assigned_to ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const completed = versionReady(project.status);
  useEffect(() => {
    if (!completed) return;
    listAssignees()
      .then(setAssignees)
      .catch(() => setErr("Couldn't load the people you can assign to."));
  }, [completed]);

  const next = project.version_no + 1;
  const isSpare = project.order_type === "spare";
  const tooEarly = Boolean(project.enquiry_date && enquiryDate && enquiryDate < project.enquiry_date);

  const create = async () => {
    setBusy(true);
    onBusyChange(true);
    setErr("");
    try {
      await createEnquiryRevision(project.id, { enquiryDate, assignedTo: pick, note });
      onCreated();
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't create the new version.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <Section step={step} title={`New version (V${next})`} subtitle={`This is V${project.version_no}. Use this when the client asks for changes.`}>
      {!completed ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[12.5px] text-muted-foreground sm:col-span-2">
          {project.order_type === "spare"
            ? `V${next} can be created once this version's quotation is saved.`
            : `V${next} can be created once this version's Technical status is Completed and saved.`}
        </p>
      ) : (
        <>
          <Field label="Revised enquiry date" required hint={tooEarly ? "Can't be before this version's date." : undefined}>
            <Input
              type="date"
              value={enquiryDate}
              min={project.enquiry_date ?? undefined}
              disabled={busy}
              onChange={(e) => setEnquiryDate(e.target.value)}
            />
          </Field>
          <Field label="Assign to" required>
            <NativeSelect className="w-full" value={pick} disabled={assignees === null || busy} onChange={(e) => setPick(e.target.value)}>
              <option value="">{assignees === null ? "Loading…" : "Select who works this version"}</option>
              {(assignees ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.is_me ? `Me (${a.name || a.email})` : `${a.name || a.email} · ${roleLabel(a.role)}`}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="What did the client ask to change?" wide>
            <Textarea rows={2} maxLength={2000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button
              size="lg"
              disabled={busy || hasUnsavedChanges || !enquiryDate || tooEarly || !pick}
              onClick={create}
            >
              {busy ? "Creating…" : `Create V${next}`}
            </Button>
            <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
              {hasUnsavedChanges
                ? `Save or cancel your changes above first - V${next} is copied from the saved enquiry.`
                : isSpare
                  ? `Copies the reference PO, models, parts, prices and quotation number. V${project.version_no} becomes view only.`
                  : `Copies the tags, pump selection, prices and quotation number. V${project.version_no} becomes view only, and each tag is confirmed again in V${next}. Technical will be V${next} and Commercial V${project.commercial_version_no + 1}, so prices are checked and saved again.`}
            </span>
          </div>
          {err && <Alert className="sm:col-span-2">{err}</Alert>}
        </>
      )}
    </Section>
  );
}
