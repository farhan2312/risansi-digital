import type { ReactNode } from "react";

/** Small line icons for the Audit Log's card headers and insight chips -- one stroke style throughout. */
const svg = (children: ReactNode, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const auditIcons = {
  pulse: (size?: number) => svg(<path d="M3 12h4l3-8 4 16 3-8h4" />, size),
  shield: (size?: number) =>
    svg(
      <>
        <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </>,
      size
    ),
  flame: (size?: number) => svg(<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.4 1.5-3.5C10.5 6.5 11.5 5.5 12 3z" />, size),
  grid: (size?: number) =>
    svg(
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </>,
      size
    ),
  users: (size?: number) =>
    svg(
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
        <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.7c2.2.5 3.5 2.3 3.5 5.3" />
      </>,
      size
    ),
  tag: (size?: number) =>
    svg(
      <>
        <path d="M3 12V4h8l9 9-8 8-9-9z" />
        <circle cx="7.5" cy="8.5" r="1.2" />
      </>,
      size
    ),
  monitor: (size?: number) =>
    svg(
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>,
      size
    ),
  globe: (size?: number) =>
    svg(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
      </>,
      size
    ),
  calendar: (size?: number) =>
    svg(
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>,
      size
    ),
  trophy: (size?: number) =>
    svg(
      <>
        <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
        <path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 20h8" />
      </>,
      size
    ),
  clock: (size?: number) =>
    svg(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>,
      size
    ),
};
