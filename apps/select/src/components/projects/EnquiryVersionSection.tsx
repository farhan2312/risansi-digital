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

type Kind = "both" | "technical" | "commercial";

const KIND_LABEL: Record<Kind, string> = {
  both: "Technical and Commercial",
  technical: "Technical only",
  commercial: "Commercial only",
};

/** On the Edit Enquiry form: the next version - a copy of this version with a revised
 *  enquiry date, assigned to a worker. What it versions follows the statuses (user,
 *  2026-11-23; api/projects/[id]/versions): only the side that is Completed, and when
 *  both are, Both unless Technical only / Commercial only is picked. */
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

  const isSpare = project.order_type === "spare";
  const technicalDone = versionReady(project.status);
  const commercialDone = !isSpare && versionReady(project.commercial_status);
  const completed = technicalDone || commercialDone;
  // Picked only when both sides are Completed; otherwise the status decides.
  const [picked, setPicked] = useState<Kind>("both");
  const kind: Kind = isSpare ? "both" : technicalDone && commercialDone ? picked : technicalDone ? "technical" : "commercial";
  const t = project.technical_version_no ?? project.version_no;
  const c = project.commercial_version_no;
  useEffect(() => {
    if (!completed) return;
    listAssignees()
      .then(setAssignees)
      .catch(() => setErr("Couldn't load the people you can assign to."));
  }, [completed]);

  const next = project.version_no + 1;
  const noteMissing = !note.trim();
  const tooEarly = Boolean(project.enquiry_date && enquiryDate && enquiryDate < project.enquiry_date);

  const create = async () => {
    setBusy(true);
    onBusyChange(true);
    setErr("");
    try {
      await createEnquiryRevision(project.id, { enquiryDate, assignedTo: pick, note: note.trim(), kind });
      onCreated();
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't create the new version.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <Section
      step={step}
      title={isSpare ? `New version (V${next})` : "New version"}
      subtitle={isSpare ? `This is V${project.version_no}. Use this when the client asks for changes.` : `This is Technical V${t} and Commercial V${c}. Use this when the client asks for changes.`}
    >
      {!completed ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[12.5px] text-muted-foreground sm:col-span-2">
          {isSpare
            ? `V${next} can be created once this version's quotation is saved.`
            : "A new version can be created once this version's Technical or Commercial status is Completed. Only the side that is Completed is versioned."}
        </p>
      ) : (
        <>
          {!isSpare &&
            (technicalDone && commercialDone ? (
                <Field label="What changes in the new version?" required wide>
                  <NativeSelect className="w-full" value={picked} disabled={busy} onChange={(e) => setPicked(e.target.value as Kind)}>
                    <option value="both">Technical and Commercial: Technical V{t + 1}, Commercial V{c + 1}</option>
                    <option value="technical">Technical only: Technical V{t + 1}, Commercial stays V{c}</option>
                    <option value="commercial">Commercial only: Commercial V{c + 1}, Technical stays V{t}</option>
                  </NativeSelect>
                </Field>
              ) : (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[12.5px] text-foreground sm:col-span-2">
                  <b className="font-semibold">{KIND_LABEL[kind]} version.</b>{" "}
                  {kind === "technical"
                    ? `Only Technical is Completed (Commercial is ${project.commercial_status ?? "Pending"}), so Technical becomes V${t + 1} and Commercial stays V${c}, carrying on as it is.`
                    : `Only Commercial is Completed (Technical is ${project.status ?? "Pending"}), so Commercial becomes V${c + 1} and Technical stays V${t}.`}
                </p>
              ))}
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
          <Field label="What did the client ask to change?" required wide hint={noteMissing ? "Required: why this version is being made." : undefined}>
            <Textarea rows={2} maxLength={2000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button
              size="lg"
              disabled={busy || hasUnsavedChanges || !enquiryDate || tooEarly || !pick || noteMissing}
              onClick={create}
            >
              {busy ? "Creating…" : isSpare ? `Create V${next}` : `Create ${KIND_LABEL[kind]} version`}
            </Button>
            <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
              {hasUnsavedChanges
                ? `Save or cancel your changes above first - V${next} is copied from the saved enquiry.`
                : isSpare
                  ? `Copies the reference PO, models, parts, prices and quotation number. V${project.version_no} becomes view only.`
                  : kind === "both"
                    ? `Copies the tags, pump selection, prices and quotation number. This version becomes view only, and each tag is confirmed again. Technical will be V${t + 1} and Commercial V${c + 1}, so prices are checked and saved again.`
                    : kind === "technical"
                      ? `Copies the tags, pump selection, prices and quotation number. This version becomes view only, and each tag is confirmed again. Commercial keeps its status, prices and saved quotation; prices don't change by themselves - one the new selection affects is flagged on the Commercial page.`
                      : `Copies everything. This version becomes view only. The pump selection, tag reports, approvals and Technical Data Sheet stay as they are and can only be viewed; prices are checked and saved again.`}
            </span>
          </div>
          {err && <Alert className="sm:col-span-2">{err}</Alert>}
        </>
      )}
    </Section>
  );
}
