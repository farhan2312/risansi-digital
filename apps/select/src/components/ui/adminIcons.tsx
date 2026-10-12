/** Reusable inline SVG icons for admin master pages (Pump Model / Gearbox /
 * Pulley) and the Access Requests page. Self-contained — no external asset
 * dependency. All icons inherit `currentColor` and use a matching 1.7–2px
 * stroke weight so they read as one family. */

export const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const DetailsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M12 11v5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="12" cy="8" r="1.2" fill="currentColor" />
  </svg>
);

export const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M4 20h4L20 8l-4-4L4 16v4Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path d="m14 6 4 4" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

export const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 8v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="16" r="1" fill="currentColor" />
  </svg>
);

export const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="m5 13 4 4 10-11"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M6 6l12 12M18 6 6 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
  </svg>
);

export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M7 5v14l12-7L7 5Z" fill="currentColor" />
  </svg>
);
