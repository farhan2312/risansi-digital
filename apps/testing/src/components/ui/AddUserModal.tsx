"use client";

import { useState } from "react";
import { createUser, type PendingUser } from "@/services/adminService";

interface AddUserModalProps {
  onClose: () => void;
  onCreated: (user: PendingUser) => void;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@risansi\.com$/;
const MIN_PASSWORD_LENGTH = 6;
const ROLES = ["source", "testing", "central-admin", "admin"] as const;

const errorMessage = (err: unknown, fallback: string): string => {
  const response = (err as { response?: { data?: { error?: string } } })?.response;
  return response?.data?.error ?? fallback;
};

const inputClasses =
  "h-11 w-full rounded-lg border border-border bg-bg-app px-3.5 text-[15px] text-text-h outline-none focus:border-accent focus:ring-2 focus:ring-accent-line";
const labelClasses = "mt-3.5 mb-1.5 block text-[13px] font-semibold text-text";

const AddUserModal = ({ onClose, onCreated }: AddUserModalProps) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("source");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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

    if (!password) next.password = "Password is required.";
    else if (password.length < MIN_PASSWORD_LENGTH)
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

    if (!confirmPassword) next.confirm = "Please confirm the password.";
    else if (confirmPassword !== password) next.confirm = "Passwords do not match.";

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
      const user = await createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
      });
      onCreated(user);
    } catch (err) {
      setFormError(errorMessage(err, "Could not create user."));
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
        aria-labelledby="add-user-title"
      >
        <div className="mb-4.5 flex items-center justify-between">
          <h3 id="add-user-title" className="m-0 text-xl text-text-h">
            Add User
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

          <label htmlFor="add-user-name" className={labelClasses}>
            Name
          </label>
          <input
            id="add-user-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((p) => ({ ...p, name: "" }));
            }}
            className={inputClasses}
          />
          {errors.name && <span className="mt-1.5 block text-[13px] text-neg">{errors.name}</span>}

          <label htmlFor="add-user-email" className={labelClasses}>
            Email
          </label>
          <input
            id="add-user-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((p) => ({ ...p, email: "" }));
            }}
            className={inputClasses}
          />
          {errors.email && <span className="mt-1.5 block text-[13px] text-neg">{errors.email}</span>}

          <label htmlFor="add-user-role" className={labelClasses}>
            Role
          </label>
          <select
            id="add-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            className={`${inputClasses} capitalize`}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <label htmlFor="add-user-password" className={labelClasses}>
            Password
          </label>
          <input
            id="add-user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors((p) => ({ ...p, password: "" }));
            }}
            className={inputClasses}
          />
          {errors.password && <span className="mt-1.5 block text-[13px] text-neg">{errors.password}</span>}

          <label htmlFor="add-user-confirm-password" className={labelClasses}>
            Confirm Password
          </label>
          <input
            id="add-user-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (errors.confirm) setErrors((p) => ({ ...p, confirm: "" }));
            }}
            className={inputClasses}
          />
          {errors.confirm && <span className="mt-1.5 block text-[13px] text-neg">{errors.confirm}</span>}

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
              {isSubmitting ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddUserModal;
