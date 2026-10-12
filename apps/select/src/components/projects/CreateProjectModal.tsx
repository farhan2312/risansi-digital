"use client";

import { useEffect, useState } from "react";
import "./CreateProjectModal.css";
import ClientLookup from "./ClientLookup";
import type { ClientLookupRow } from "../../services/clientsService";

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
  }) => Promise<string | null>;
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
  }, [isOpen]);

  if (!isOpen) return null;

  const currentPrefix = enquiryPrefix();

  const handleSelect = (row: ClientLookupRow) => {
    setClientCode(row.code);
    setClientName(row.legal_name);
    setIndustry(row.industry ?? "");
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
    setError("");
    setSaving(true);
    const msg = await onCreate({
      projectCode: trimmed,
      name: clientName,
      clientCode,
      industry,
      enquiryDate,
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

        <div className="modal-form">
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
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="cancel-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>

          <button className="create-btn" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateProjectModal;
