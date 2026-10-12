"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "./LoginPage.css";
import { login, requestAccess, type RequestableRole } from "../../services/authService";

const ROLE_OPTIONS: { value: RequestableRole; label: string; hint: string }[] = [
  { value: "user", label: "User", hint: "Pump selection & enquiries" },
  { value: "admin", label: "Admin", hint: "Also manages master data" },
];

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@risansi\.com$/;
const MIN_PASSWORD_LENGTH = 6;

type Mode = "login" | "request";

const errorMessage = (err: unknown, fallback: string): string => {
  const response = (err as { response?: { data?: { error?: string } } })
    ?.response;
  return response?.data?.error ?? fallback;
};

// --- Inline icons (stroke = currentColor, so they inherit surrounding color) --

const MailIcon = () => (
  <svg className="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
    <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LockIcon = () => (
  <svg className="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
    <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.4 7 8.9 4.1-1.5 7-4.7 7-8.9V6l-7-2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="m9.2 12 2 2 3.6-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Feature tile icons
const ScreenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7 13.5 10 10l2.5 2 3.5-4.5M9 21h6m-3-4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const DocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M14 3v4h4M9 12h6M9 16h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FEATURES = [
  {
    icon: <ScreenIcon />,
    title: "Model screening",
    desc: "against the full PCP catalogue on capacity, head, viscosity and solids",
  },
  {
    icon: <ShieldIcon />,
    title: "MOC, elastomer & sealing",
    desc: "guidance with AI-assisted material recommendations",
  },
  {
    icon: <GearIcon />,
    title: "Motor & drive selection",
    desc: "V-Belt, gearbox and motor sizing with live price comparison",
  },
  {
    icon: <DocIcon />,
    title: "One spec sheet per enquiry",
    desc: "saved and downloadable as a ready-to-share report",
  },
];

const LoginPage = () => {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [name, setName] = useState("");
  const [requestedRole, setRequestedRole] = useState<RequestableRole>("user");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [nameError, setNameError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sent here because the session ended mid-use (see apiClient / middleware):
  // say so once, then drop the flag so a refresh doesn't repeat it. Read from
  // window rather than useSearchParams, which would need a Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("session") !== "ended") return;
    setFormError("Your session has ended. Please sign in again.");
    params.delete("session");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
  }, []);

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
      setPasswordError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      valid = false;
    }

    return valid;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;
    if (!validateCommon()) return;

    setIsSubmitting(true);
    const trimmedEmail = email.trim();

    try {
      // The session cookie is set by the server response itself (httpOnly,
      // can't be read/stored from here) — just navigate once login succeeds.
      const res = await login(trimmedEmail, password);
      // Admin-issued password: straight to the forced change screen (the
      // middleware would redirect there anyway — this just avoids a bounce).
      router.push(res?.user?.mustChangePassword ? "/change-password" : "/dashboard");
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
    const trimmedEmail = email.trim();

    try {
      await requestAccess(trimmedName, trimmedEmail, password, requestedRole);
      setFormSuccess(
        "Request submitted — an admin will approve your account before you can sign in."
      );
      setName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setRequestedRole("user");
      setMode("login");
    } catch (err) {
      setFormError(
        errorMessage(err, "Unable to submit your request. Please try again.")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="branding-panel">
        <div className="blueprint-bg" aria-hidden="true">
          <svg viewBox="0 0 400 400" fill="none">
            <circle cx="250" cy="200" r="150" stroke="currentColor" strokeWidth="1" />
            <circle cx="250" cy="200" r="110" stroke="currentColor" strokeWidth="1" />
            <circle cx="250" cy="200" r="60" stroke="currentColor" strokeWidth="1" />
            <circle cx="250" cy="200" r="24" stroke="currentColor" strokeWidth="1.4" />
            <path d="M250 40v320M90 200h320M143 93l214 214M357 93 143 307" stroke="currentColor" strokeWidth="0.7" />
            <rect x="40" y="170" width="120" height="60" rx="6" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="250" cy="90" r="5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="250" cy="310" r="5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="140" cy="200" r="5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="360" cy="200" r="5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Risansi Industries" className="company-logo" />

        <div className="branding-content">
          <h1>
            <span>Pump Selection</span>
            <span className="brand-accent">Portal</span>
          </h1>
          <div className="brand-accent-bar" aria-hidden="true" />

          <p className="branding-lead">
            From duty point to complete spec sheet — Risansi&apos;s engineering
            workbench for sizing Progressive Cavity Pumps, guided end to end.
          </p>

          <ul className="branding-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="feature-icon">{f.icon}</span>
                <span className="feature-text">
                  <strong>{f.title}</strong>
                  <span>{f.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <span className="branding-badge">
          <ShieldIcon />
          Secure. Reliable. Engineered for you.
        </span>
      </div>

      <div className="login-form-container">
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Risansi Industries" className="form-logo" />

          {formSuccess && (
            <div className="form-success" role="status">
              {formSuccess}
            </div>
          )}

          {mode === "login" ? (
            <form onSubmit={handleLogin} noValidate>
              <h2>Welcome back</h2>
              <p>Log in with your company credentials</p>

              {formError && (
                <div className="form-error" role="alert">
                  {formError}
                </div>
              )}

              <label htmlFor="email">Company Email</label>
              <div className="input-icon">
                <MailIcon />
                <input
                  id="email"
                  type="email"
                  placeholder="you@risansi.com"
                  value={email}
                  autoComplete="username"
                  aria-invalid={!!emailError}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                    if (formError) setFormError("");
                  }}
                />
              </div>

              {emailError && (
                <span className="error-text" role="alert">
                  {emailError}
                </span>
              )}

              <label htmlFor="password">Password</label>
              <div className="input-icon input-icon-password">
                <LockIcon />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  autoComplete="current-password"
                  aria-invalid={!!passwordError}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError("");
                    if (formError) setFormError("");
                  }}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              {passwordError && (
                <span className="error-text" role="alert">
                  {passwordError}
                </span>
              )}

              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in..." : "Sign In"}
                <span className="btn-arrow">
                  <ArrowRightIcon />
                </span>
              </button>

              <p className="mode-switch">
                Need access?{" "}
                <button type="button" onClick={() => switchMode("request")}>
                  Request Access
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRequestAccess} noValidate>
              <h2>Request Access</h2>
              <p>Submit your details — an admin will review and approve you</p>

              {formError && (
                <div className="form-error" role="alert">
                  {formError}
                </div>
              )}

              <label htmlFor="name">Full Name</label>
              <div className="input-icon">
                <PersonIcon />
                <input
                  id="name"
                  type="text"
                  placeholder="Jane Doe"
                  value={name}
                  autoComplete="name"
                  aria-invalid={!!nameError}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError("");
                    if (formError) setFormError("");
                  }}
                />
              </div>

              {nameError && (
                <span className="error-text" role="alert">
                  {nameError}
                </span>
              )}

              <label htmlFor="request-email">Company Email</label>
              <div className="input-icon">
                <MailIcon />
                <input
                  id="request-email"
                  type="email"
                  placeholder="you@risansi.com"
                  value={email}
                  autoComplete="username"
                  aria-invalid={!!emailError}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                    if (formError) setFormError("");
                  }}
                />
              </div>

              {emailError && (
                <span className="error-text" role="alert">
                  {emailError}
                </span>
              )}

              <label htmlFor="request-password">Password</label>
              <div className="input-icon input-icon-password">
                <LockIcon />
                <input
                  id="request-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  autoComplete="new-password"
                  aria-invalid={!!passwordError}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError("");
                    if (formError) setFormError("");
                  }}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              {passwordError && (
                <span className="error-text" role="alert">
                  {passwordError}
                </span>
              )}

              <label htmlFor="confirm-password">Confirm Password</label>
              <div className="input-icon">
                <LockIcon />
                <input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirm password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  aria-invalid={!!confirmPasswordError}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (confirmPasswordError) setConfirmPasswordError("");
                    if (formError) setFormError("");
                  }}
                />
              </div>

              {confirmPasswordError && (
                <span className="error-text" role="alert">
                  {confirmPasswordError}
                </span>
              )}

              <label htmlFor="request-role">Role</label>
              <select
                id="request-role"
                value={requestedRole}
                onChange={(e) => setRequestedRole(e.target.value as RequestableRole)}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label} — {r.hint}
                  </option>
                ))}
              </select>

              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Request Access"}
                <span className="btn-arrow">
                  <ArrowRightIcon />
                </span>
              </button>

              <p className="mode-switch">
                Already have access?{" "}
                <button type="button" onClick={() => switchMode("login")}>
                  Sign in
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
