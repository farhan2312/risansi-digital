"use client";

import { useState } from "react";
import "./EditPasswordModal.css";
import { changePassword } from "../../services/authService";

interface EditPasswordModalProps {
  onClose: () => void;
}

const MIN_PASSWORD_LENGTH = 6;

const errorMessage = (err: unknown, fallback: string): string => {
  const response = (err as { response?: { data?: { error?: string } } })
    ?.response;
  return response?.data?.error ?? fallback;
};

const EditPasswordModal = ({ onClose }: EditPasswordModalProps) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [errors, setErrors] = useState<{
    current?: string;
    newPass?: string;
    confirm?: string;
  }>({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    const nextErrors: typeof errors = {};

    if (!currentPassword) {
      nextErrors.current = "Current password is required.";
    }

    if (!newPassword) {
      nextErrors.newPass = "New password is required.";
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      nextErrors.newPass = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (newPassword === currentPassword) {
      nextErrors.newPass =
        "New password must be different from the current password.";
    }

    if (!confirmPassword) {
      nextErrors.confirm = "Please confirm your new password.";
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
      await changePassword(currentPassword, newPassword);
      setSuccessMessage("Password updated successfully.");
      setCurrentPassword("");
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
        aria-labelledby="edit-password-title"
      >
        <div className="settings-modal-header">
          <h3 id="edit-password-title">Change Password</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
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

          <label htmlFor="current-password">Current Password</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              if (errors.current) setErrors((p) => ({ ...p, current: undefined }));
            }}
          />
          {errors.current && <span className="error-text">{errors.current}</span>}

          <label htmlFor="new-password">New Password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (errors.newPass) setErrors((p) => ({ ...p, newPass: undefined }));
            }}
          />
          {errors.newPass && <span className="error-text">{errors.newPass}</span>}

          <label htmlFor="confirm-password">Confirm New Password</label>
          <input
            id="confirm-password"
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
              {isSubmitting ? "Updating..." : "Update Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditPasswordModal;
