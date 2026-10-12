import "./Spinner.css";

type SpinnerSize = "sm" | "md" | "lg";

type SpinnerProps = {
  size?: SpinnerSize;
  /** Screen-reader label; also used as tooltip. Defaults to "Loading". */
  label?: string;
  /** Optional visible caption rendered next to the ring. */
  caption?: string;
  /** Inline vs. block layout. Inline uses vertical-align: middle. */
  inline?: boolean;
};

const PX: Record<SpinnerSize, number> = { sm: 14, md: 20, lg: 32 };

/** Small, currentColor-tinted circular spinner. Uses CSS-only rotation
 * (respects prefers-reduced-motion via Spinner.css). Pair it with a caption
 * in longer loads so users see what's happening, not just that something is. */
const Spinner = ({ size = "md", label = "Loading", caption, inline = false }: SpinnerProps) => {
  const px = PX[size];
  return (
    <span className={`spinner-wrap ${inline ? "spinner-inline" : ""}`} role="status" aria-live="polite">
      <svg
        className="spinner-ring"
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {caption ? <span className="spinner-caption">{caption}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
};

export default Spinner;
