"use client";

import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import "./LoginPage.css";
import BrandingPanel from "./BrandingPanel";
import { login, requestAccess } from "@/services/authService";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@risansi\.com$/;
const MIN_PASSWORD_LENGTH = 6;

type Mode = "login" | "request";

const errorMessage = (err: unknown, fallback: string): string => {
  const response = (err as { response?: { data?: { error?: string } } })?.response;
  return response?.data?.error ?? fallback;
};

// ---- Icons (inline, stroke = currentColor, so they follow the theme) ----

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const MailIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
);
const LockIcon = () => (
  <svg {...iconProps}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);
const UserIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c.8-3.6 3.7-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
  </svg>
);
const UsersIcon = () => (
  <svg {...iconProps}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 19.5c.7-3.2 3.1-5 6.5-5s5.8 1.8 6.5 5" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.6 3.1 2.3 3.5 4.7" />
  </svg>
);
const EyeIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg {...iconProps}>
    <path d="M3 3l18 18M10.6 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.5 7.2A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);
const ArrowIcon = () => (
  <svg {...iconProps} width={16} height={16} strokeWidth={2.2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const CheckIcon = () => (
  <svg {...iconProps} width={16} height={16} strokeWidth={2.6}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
const CapsIcon = () => (
  <svg {...iconProps} width={14} height={14} strokeWidth={2.2}>
    <path d="M12 4 5 12h4v4h6v-4h4L12 4ZM9 20h6" />
  </svg>
);

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];

/** Advisory only -- the real rule is the minimum length. 0 = empty, 1..4 = weak..strong. */
const passwordStrength = (pw: string): number => {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.max(1, score);
};

const StrengthMeter = ({ password }: { password: string }) => {
  const level = passwordStrength(password);
  if (!level) return null;
  return (
    <div className={`login-strength level-${level}`} aria-live="polite">
      <span className="login-strength-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= level ? "on" : undefined} />
        ))}
      </span>
      <span className="login-strength-label">{STRENGTH_LABELS[level]}</span>
    </div>
  );
};

