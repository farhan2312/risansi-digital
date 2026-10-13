"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import Image from "next/image";
import logo from "@/assets/logo.png";
import { forceSetPassword } from "@/app/set-password/actions";
import { logout } from "@/app/risansi/actions";

export function SetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const result = await forceSetPassword({ newPassword, confirmPassword });
    if (!result.ok) {
      setIsSubmitting(false);
      setError(result.error);
      return;
    }
    router.replace("/risansi/dashboard");
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-input-border bg-surface pl-11 pr-12 text-[14px] text-foreground placeholder:text-muted-foreground transition-shadow focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10";

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-4 flex justify-center">
        <Image
          src={logo}
          alt="Risansi"
          width={190}
          height={95}
          priority
          className="h-auto w-[150px]"
        />
      </div>

      <div className="mb-6 text-center">
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-foreground">
          Set a new password
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          For your security, choose a new password before continuing.
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Signed in as {email}
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger"
          >
            {error}
          </div>
        )}

        <label
          htmlFor="new-password"
          className="mb-1.5 block text-[13px] font-semibold text-brand-label"
        >
          New password
        </label>
        <div className="mb-4">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              id="new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              placeholder="At least 6 characters"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-brand-label"
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <label
          htmlFor="confirm-password"
          className="mb-1.5 block text-[13px] font-semibold text-brand-label"
        >
          Confirm new password
        </label>
        <div className="mb-6">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              id="confirm-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              placeholder="Re-enter your new password"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-display text-[15px] font-semibold tracking-[0.01em] text-primary-foreground shadow-[0_10px_24px_-6px_rgba(26,95,208,0.5)] transition-all hover:bg-primary-hover hover:shadow-[0_12px_28px_-6px_rgba(26,95,208,0.55)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              Save &amp; continue
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      <form action={logout} className="mt-5 text-center">
        <button
          type="submit"
          className="text-[13.5px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
