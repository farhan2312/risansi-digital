"use client";

import { useState } from "react";
import "./EditPasswordModal.css";
import { setUserPassword } from "@/services/adminService";

interface AdminSetPasswordModalProps {
  userId: string;
  userLabel: string;
  onClose: () => void;
}

const MIN_PASSWORD_LENGTH = 6;

const errorMessage = (err: unknown, fallback: string): string => {
  const response = (err as { response?: { data?: { error?: string } } })?.response;
  return response?.data?.error ?? fallback;
};

const AdminSetPasswordModal = ({ userId, userLabel, onClose }: AdminSetPasswordModalProps) => {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [errors, setErrors] = useState<{ newPass?: string; confirm?: string }>({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    const nextErrors: typeof errors = {};

    if (!newPassword) {
      nextErrors.newPass = "New password is required.";
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      nextErrors.newPass = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (!confirmPassword) {
      nextErrors.confirm = "Please confirm the new password.";
    } else if (confirmPassword !== newPassword) {
      nextErrors.confirm = "Passwords do not match.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSuccessMessage("");

    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await setUserPassword(userId, newPassword);
      setSuccessMessage("Password updated successfully.");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setFormError(errorMessage(err, "Could not update password."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-set-password-title"
      >
        <div className="settings-modal-header">
          <h3 id="admin-set-password-title">Set Password — {userLabel}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="modal-form-error" role="alert">
              {formError}
            </div>
          )}
          {successMessage && (
            <div className="modal-form-success" role="status">
              {successMessage}
            </div>
          )}

          <label htmlFor="admin-new-password">New Password</label>
          <input
            id="admin-new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (errors.newPass) setErrors((p) => ({ ...p, newPass: undefined }));
            }}
          />
          {errors.newPass && <span className="error-text">{errors.newPass}</span>}

          <label htmlFor="admin-confirm-password">Confirm New Password</label>
          <input
            id="admin-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
            }}
          />
          {errors.confirm && <span className="error-text">{errors.confirm}</span>}

          <div className="settings-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Updating..." : "Set Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminSetPasswordModal;
