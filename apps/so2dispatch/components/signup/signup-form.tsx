"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { requestAccess } from "@/app/signup/actions";
import { REQUESTABLE_ROLES, roleLabel } from "@/lib/roles";
import Image from "next/image";
import logo from "@/assets/logo.png";

const ROLES = REQUESTABLE_ROLES.map((value) => ({
  value,
  label: roleLabel(value),
}));

type FieldErrors = {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  role?: string;
};

function validate(values: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.fullName.trim()) errors.fullName = "Full name is required.";

  if (!values.email.trim()) errors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
    errors.email = "Enter a valid email address.";

  if (!values.password) errors.password = "Password is required.";
  else if (values.password.length < 6)
    errors.password = "Password must be at least 6 characters.";

  if (!values.confirmPassword)
    errors.confirmPassword = "Please confirm your password.";
  else if (values.confirmPassword !== values.password)
    errors.confirmPassword = "Passwords do not match.";

  if (!values.role) errors.role = "Please select a role.";

  return errors;
}

export function SignupForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof typeof values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validate(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    const result = await requestAccess(values);

    if (!result.ok) {
      setIsSubmitting(false);
      setFormError(result.error);
      return;
    }

    // Back to login with a "request submitted" alert.
    router.replace("/login?requested=1");
  }

  const inputClass =
    "h-11 w-full rounded-xl border border-input-border bg-surface pl-11 pr-4 text-[14px] text-foreground placeholder:text-muted-foreground transition-shadow focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10";
  const labelClass = "mb-1.5 block text-[13px] font-semibold text-brand-label";
  const iconClass =
    "pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground";

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-3 flex justify-center [@media(min-height:880px)]:mb-4">
        <Image
          src={logo}
          alt="Risansi"
          width={190}
          height={95}
          priority
          className="h-auto w-[140px] [@media(min-height:880px)]:w-[165px]"
        />
      </div>

      <div className="mb-4 text-center [@media(min-height:880px)]:mb-5">
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-foreground">
          Request access
        </h1>
        <p className="mt-1 text-sm text-muted">
          Create your account to join the Risansi platform.
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        {formError && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger"
          >
            {formError}
          </div>
        )}

        {/* full name */}
        <label htmlFor="fullName" className={labelClass}>
          Full name
        </label>
        <div className="mb-3">
          <div className="relative">
            <User className={iconClass} />
            <input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              value={values.fullName}
              onChange={(event) => update("fullName", event.target.value)}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={errors.fullName ? "fullName-error" : undefined}
              className={inputClass}
              placeholder="Full name"
            />
          </div>
          {errors.fullName && (
            <p id="fullName-error" className="mt-1.5 text-xs text-danger">
              {errors.fullName}
            </p>
          )}
        </div>

        {/* email */}
        <label htmlFor="email" className={labelClass}>
          Email address
        </label>
        <div className="mb-3">
          <div className="relative">
            <Mail className={iconClass} />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
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
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <div className="mb-3">
          <div className="relative">
            <Lock className={iconClass} />
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={values.password}
              onChange={(event) => update("password", event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-error" : undefined}
              className={inputClass}
              placeholder="At least 6 characters"
            />
          </div>
          {errors.password && (
            <p id="password-error" className="mt-1.5 text-xs text-danger">
              {errors.password}
            </p>
          )}
        </div>

        {/* confirm password */}
        <label htmlFor="confirmPassword" className={labelClass}>
          Confirm password
        </label>
        <div className="mb-3">
          <div className="relative">
            <Lock className={iconClass} />
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={
                errors.confirmPassword ? "confirmPassword-error" : undefined
              }
              className={inputClass}
              placeholder="Re-enter your password"
            />
          </div>
          {errors.confirmPassword && (
            <p id="confirmPassword-error" className="mt-1.5 text-xs text-danger">
              {errors.confirmPassword}
            </p>
          )}
        </div>

        {/* role */}
        <label htmlFor="role" className={labelClass}>
          Role
        </label>
        <div className="mb-5">
          <div className="relative">
            <Briefcase className={iconClass} />
            <select
              id="role"
              name="role"
              value={values.role}
              onChange={(event) => update("role", event.target.value)}
              aria-invalid={Boolean(errors.role)}
              aria-describedby={errors.role ? "role-error" : undefined}
              className={`${inputClass} cursor-pointer appearance-none pr-11 ${
                values.role ? "" : "text-muted-foreground"
              }`}
            >
              <option value="" disabled className="bg-background">
                Select your role
              </option>
              {ROLES.map((role) => (
                <option key={role.value} value={role.value} className="bg-background text-foreground">
                  {role.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {errors.role && (
            <p id="role-error" className="mt-1.5 text-xs text-danger">
              {errors.role}
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
              Submitting…
            </>
          ) : (
            <>
              Request access
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-[13.5px] text-muted">
        Already have access?{" "}
        <a
          href="/login"
          className="font-semibold text-primary hover:text-primary-hover"
        >
          Sign in
        </a>
      </p>
      <p className="mt-3 text-center text-[11.5px] text-muted-foreground">
        Risansi Industries Ltd · Internal use only
      </p>
    </div>
  );
}
