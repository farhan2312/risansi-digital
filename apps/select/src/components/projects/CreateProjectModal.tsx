"use client";

import { useEffect, useState } from "react";
import "./CreateProjectModal.css";
import ClientLookup from "./ClientLookup";
import {
  ClientDetailsFields,
  EMPTY_CLIENT_DETAILS,
  OrderTypePicker,
  clientDetailsOf,
  type ClientDetails,
} from "./EnquiryFields";
import type { ClientLookupRow } from "../../services/clientsService";
import { listAssignees, type Assignee } from "../../services/projectService";
import { roleLabel, type OrderType } from "../../lib/roles";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves to an error message to show inline, or null on success. */
  onCreate: (project: {
    projectCode: string;
    name: string;
    clientCode: string;
    industry: string;
    enquiryDate: string;
    orderType: OrderType;
    assignedTo: string;
  } & ClientDetails) => Promise<string | null>;
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

const CreateProjectModal = ({ isOpen, onClose, onCreate }: Props) => {
  const [enquiryNo, setEnquiryNo] = useState<string>(() => enquiryPrefix());
  const [clientName, setClientName] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [industry, setIndustry] = useState("");
  const [enquiryDate, setEnquiryDate] = useState(() => todayYmd());
  const [orderType, setOrderType] = useState<OrderType>("pump");
  const [details, setDetails] = useState<ClientDetails>(EMPTY_CLIENT_DETAILS);
  // Who works the enquiry: a worker, or the master herself.
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [assignedTo, setAssignedTo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Refresh the prefix each time the modal opens - covers the rare Apr-1
  // rollover mid-session, and resets the field after a cancelled attempt.
  // If the user is mid-edit with a value that extends the prefix, keep it.
  useEffect(() => {
    if (!isOpen) return;
    const fresh = enquiryPrefix();
    setEnquiryNo((v) => (v && v.startsWith(fresh) ? v : fresh));
    setEnquiryDate((v) => v || todayYmd());
    setError("");
    listAssignees()
      .then(setAssignees)
      .catch(() => setAssignees([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const currentPrefix = enquiryPrefix();

  const handleSelect = (row: ClientLookupRow) => {
    setClientCode(row.code);
    setClientName(row.legal_name);
    setIndustry(row.industry ?? "");
    setDetails(clientDetailsOf(row));
    setError("");
  };

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
      name: clientName,
      clientCode,
      industry,
      enquiryDate,
      orderType,
      assignedTo,
      ...details,
    });
    setSaving(false);
    // A message means it failed (e.g. duplicate Enquiry no.); keep the modal
    // open so the user can fix it. null means success - the parent closes it.
    if (msg) setError(msg);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Create New Enquiry</h2>

        <div className="modal-form max-h-[calc(100vh-180px)] overflow-y-auto pb-4">
          <div className="form-group">
            <label>Order type *</label>
            <OrderTypePicker value={orderType} onChange={setOrderType} />
          </div>

          <div className="form-group">
            <label>Enquiry no. *</label>
            <input
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
            <p className="modal-hint">
              Prefilled with the current fiscal-year prefix. Type the suffix
              after the trailing slash - the full string is what gets saved.
            </p>
          </div>

          <div className="form-group">
            <label>Enquiry date *</label>
            <input
              type="date"
              value={enquiryDate}
              max={todayYmd()}
              onChange={(e) => setEnquiryDate(e.target.value)}
            />
            <p className="modal-hint">The date the enquiry was received. Defaults to today.</p>
          </div>

          <div className="form-group">
            <label>Assign to *</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={assignees === null}>
              <option value="">{assignees === null ? "Loading…" : "Select who works this enquiry"}</option>
              {(assignees ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.is_me ? `Me (${a.name || a.email})` : `${a.name || a.email} · ${roleLabel(a.role)}`}
                </option>
              ))}
            </select>
            <p className="modal-hint">Only the person it is assigned to (and the User-Master) sees it. You can reassign it later.</p>
          </div>

          <ClientLookup active={isOpen} onSelect={handleSelect} />

          <div className="form-group">
            <label>Client Name</label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Client code</label>
            <input
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Industry</label>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>

          <ClientDetailsFields value={details} />
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="cancel-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>

          <button className="create-btn" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create Enquiry"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateProjectModal;
