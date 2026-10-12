import "./Stepper.css";

type StepperProps = {
  currentStep: number;
  /** Furthest step the user has ever reached for this enquiry. Every step
   * below it stays ticked/green even after jumping back, so the stepper shows
   * what's already done vs. what's left rather than just "before the cursor". */
  maxStep?: number;
  onStepClick?: (step: number) => void;
  /** When true, the LAST step (Recommendation) is shown completed/green even
   * though it's the current step — set once the final report is confirmed, so
   * the summary reads as done rather than merely in progress. */
  finalCompleted?: boolean;
};

const steps = [
  "General",
  "Fluid",
  "Specifications",
  "MOC",
  "Sealing",
  "Motor Rating",
  "Drive",
  "Approval",
  "Recommendation",
];

const Stepper = ({ currentStep, maxStep, onStepClick, finalCompleted }: StepperProps) => {
  // Progress reaches as far as the user has ever been, not just where the
  // cursor is now — jumping back to step 1 shouldn't visually undo the work.
  const reached = Math.max(currentStep, maxStep ?? currentStep);

  // Fill the connecting progress line proportionally to how far we are:
  // 0% before step 1, 100% at the last step. `--step-progress` is consumed
  // by .stepper::after in Stepper.css to size the filled overlay.
  const progressPct =
    steps.length <= 1
      ? 0
      : ((Math.max(1, Math.min(reached, steps.length)) - 1) /
          (steps.length - 1)) *
        100;

  return (
    <div
      className="stepper"
      style={
        {
          ["--step-progress" as string]: `${progressPct}%`,
        } as React.CSSProperties
      }
    >
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        // Any step before the furthest one reached counts as done — including
        // ones ahead of the current cursor after jumping back. The last step
        // also counts as done once the final report is confirmed, even though
        // it's the current step (so the summary turns green on confirm).
        const isLast = stepNumber === steps.length;
        const isCompleted =
          (!isActive && stepNumber < reached) ||
          (finalCompleted === true && isLast);
        return (
          <button
            type="button"
            key={step}
            className={`step ${isActive ? "active" : ""} ${
              isCompleted ? "completed" : ""
            } ${onStepClick ? "clickable" : ""}`}
            onClick={() => onStepClick?.(stepNumber)}
            disabled={!onStepClick}
            aria-current={isActive ? "step" : undefined}
          >
            <div className="step-circle" aria-hidden="true">
              {isCompleted ? <CheckIcon /> : stepNumber}
            </div>
            <span>{step}</span>
          </button>
        );
      })}
    </div>
  );
};

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m5 12 5 5 9-11"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default Stepper;
