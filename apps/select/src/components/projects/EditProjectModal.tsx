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
import EnquiryVersionSection from "./EnquiryVersionSection";
import type { ProjectRecord } from "../../services/projectService";
import { ORDER_SUBTYPES, defaultSubtype, type OrderSubtype, type OrderType } from "../../lib/roles";

type Props = {
  isOpen: boolean;
  project: ProjectRecord | null;
  isSaving?: boolean;
  onClose: () => void;
  /** Why the last save failed (e.g. the enquiry no. is taken); shown on the form. */
  saveError?: string | null;
  onSave: (
    input: {
      /** Sent only when it changed. */
      projectCode?: string;
      enquiryDate: string;
      technicalStatus?: string;
      completedOn?: string;
      commercialStatus: string;
      commercialCompletedOn: string;
      orderType: OrderType;
      orderSubtype: OrderSubtype;
    } & ClientForm,
  ) => void;
  /** A new version was made from this enquiry (the form's New version section). */
  onVersionCreated: () => void;
};

const STATUS_OPTIONS = ["In Progress", "Completed", "Pending", "Not Quoted", "Regret", "Sent to client"];

/** Shows the enquiry's status as it is now; it can be changed by hand, and
 *  Completed shows its date, which can be changed too. */
const StatusField = ({
  label,
  choice,
  day,
  saved,
  minDay,
  onChoice,
  onDay,
}: {
  label: string;
  choice: string;
  day: string;
  /** The date on record: an automatic one may fall before the enquiry date. */
  saved: string;
  minDay: string;
  onChoice: (status: string) => void;
  onDay: (day: string) => void;
}) => {
  const tooEarly = Boolean(day && day !== saved && minDay && day < minDay);
  return (
    <>
      <Field label={label}>
        <select className={inputCls} value={choice} onChange={(e) => onChoice(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      {choice === "Completed" && (
        <Field label={label === "Status" ? "Completion date" : `${label} completion date`} required hint={tooEarly ? "Can't be before the enquiry date." : undefined}>
          <input type="date" className={inputCls} value={day} min={minDay || undefined} max={todayYmd()} onChange={(e) => onDay(e.target.value)} />
        </Field>
      )}
    </>
  );
};

const savedStatus = (status: string | null | undefined): string => (status && STATUS_OPTIONS.includes(status) ? status : "Pending");
/** A Completed status with no date on record (an old enquiry) offers today. */
const savedDay = (status: string | null | undefined, day: string | null): string => day ?? (status === "Completed" ? todayYmd() : "");

const clientOf = (project: ProjectRecord): ClientForm => ({
  name: project.name ?? "",
  clientCode: project.client_code ?? "",
  industry: project.industry ?? "",
  clientPrimaryRep: project.client_primary_rep ?? "",
  clientSecondaryReps: project.client_secondary_reps ?? "",
  clientMarketType: project.client_market_type ?? "",
  clientZone: project.client_zone ?? "",
});

const subtypeOf = (project: ProjectRecord, t: OrderType): OrderSubtype =>
  ORDER_SUBTYPES[t].find((o) => o.value === project.order_subtype)?.value ?? defaultSubtype(t);

const EditProjectModal = ({ isOpen, project, isSaving, saveError, onClose, onSave, onVersionCreated }: Props) => {
  const [client, setClient] = useState<ClientForm>(EMPTY_CLIENT);
  const [enquiryNo, setEnquiryNo] = useState("");
  const [enquiryDate, setEnquiryDate] = useState("");
  const [technicalStatus, setTechnicalStatus] = useState("Pending");
  const [completedOn, setCompletedOn] = useState("");
  const [commercialStatus, setCommercialStatus] = useState("Pending");
  const [commercialCompletedOn, setCommercialCompletedOn] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("pump");
  const [orderSubtype, setOrderSubtype] = useState<OrderSubtype>("pcp");
  const [creatingVersion, setCreatingVersion] = useState(false);

  // Re-seed the fields whenever a different project is opened for editing.
  useEffect(() => {
    if (!project) return;
    setClient(clientOf(project));
    setEnquiryNo(project.project_code ?? "");
    setEnquiryDate(project.enquiry_date ?? "");
    setTechnicalStatus(savedStatus(project.status));
    setCompletedOn(savedDay(project.status, project.completed_on));
    setCommercialStatus(savedStatus(project.commercial_status));
    setCommercialCompletedOn(savedDay(project.commercial_status, project.commercial_completed_on));
    const t: OrderType = project.order_type === "spare" ? "spare" : "pump";
    setOrderType(t);
    setOrderSubtype(subtypeOf(project, t));
  }, [project]);

  if (!isOpen || !project) return null;

  // A status picked as Completed needs a date, not before the enquiry date.
  const savedTechnicalDay = savedDay(project.status, project.completed_on);
  const savedCommercialDay = savedDay(project.commercial_status, project.commercial_completed_on);
  const badDay = (status: string, day: string, saved: string) =>
    status === "Completed" && (!day || (day !== saved && Boolean(enquiryDate && day < enquiryDate)));
  const isSpare = project.order_type === "spare";
  const datesBad = (!isSpare && badDay(technicalStatus, completedOn, savedTechnicalDay)) || badDay(commercialStatus, commercialCompletedOn, savedCommercialDay);

  const savedType: OrderType = project.order_type === "spare" ? "spare" : "pump";
  const savedClient = clientOf(project);
  const savedNo = project.project_code ?? "";
  const newNo = enquiryNo.trim();
  const noChanged = newNo !== savedNo;
  const unsaved =
    noChanged ||
    enquiryDate !== (project.enquiry_date ?? "") ||
    (!isSpare && technicalStatus !== savedStatus(project.status)) ||
    (!isSpare && technicalStatus === "Completed" && completedOn !== savedTechnicalDay) ||
    commercialStatus !== savedStatus(project.commercial_status) ||
    (commercialStatus === "Completed" && commercialCompletedOn !== savedCommercialDay) ||
    orderType !== savedType ||
    orderSubtype !== subtypeOf(project, savedType) ||
    (Object.keys(savedClient) as (keyof ClientForm)[]).some((k) => (client[k] ?? "") !== savedClient[k]);

  return (
    <ModalShell
      title="Edit Enquiry"
      subtitle={project.project_code}
      busy={isSaving || creatingVersion}
      onClose={onClose}
      footer={
        <>
          {saveError && (
            <p className="mr-auto text-[12.5px] font-medium text-neg" role="alert">
              {saveError}
            </p>
          )}
          <button type="button" className={btnSecondary} onClick={onClose} disabled={isSaving || creatingVersion}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={isSaving || creatingVersion || !client.name.trim() || !newNo || datesBad}
            onClick={() =>
              onSave({
                ...(noChanged ? { projectCode: newNo } : {}),
                enquiryDate,
                ...(isSpare ? {} : { technicalStatus, completedOn: technicalStatus === "Completed" ? completedOn : "" }),
                commercialStatus,
                commercialCompletedOn: commercialStatus === "Completed" ? commercialCompletedOn : "",
                orderType,
                orderSubtype,
                ...client,
              })
            }
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </>
      }
    >
      <Section step={1} title="Enquiry" subtitle="Order type, number, date received and statuses">
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
        <Field
          label="Enquiry no."
          required
          hint={!newNo ? "Enquiry no. is required." : noChanged ? `Was ${savedNo}. Every version of the enquiry takes the new number.` : undefined}
        >
          <input className={`${inputCls} font-mono`} value={enquiryNo} onChange={(e) => setEnquiryNo(e.target.value)} />
        </Field>
        <Field label="Enquiry date">
          <input type="date" className={inputCls} value={enquiryDate} onChange={(e) => setEnquiryDate(e.target.value)} />
        </Field>
        {!isSpare && (
          <StatusField
            label="Technical status"
            choice={technicalStatus}
            day={completedOn}
            saved={savedTechnicalDay}
            minDay={enquiryDate}
            onChoice={(s) => {
              setTechnicalStatus(s);
              if (s === "Completed" && !completedOn) setCompletedOn(project.completed_on ?? todayYmd());
            }}
            onDay={setCompletedOn}
          />
        )}
        <StatusField
          label={isSpare ? "Status" : "Commercial status"}
          choice={commercialStatus}
          day={commercialCompletedOn}
          saved={savedCommercialDay}
          minDay={enquiryDate}
          onChoice={(s) => {
            setCommercialStatus(s);
            if (s === "Completed" && !commercialCompletedOn) setCommercialCompletedOn(project.commercial_completed_on ?? todayYmd());
          }}
          onDay={setCommercialCompletedOn}
        />
      </Section>

      {/* Keyed by enquiry so each edit starts with fresh choices. */}
      <EnquiryVersionSection
        key={project.id}
        step={2}
        project={project}
        hasUnsavedChanges={unsaved}
        onBusyChange={setCreatingVersion}
        onCreated={onVersionCreated}
      />

      <Section step={3} title="Client" subtitle="Pick a client to replace these details, or edit them">
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
