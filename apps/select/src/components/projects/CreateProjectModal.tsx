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
import { listAssignees, type Assignee, type CreateProjectInput } from "../../services/projectService";
import { roleLabel, type OrderSubtype, type OrderType } from "../../lib/roles";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves to an error message to show inline, or null on success. */
  onCreate: (project: CreateProjectInput) => Promise<string | null>;
};

// House prefix for enquiry numbers: RIL/EN/<indian-fiscal-year>/<suffix>.
// Indian fiscal year runs April to March, so Aug 2026 sits in FY 26-27, and
// Jan/Feb/Mar 2027 still sits there too (only Apr 2027 rolls to 27-28).
export function enquiryPrefix(now: Date = new Date()): string {
  const start = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return `RIL/EN/${yy(start)}-${yy(start + 1)}/`;
}

/** Today as YYYY-MM-DD in the user's own time zone. */
export const todayYmd = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CreateEnquiryForm = ({ onClose, onCreate }: Omit<Props, "isOpen">) => {
  const [enquiryNo, setEnquiryNo] = useState<string>(() => enquiryPrefix());
  const [enquiryDate, setEnquiryDate] = useState(() => todayYmd());
  const [orderType, setOrderType] = useState<OrderType>("pump");
  const [orderSubtype, setOrderSubtype] = useState<OrderSubtype>("pcp");
  const [client, setClient] = useState<ClientForm>(EMPTY_CLIENT);
  // Who works the enquiry: a worker, or the master herself.
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [assignedTo, setAssignedTo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAssignees()
      .then(setAssignees)
      .catch(() => setAssignees([]));
  }, []);

  const currentPrefix = enquiryPrefix();

  const handleCreate = async () => {
    if (saving) return;
    const trimmed = enquiryNo.trim();
    if (!trimmed) {
      setError("Enquiry no. is required.");
      return;
    }
    // Reject just-the-prefix - the suffix identifies the actual enquiry.
    if (trimmed === currentPrefix.trim() || trimmed === currentPrefix.slice(0, -1)) {
      setError("Add an enquiry suffix after the prefix.");
      return;
    }
    if (!enquiryDate) {
      setError("Enquiry date is required.");
      return;
    }
    if (!assignedTo) {
      setError("Pick who the enquiry is assigned to.");
      return;
    }
    setError("");
    setSaving(true);
    const msg = await onCreate({
      projectCode: trimmed,
      enquiryDate,
      orderType,
      orderSubtype,
      assignedTo,
      ...client,
    });
    setSaving(false);
    // A message means it failed (e.g. duplicate Enquiry no.); keep the modal
    // open so the user can fix it. null means success - the parent closes it.
    if (msg) setError(msg);
  };

  return (
    <ModalShell
      title="Create New Enquiry"
      subtitle="Enquiry details, the client, and who works on it"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p className="mr-auto text-[12.5px] font-medium text-neg" role="alert">
              {error}
            </p>
          )}
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create Enquiry"}
          </button>
        </>
      }
    >
      <Section step={1} title="Enquiry" subtitle="Order type, number and date received">
        <Field label="Order type" required wide group>
          <OrderTypePicker
            value={orderType}
            subtype={orderSubtype}
            onChange={(t, s) => {
              setOrderType(t);
              setOrderSubtype(s);
            }}
          />
        </Field>
        <Field label="Enquiry no." required hint="Prefilled with this fiscal year's prefix - type the suffix after the last slash.">
          <input
            className={`${inputCls} font-mono`}
            value={enquiryNo}
            autoFocus
            placeholder={`${currentPrefix}001`}
            onFocus={(e) => {
              // Drop the caret at the end so the user types the suffix
              // without having to click past the prefix themselves.
              const el = e.currentTarget;
              requestAnimationFrame(() => {
                try {
                  el.setSelectionRange(el.value.length, el.value.length);
                } catch {
                  // setSelectionRange is unsupported on some input types;
                  // the field still accepts input, so ignore silently.
                }
              });
            }}
            onChange={(e) => setEnquiryNo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
        </Field>
        <Field label="Enquiry date" required hint="The date the enquiry was received.">
          <input type="date" className={inputCls} value={enquiryDate} max={todayYmd()} onChange={(e) => setEnquiryDate(e.target.value)} />
        </Field>
      </Section>

      <Section step={2} title="Client" subtitle="Pick from the client master to fill everything, or type it in">
        <ClientFields value={client} onChange={setClient} />
      </Section>

      <Section step={3} title="Assignment" subtitle="Who works on this enquiry">
        <Field
          label="Assign to"
          required
          wide
          hint="Only the person it is assigned to (and the User-Master) can work on it. Everyone can still view it. You can reassign it later."
        >
          <select className={inputCls} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={assignees === null}>
            <option value="">{assignees === null ? "Loading…" : "Select who works on this enquiry"}</option>
            {(assignees ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.is_me ? `Me (${a.name || a.email})` : `${a.name || a.email} · ${roleLabel(a.role)}`}
              </option>
            ))}
          </select>
        </Field>
      </Section>
    </ModalShell>
  );
};

// The form is mounted only while open, so every open starts blank: nothing
// carries over from the last enquiry, created or cancelled.
const CreateProjectModal = ({ isOpen, ...form }: Props) => (isOpen ? <CreateEnquiryForm {...form} /> : null);

export default CreateProjectModal;
