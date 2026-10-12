"use client";

import { useEffect, useState } from "react";
import "./CreateProjectModal.css";
import ClientLookup from "./ClientLookup";
import type { ClientLookupRow } from "../../services/clientsService";
import type { ProjectRecord } from "../../services/projectService";

type Props = {
  isOpen: boolean;
  project: ProjectRecord | null;
  isSaving?: boolean;
  onClose: () => void;
  onSave: (input: {
    name: string;
    clientCode: string;
    industry: string;
    enquiryDate: string;
    status: string;
  }) => void;
};

const STATUS_OPTIONS = ["In Progress", "Completed", "Pending"];

const EditProjectModal = ({ isOpen, project, isSaving, onClose, onSave }: Props) => {
  const [name, setName] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [industry, setIndustry] = useState("");
  const [enquiryDate, setEnquiryDate] = useState("");
  const [status, setStatus] = useState("In Progress");

  // Re-seed the fields whenever a different project is opened for editing.
  useEffect(() => {
    if (!project) return;
    setName(project.name ?? "");
    setClientCode(project.client_code ?? "");
    setIndustry(project.industry ?? "");
    setEnquiryDate(project.enquiry_date ?? "");
    setStatus(project.status ?? "In Progress");
  }, [project]);

  if (!isOpen || !project) return null;

  // Picking a client from the master fills the three client fields (still editable).
  const handleSelect = (row: ClientLookupRow) => {
    setName(row.legal_name);
    setClientCode(row.code);
    setIndustry(row.industry ?? "");
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Edit Enquiry</h2>

        <div className="modal-form">
          <div className="form-group">
            <label>Enquiry date</label>
            <input type="date" value={enquiryDate} onChange={(e) => setEnquiryDate(e.target.value)} />
          </div>

          {/* Keyed by enquiry so each edit starts with an empty search. */}
          <ClientLookup
            key={project.id}
            hint="Searches the client master. Pick a result to replace the client details below."
            onSelect={handleSelect}
          />

          <div className="form-group">
            <label>Client Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
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

          <div className="form-group">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-actions">
          <button className="cancel-btn" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>

          <button
            className="create-btn"
            disabled={isSaving || !name.trim()}
            onClick={() => onSave({ name, clientCode, industry, enquiryDate, status })}
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditProjectModal;
