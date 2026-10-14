"use client";

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { changePassword } from "@/app/risansi/actions";

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function update(key: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const result = await changePassword(values);
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
  }

  const inputClass =
    "h-11 w-full rounded-[10px] border border-input-border bg-surface px-[15px] text-[14px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
  const labelClass =
    "mb-1.5 block text-[13px] font-semibold text-brand-label";

  // Rendered on <body>: opened from the sticky sidebar, it would otherwise sit
  // inside the sidebar's stacking context, under the page header and filters.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        {done ? (
          <div className="py-4 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Password updated
            </h2>
            <p className="mt-1 text-sm text-muted">
              Your password has been changed successfully.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 h-11 w-full rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="mb-1 font-display text-lg font-semibold text-foreground">
              Change password
            </h2>
            <p className="mb-5 text-sm text-muted">
              Enter your current password and choose a new one.
            </p>

            <form onSubmit={handleSubmit}>
              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger"
                >
                  {error}
                </div>
              )}

              <label className={labelClass} htmlFor="currentPassword">
                Current password
              </label>
              <div className="mb-4">
                <input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={values.currentPassword}
                  onChange={(e) => update("currentPassword", e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </div>

              <label className={labelClass} htmlFor="newPassword">
                New password
              </label>
              <div className="mb-4">
                <input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={values.newPassword}
                  onChange={(e) => update("newPassword", e.target.value)}
                  className={inputClass}
                  placeholder="At least 6 characters"
                />
              </div>

              <label className={labelClass} htmlFor="confirmPassword">
                Confirm new password
              </label>
              <div className="mb-6">
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={values.confirmPassword}
                  onChange={(e) => update("confirmPassword", e.target.value)}
                  className={inputClass}
                  placeholder="Re-enter new password"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 flex-1 rounded-[10px] border border-input-border bg-surface text-sm font-medium text-foreground transition-colors hover:bg-background"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? "Saving..." : "Update password"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
