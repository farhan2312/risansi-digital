"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Eye, EyeOff, Loader2, Lock, Mail, X } from "lucide-react";
// (Remember me / Forgot password removed — a session cookie + admin-managed
// password resets cover the flow.)
import { login } from "@/app/login/actions";
import Image from "next/image";
import logo from "@/assets/logo.png";

type FieldErrors = {
  email?: string;
  password?: string;
};

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return "Email is required.";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(value)) return "Enter a valid email address.";
  return undefined;
}

function validatePassword(value: string): string | undefined {
  if (!value) return "Password is required.";
  if (value.length < 6) return "Password must be at least 6 characters.";
  return undefined;
}

export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNotice, setShowNotice] = useState(Boolean(notice));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    setFormError(null);

    if (nextErrors.email || nextErrors.password) return;

    setIsSubmitting(true);
    const result = await login({ email, password });

    if (!result.ok) {
      setIsSubmitting(false);
      setFormError(result.error);
      return;
    }

    router.replace(result.redirectTo);
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-input-border bg-surface pl-11 pr-4 text-[14px] text-foreground placeholder:text-muted-foreground transition-shadow focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10";

  return (
    <div className="w-full max-w-[400px]">
      {/* logo — centered, matching the brand panel */}
      <div className="mb-4 flex justify-center [@media(min-height:880px)]:mb-5">
        <Image
          src={logo}
          alt="Risansi"
          width={190}
          height={95}
          priority
          className="h-auto w-[150px] [@media(min-height:880px)]:w-[175px]"
        />
      </div>

      <div className="mb-5 text-center [@media(min-height:880px)]:mb-6">
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-foreground">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-muted">
          Sign in to continue to the Risansi platform.
        </p>
      </div>

      {showNotice && notice && (
        <div
          role="status"
          className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setShowNotice(false)}
            aria-label="Dismiss"
            className="text-emerald-600 hover:text-emerald-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <form noValidate onSubmit={handleSubmit}>
        {formError && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger"
          >
            {formError}
          </div>
        )}

        {/* email */}
        <label
          htmlFor="email"
          className="mb-1.5 block text-[13px] font-semibold text-brand-label"
        >
          Email address
        </label>
        <div className="mb-4">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              className={inputClass}
              placeholder="name@risansi.com"
            />
          </div>
          {errors.email && (
            <p id="email-error" className="mt-1.5 text-xs text-danger">
              {errors.email}
            </p>
          )}
        </div>

        {/* password */}
        <label
          htmlFor="password"
          className="mb-1.5 block text-[13px] font-semibold text-brand-label"
        >
          Password
        </label>
        <div className="mb-6">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-error" : undefined}
              className={`${inputClass} pr-12`}
              placeholder="Enter your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-brand-label"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          {errors.password && (
            <p id="password-error" className="mt-1.5 text-xs text-danger">
              {errors.password}
            </p>
          )}
        </div>

        {/* submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-display text-[15px] font-semibold tracking-[0.01em] text-primary-foreground shadow-[0_10px_24px_-6px_rgba(26,95,208,0.5)] transition-all hover:bg-primary-hover hover:shadow-[0_12px_28px_-6px_rgba(26,95,208,0.55)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-[13.5px] text-muted">
        Need access?{" "}
        <a href="/signup" className="font-semibold text-primary hover:text-primary-hover">
          Request Access
        </a>
      </p>
      <p className="mt-3.5 text-center text-[11.5px] text-muted-foreground">
        Risansi Industries Ltd · Internal use only
      </p>
    </div>
  );
}
