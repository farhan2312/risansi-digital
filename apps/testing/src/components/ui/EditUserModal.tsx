"use client";

import { useState } from "react";
import { updateUserDetails, type PendingUser } from "@/services/adminService";

interface EditUserModalProps {
  user: PendingUser;
  onClose: () => void;
  onSaved: (user: PendingUser) => void;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@risansi\.com$/;
const ROLES = ["source", "testing", "central-admin", "admin"] as const;

const errorMessage = (err: unknown, fallback: string): string => {
  const response = (err as { response?: { data?: { error?: string } } })?.response;
  return response?.data?.error ?? fallback;
};

const inputClasses =
  "h-11 w-full rounded-lg border border-border bg-bg-app px-3.5 text-[15px] text-text-h outline-none focus:border-accent focus:ring-2 focus:ring-accent-line";
const labelClasses = "mt-3.5 mb-1.5 block text-[13px] font-semibold text-text";

const EditUserModal = ({ user, onClose, onSaved }: EditUserModalProps) => {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<string>(user.role);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    const next: Record<string, string> = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) next.name = "Name is required.";
    if (!trimmedEmail) next.email = "Email is required.";
    else if (!EMAIL_REGEX.test(trimmedEmail)) next.email = "Please enter a valid @risansi.com email.";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const updated = await updateUserDetails(user.id, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: role as (typeof ROLES)[number],
      });
      onSaved(updated);
    } catch (err) {
      setFormError(errorMessage(err, "Could not update this user."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[420px] max-w-[92vw] rounded-2xl bg-surface p-6 pb-6.5 text-text shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-title"
      >
        <div className="mb-4.5 flex items-center justify-between">
          <h3 id="edit-user-title" className="m-0 text-xl text-text-h">
            Edit User
          </h3>
          <button type="button" className="border-none bg-none text-base text-text-muted" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="mb-1.5 rounded-md border border-neg bg-neg-soft px-3.5 py-2.5 text-[13px] text-neg-strong" role="alert">
              {formError}
            </div>
          )}

          <label htmlFor="edit-user-name" className={labelClasses}>
            Name
          </label>
          <input
            id="edit-user-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((p) => ({ ...p, name: "" }));
            }}
            className={inputClasses}
          />
          {errors.name && <span className="mt-1.5 block text-[13px] text-neg">{errors.name}</span>}

          <label htmlFor="edit-user-email" className={labelClasses}>
            Email
          </label>
          <input
            id="edit-user-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((p) => ({ ...p, email: "" }));
            }}
            className={inputClasses}
          />
          {errors.email && <span className="mt-1.5 block text-[13px] text-neg">{errors.email}</span>}

          <label htmlFor="edit-user-role" className={labelClasses}>
            Role
          </label>
          <select
            id="edit-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={`${inputClasses} capitalize`}
          >
            {!(ROLES as readonly string[]).includes(role) && (
              <option value={role}>{role} (unassigned)</option>
            )}
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-[42px] rounded-lg bg-surface-hover px-5 text-sm font-semibold text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-[42px] rounded-lg bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditUserModal;
