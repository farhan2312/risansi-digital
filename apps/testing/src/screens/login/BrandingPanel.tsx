"use client";

import { useEffect, useState, type MouseEvent } from "react";

const FEATURES = [
  {
    icon: "📋",
    title: "Raise requisitions",
    text: "Log a pump testing request with its category, EC / quotation number and rated duty in one form.",
  },
  {
    icon: "🔎",
    title: "Check before you test",
    text: "See every prior test report for the same pump model, so nothing is tested twice by accident.",
  },
  {
    icon: "🧮",
    title: "Live test reports",
    text: "Fill the Observation Sheet or Viscosity Correction Chart, with formulas ported from the original workbook.",
  },
  {
    icon: "🔁",
    title: "Track and retest",
    text: "Follow each requisition from Pending to Closed, and raise a retest when a pump misses its rated duty.",
  },
] as const;

const ROTATE_MS = 5500;

// Decorative pump curve (head falling as capacity rises) -- a cubic Bezier, so
// the test points can sit exactly on the line.
const CURVE = { p0: [24, 42], p1: [130, 40], p2: [235, 84], p3: [342, 168] } as const;
const bezier = (t: number) => {
  const u = 1 - t;
  const pick = (i: 0 | 1) =>
    u * u * u * CURVE.p0[i] + 3 * u * u * t * CURVE.p1[i] + 3 * u * t * t * CURVE.p2[i] + t * t * t * CURVE.p3[i];
  return [pick(0), pick(1)] as const;
};
const POINT_T = [0.08, 0.28, 0.5, 0.72, 0.92];
// Which test point each feature lights up.
const POINT_FOR_FEATURE = [0, 1, 3, 4];

/** The login page's left side: pitch, a rotating feature list you can click,
 * and a self-drawing performance curve. Motion is skipped for people who ask
 * their system to reduce it. */
const BrandingPanel = () => {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Auto-advance; hovering or focusing the list pauses it (and the progress bar restarts on resume).
  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = setTimeout(() => setActive((i) => (i + 1) % FEATURES.length), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [active, paused, reducedMotion]);

  // Cursor-following glow: written straight to CSS variables, no re-render per move.
  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  const activePoint = POINT_FOR_FEATURE[active];

  return (
    <div className="branding-panel" onMouseMove={handleMove}>
      <div className="branding-glow" aria-hidden="true" />
      <div className="branding-blob branding-blob-a" aria-hidden="true" />
      <div className="branding-blob branding-blob-b" aria-hidden="true" />

      <img src="/logo.png" alt="Risansi Industries" className="company-logo" />

      <div className="branding-content">
        <h1>
          Pump Testing
          <br />
          Portal
        </h1>

        <p>
          Testing summary intake, dedup checks against prior test reports, and test report submission for the R&amp;D /
          production testing team.
        </p>

        <div className="branding-showcase">
          <ul
            className="feature-list"
            aria-label="What the portal does"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            {FEATURES.map((f, i) => (
              <li key={f.title}>
                <button
                  type="button"
                  className={`feature-item${i === active ? " active" : ""}`}
                  aria-pressed={i === active}
                  onClick={() => setActive(i)}
                >
                  <span className="feature-icon" aria-hidden="true">
                    {f.icon}
                  </span>
                  <span className="feature-body">
                    <span className="feature-title">{f.title}</span>
                    <span className="feature-text">{f.text}</span>
                    {i === active && !reducedMotion && (
                      <span className="feature-progress" aria-hidden="true">
                        <span
                          key={`${active}-${paused}`}
                          className={paused ? "paused" : undefined}
                          style={{ animationDuration: `${ROTATE_MS}ms` }}
                        />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <figure className="curve-card" aria-label="Illustration of a pump performance curve">
            <figcaption>
              <span>Performance curve</span>
              <em>illustrative</em>
            </figcaption>
            <svg viewBox="0 0 366 200" role="img" aria-hidden="true">
              {[0, 1, 2, 3].map((n) => (
                <line key={n} x1="24" x2="352" y1={30 + n * 46} y2={30 + n * 46} className="curve-grid" />
              ))}
              <line x1="24" y1="20" x2="24" y2="176" className="curve-axis" />
              <line x1="24" y1="176" x2="352" y2="176" className="curve-axis" />
              <text x="30" y="14" className="curve-label">
                Head
              </text>
              <text x="352" y="192" textAnchor="end" className="curve-label">
                Capacity
              </text>
              <path
                d={`M${CURVE.p0} C${CURVE.p1} ${CURVE.p2} ${CURVE.p3}`}
                className={`curve-line${reducedMotion ? " static" : ""}`}
                pathLength={1}
                fill="none"
              />
              {POINT_T.map((t, i) => {
                const [x, y] = bezier(t);
                const isActive = i === activePoint;
                return (
                  <g key={t} transform={`translate(${x} ${y})`} className={`curve-point${isActive ? " active" : ""}`} style={{ animationDelay: `${0.9 + i * 0.12}s` }}>
                    {isActive && <circle r="13" className="curve-pulse" />}
                    <circle r={isActive ? 6 : 4} className="curve-dot" />
                  </g>
                );
              })}
            </svg>
          </figure>
        </div>
      </div>

      <span className="branding-footer">Version 1.0</span>
    </div>
  );
};

export default BrandingPanel;