/** Label + an input well with a leading icon (and optional trailing control), plus its error. */
const Field = ({
  id,
  label,
  icon,
  error,
  trailing,
  hint,
  children,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  error?: string;
  trailing?: ReactNode;
  /** Extra line under the field (strength meter, Caps Lock notice). */
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <div className="login-field">
    <label htmlFor={id}>{label}</label>
    <div className={`login-input-wrap${error ? " has-error" : ""}`}>
      <span className="login-input-icon">{icon}</span>
      {children}
      {trailing}
    </div>
    {error && (
      <span className="login-field-error" role="alert">
        {error}
      </span>
    )}
    {hint}
  </div>
);

const LoginPage = () => {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"source" | "testing">("testing");

  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [nameError, setNameError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [canTilt, setCanTilt] = useState(false);

  // Tilt only for a real mouse and only if the person hasn't asked for less motion.
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setCanTilt(fine.matches && !calm.matches);
    update();
    fine.addEventListener("change", update);
    calm.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      calm.removeEventListener("change", update);
    };
  }, []);

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsOn(e.getModifierState("CapsLock"));

  const handleTilt = (e: MouseEvent<HTMLElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // The sheen always follows the cursor; the card itself holds still while you type.
    card.style.setProperty("--gx", `${x * 100}%`);
    card.style.setProperty("--gy", `${y * 100}%`);
    if (!canTilt || card.matches(":focus-within")) return;
    card.style.setProperty("--rx", `${((0.5 - y) * 5).toFixed(2)}deg`);
    card.style.setProperty("--ry", `${((x - 0.5) * 6).toFixed(2)}deg`);
  };

  const resetTilt = (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty("--rx", "0deg");
    e.currentTarget.style.setProperty("--ry", "0deg");
  };

  const emailValid = EMAIL_REGEX.test(email.trim());
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  const capsNotice = capsOn ? (
    <span className="login-caps" role="status">
      <CapsIcon /> Caps Lock is on
    </span>
  ) : null;

  const validTick = <span className="login-valid" title="Looks good"><CheckIcon /></span>;

  const switchMode = (next: Mode) => {
    setMode(next);
    setEmailError("");
    setPasswordError("");
    setNameError("");
    setConfirmPasswordError("");
    setFormError("");
    setFormSuccess("");
  };

  const validateCommon = () => {
    let valid = true;
    const trimmedEmail = email.trim();

    setEmailError("");
    setPasswordError("");
    setFormError("");

    if (!trimmedEmail) {
      setEmailError("Email is required.");
      valid = false;
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError("Please enter a valid @risansi.com email.");
      valid = false;
    }

    if (!password) {
      setPasswordError("Password is required.");
      valid = false;
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      valid = false;
    }

    return valid;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validateCommon()) return;

    setIsSubmitting(true);
    try {
      // Login sets the auth cookie server-side; AuthProvider fetches the
      // verified session itself once we land inside the (dashboard) route
      // group, so there's nothing to stash here.
      await login(email.trim(), password);
      router.push("/overview");
    } catch (err) {
      setFormError(errorMessage(err, "Unable to sign in. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    let valid = validateCommon();
    setNameError("");
    setConfirmPasswordError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name is required.");
      valid = false;
    }
    if (confirmPassword !== password) {
      setConfirmPasswordError("Passwords do not match.");
      valid = false;
    }
    if (!valid) return;

    setIsSubmitting(true);
    try {
      await requestAccess(trimmedName, email.trim(), password, role);
      setFormSuccess("Request submitted — an admin will approve your account before you can sign in.");
      setName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setRole("testing");
      setMode("login");
    } catch (err) {
      setFormError(errorMessage(err, "Unable to submit your request. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearOnType = (clear: () => void) => {
    clear();
    if (formError) setFormError("");
  };

  return (
    <div className="login-page">
      <BrandingPanel />

      <div className="login-form-container">
      <main className="login-card" onMouseMove={handleTilt} onMouseLeave={resetTilt}>
        <img src="/logo.png" alt="Risansi Industries" className="login-logo" />

        {formSuccess && (
          <div className="login-success" role="status">
            {formSuccess}
          </div>
        )}

        {mode === "login" ? (
          <form key="login" className="login-form-swap" onSubmit={handleLogin} noValidate>
            <h1 className="login-title">Welcome back</h1>
            <p className="login-subtitle">Log in with your company credentials</p>

            {formError && (
              <div className="login-error" role="alert">
                {formError}
              </div>
            )}

            <Field id="email" label="Company Email" icon={<MailIcon />} error={emailError} trailing={emailValid ? validTick : undefined}>
              <input
                id="email"
                type="email"
                placeholder="you@risansi.com"
                value={email}
                autoComplete="username"
                aria-invalid={!!emailError}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearOnType(() => emailError && setEmailError(""));
                }}
              />
            </Field>

            <Field
              id="password"
              label="Password"
              icon={<LockIcon />}
              error={passwordError}
              hint={capsNotice}
              trailing={
                <button
                  type="button"
                  className="login-eye"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              }
            >
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                autoComplete="current-password"
                onKeyDown={trackCaps}
                onKeyUp={trackCaps}
                onBlur={() => setCapsOn(false)}
                aria-invalid={!!passwordError}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearOnType(() => passwordError && setPasswordError(""));
                }}
              />
            </Field>

            <button type="submit" className="login-submit" disabled={isSubmitting}>
              <span>{isSubmitting ? "Signing in…" : "Sign In"}</span>
              <span className="login-submit-arrow" aria-hidden="true">
                {isSubmitting ? <span className="login-spinner" /> : <ArrowIcon />}
              </span>
            </button>
          </form>
        ) : (
          <form key="request" className="login-form-swap" onSubmit={handleRequestAccess} noValidate>
            <h1 className="login-title">Request access</h1>
            <p className="login-subtitle">Submit your details — an admin will review and approve you</p>

            {formError && (
              <div className="login-error" role="alert">
                {formError}
              </div>
            )}

            <Field id="name" label="Full Name" icon={<UserIcon />} error={nameError}>
              <input
                id="name"
                type="text"
                placeholder="Jane Doe"
                value={name}
                autoComplete="name"
                aria-invalid={!!nameError}
                onChange={(e) => {
                  setName(e.target.value);
                  clearOnType(() => nameError && setNameError(""));
                }}
              />
            </Field>

            <Field id="request-role" label="Role" icon={<UsersIcon />}>
              <select id="request-role" value={role} onChange={(e) => setRole(e.target.value as "source" | "testing")}>
                <option value="testing">Testing Team</option>
                <option value="source">Source Team</option>
              </select>
            </Field>

            <Field id="request-email" label="Company Email" icon={<MailIcon />} error={emailError} trailing={emailValid ? validTick : undefined}>
              <input
                id="request-email"
                type="email"
                placeholder="you@risansi.com"
                value={email}
                autoComplete="username"
                aria-invalid={!!emailError}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearOnType(() => emailError && setEmailError(""));
                }}
              />
            </Field>

            <Field
              id="request-password"
              label="Password"
              icon={<LockIcon />}
              error={passwordError}
              hint={
                <>
                  {capsNotice}
                  <StrengthMeter password={password} />
                </>
              }
            >
              <input
                id="request-password"
                type="password"
                onKeyDown={trackCaps}
                onKeyUp={trackCaps}
                onBlur={() => setCapsOn(false)}
                placeholder="Password"
                value={password}
                autoComplete="new-password"
                aria-invalid={!!passwordError}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearOnType(() => passwordError && setPasswordError(""));
                }}
              />
            </Field>

            <Field id="confirm-password" label="Confirm Password" icon={<LockIcon />} error={confirmPasswordError} trailing={passwordsMatch ? validTick : undefined}>
              <input
                id="confirm-password"
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                autoComplete="new-password"
                aria-invalid={!!confirmPasswordError}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  clearOnType(() => confirmPasswordError && setConfirmPasswordError(""));
                }}
              />
            </Field>

            <button type="submit" className="login-submit" disabled={isSubmitting}>
              <span>{isSubmitting ? "Submitting…" : "Request Access"}</span>
              <span className="login-submit-arrow" aria-hidden="true">
                {isSubmitting ? <span className="login-spinner" /> : <ArrowIcon />}
              </span>
            </button>
          </form>
        )}

        <p className="login-switch">
          {mode === "login" ? (
            <>
              Need access?{" "}
              <button type="button" onClick={() => switchMode("request")}>
                Request Access
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")}>
                Sign In
              </button>
            </>
          )}
        </p>
      </main>
      </div>
    </div>
  );
};

export default LoginPage;
