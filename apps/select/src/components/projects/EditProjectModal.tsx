"use client";

import { useEffect, useState } from "react";
import {
  ClientFields,
  EMPTY_CLIENT,
  Field,
  ModalShell,
  OrderTypePicker,
  Section,
  btnPrimary,
  btnSecondary,
  inputCls,
  type ClientForm,
} from "./EnquiryFields";
import { todayYmd } from "./CreateProjectModal";
import type { ProjectRecord } from "../../services/projectService";
import { ORDER_SUBTYPES, defaultSubtype, type OrderSubtype, type OrderType } from "../../lib/roles";

type Props = {
  isOpen: boolean;
  project: ProjectRecord | null;
  isSaving?: boolean;
  onClose: () => void;
  onSave: (input: { enquiryDate: string; status: string; completedOn: string; orderType: OrderType; orderSubtype: OrderSubtype } & ClientForm) => void;
};

const STATUS_OPTIONS = ["In Progress", "Completed", "Pending"];

const EditProjectModal = ({ isOpen, project, isSaving, onClose, onSave }: Props) => {
  const [client, setClient] = useState<ClientForm>(EMPTY_CLIENT);
  const [enquiryDate, setEnquiryDate] = useState("");
  const [status, setStatus] = useState("In Progress");
  const [completedOn, setCompletedOn] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("pump");
  const [orderSubtype, setOrderSubtype] = useState<OrderSubtype>("pcp");

  // Re-seed the fields whenever a different project is opened for editing.
  useEffect(() => {
    if (!project) return;
    setClient({
      name: project.name ?? "",
      clientCode: project.client_code ?? "",
      industry: project.industry ?? "",
      clientPrimaryRep: project.client_primary_rep ?? "",
      clientSecondaryReps: project.client_secondary_reps ?? "",
      clientMarketType: project.client_market_type ?? "",
      clientZone: project.client_zone ?? "",
    });
    setEnquiryDate(project.enquiry_date ?? "");
    setStatus(project.status ?? "In Progress");
    setCompletedOn(project.completed_on ?? "");
    const t: OrderType = project.order_type === "spare" ? "spare" : "pump";
    setOrderType(t);
    setOrderSubtype(ORDER_SUBTYPES[t].find((o) => o.value === project.order_subtype)?.value ?? defaultSubtype(t));
  }, [project]);

  if (!isOpen || !project) return null;

  // Already Completed through its tags, never marked: the date is optional, so
  // editing the client of a finished enquiry does not ask for one.
  const doneByTags = project.status === "Completed" && !project.completed_on;
  const completing = status === "Completed";
  const dateMissing = completing && !doneByTags && !completedOn;
  const dateTooEarly = completing && Boolean(completedOn && enquiryDate && completedOn < enquiryDate);
  const chooseStatus = (s: string) => {
    setStatus(s);
    if (s === "Completed" && !doneByTags && !completedOn) setCompletedOn(todayYmd());
  };

  return (
    <ModalShell
      title="Edit Enquiry"
      subtitle={project.project_code}
      busy={isSaving}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={isSaving || !client.name.trim() || dateMissing || dateTooEarly}
            onClick={() => onSave({ enquiryDate, status, completedOn: completing ? completedOn : "", orderType, orderSubtype, ...client })}
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </>
      }
    >
      <Section step={1} title="Enquiry" subtitle="Order type, date received and status">
        <Field label="Order type" wide group>
          <OrderTypePicker
            value={orderType}
            subtype={orderSubtype}
            onChange={(t, s) => {
              setOrderType(t);
              setOrderSubtype(s);
            }}
          />
        </Field>
        <Field label="Enquiry date">
          <input type="date" className={inputCls} value={enquiryDate} onChange={(e) => setEnquiryDate(e.target.value)} />
        </Field>
        <Field label="Status" hint="Completed applies to the whole enquiry, whatever its tags say. Any other status follows the tags.">
          <select className={inputCls} value={status} onChange={(e) => chooseStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        {completing && (
          <Field
            label="Completion date"
            required={!doneByTags}
            hint={
              dateTooEarly
                ? "Can't be before the enquiry date."
                : doneByTags
                  ? "Completed through its tags. Enter a date to record it."
                  : "The date this enquiry was completed."
            }
          >
            <input type="date" className={inputCls} value={completedOn} min={enquiryDate || undefined} max={todayYmd()} onChange={(e) => setCompletedOn(e.target.value)} />
          </Field>
        )}
      </Section>

      <Section step={2} title="Client" subtitle="Pick a client to replace these details, or edit them">
        {/* Keyed by enquiry so each edit starts with an empty search. */}
        <ClientFields
          value={client}
          onChange={setClient}
          lookupKey={project.id}
          lookupHint="Searches the client master. Pick a result to replace the client details below."
        />
      </Section>
    </ModalShell>
  );
};

export default EditProjectModal;
