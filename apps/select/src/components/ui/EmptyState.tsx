import "./EmptyState.css";

export type EmptyStateIconName =
  | "folder"
  | "inbox"
  | "search"
  | "alert"
  | "table"
  | "check";

type EmptyStateProps = {
  icon?: EmptyStateIconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Compact variant — smaller icon + tighter padding, e.g. inside a panel. */
  compact?: boolean;
};

/** Centered zero-state block — icon + heading + supporting copy + optional CTA.
 * Icons are inline SVG (self-contained; no external asset dependency) and
 * inherit the accent color from CSS. */
const EmptyState = ({
  icon = "inbox",
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) => (
  <div className={`empty-state-panel ${compact ? "empty-state-compact" : ""}`}>
    <div className="empty-state-icon" aria-hidden="true">
      <EmptyIcon name={icon} />
    </div>
    <h3 className="empty-state-title">{title}</h3>
    {description && <p className="empty-state-desc">{description}</p>}
    {action && <div className="empty-state-action">{action}</div>}
  </div>
);

// Inline SVG icons — light stroke weight matches the app's flat-hairline style.
const EmptyIcon = ({ name }: { name: EmptyStateIconName }) => {
  switch (name) {
    case "folder":
      return (
        <svg viewBox="0 0 48 48" fill="none">
          <path
            d="M8 14a4 4 0 0 1 4-4h9l4 5h11a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V14Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8 20h32" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "inbox":
      return (
        <svg viewBox="0 0 48 48" fill="none">
          <path
            d="M8 26h9l2 4h10l2-4h9M10 26 14 12h20l4 14v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V26Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="21" cy="21" r="11" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="m30 30 8 8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "alert":
      return (
        <svg viewBox="0 0 48 48" fill="none">
          <path
            d="M24 8 6 40h36L24 8Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M24 20v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="24" cy="34" r="1.6" fill="currentColor" />
        </svg>
      );
    case "table":
      return (
        <svg viewBox="0 0 48 48" fill="none">
          <rect
            x="8"
            y="10"
            width="32"
            height="28"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M8 20h32M20 10v28M8 30h32"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="m16 24 6 6 12-12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};

export default EmptyState;
