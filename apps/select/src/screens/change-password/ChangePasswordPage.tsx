"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "../login/LoginPage.css";
import "./ChangePasswordPage.css";
import { changePassword } from "../../services/authService";

const MIN_PASSWORD_LENGTH = 6;

const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  fallback;

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M10.6 6.1A8.5 8.5 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.8 3.4M6.3 7.9A16.8 16.8 0 0 0 2.5 12S6 18 12 18c1.5 0 2.8-.4 4-.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

/**
 * Forced password change. Users whose password was issued/reset by an admin
 * land here and can't reach the rest of the app until they set their own (the
 * gate itself lives in middleware.ts). There's deliberately no "skip" — the
 * only way out is a successful change or logging out.
 */
const ChangePasswordPage = () => {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [currentError, setCurrentError] = useState("");
  const [newError, setNewError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    let valid = true;
    setCurrentError("");
    setNewError("");
    setConfirmError("");
    setFormError("");

    if (!currentPassword) {
      setCurrentError("Enter your current password.");
      valid = false;
    }
    if (!newPassword) {
      setNewError("Choose a new password.");
      valid = false;
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setNewError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      valid = false;
    } else if (newPassword === currentPassword) {
      setNewError("New password must be different from your current one.");
      valid = false;
    }
    if (confirmPassword !== newPassword) {
      setConfirmError("Passwords do not match.");
      valid = false;
    }
    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      // The API clears must_change_password and re-issues the session cookie,
      // so the middleware gate opens on the very next request.
      await changePassword(currentPassword, newPassword);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't update your password. Please try again."));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cp-page">
      <div className="login-card cp-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Risansi Industries" className="form-logo" />

        <form onSubmit={handleSubmit} noValidate>
          <h2>Set a new password</h2>
          <p>
            Your password was issued by an administrator. Choose your own to
            continue.
          </p>

          <div className="card-divider" aria-hidden="true">
            <span className="card-divider-badge">
              <LockIcon />
            </span>
          </div>

          {formError && (
            <div className="form-error" role="alert">
              {formError}
            </div>
          )}

          <label htmlFor="cp-current">Current Password</label>
          <div className="input-icon input-icon-password">
            <LockIcon />
            <input
              id="cp-current"
              type={showPassword ? "text" : "password"}
              placeholder="Current password"
              value={currentPassword}
              autoComplete="current-password"
              aria-invalid={!!currentError}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                if (currentError) setCurrentError("");
                if (formError) setFormError("");
              }}
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide passwords" : "Show passwords"}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {currentError && (
            <span className="error-text" role="alert">
              {currentError}
            </span>
          )}

          <label htmlFor="cp-new">New Password</label>
          <div className="input-icon">
            <LockIcon />
            <input
              id="cp-new"
              type={showPassword ? "text" : "password"}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              value={newPassword}
              autoComplete="new-password"
              aria-invalid={!!newError}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (newError) setNewError("");
                if (formError) setFormError("");
              }}
            />
          </div>
          {newError && (
            <span className="error-text" role="alert">
              {newError}
            </span>
          )}

          <label htmlFor="cp-confirm">Confirm New Password</label>
          <div className="input-icon">
            <LockIcon />
            <input
              id="cp-confirm"
              type={showPassword ? "text" : "password"}
              placeholder="Re-enter new password"
              value={confirmPassword}
              autoComplete="new-password"
              aria-invalid={!!confirmError}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (confirmError) setConfirmError("");
                if (formError) setFormError("");
              }}
            />
          </div>
          {confirmError && (
            <span className="error-text" role="alert">
              {confirmError}
            </span>
          )}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
