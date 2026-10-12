"use client";

/**
 * Small shared pieces for required-field validation across the wizard steps.
 *
 * The pattern each step follows: build an `errors` map on every render, keep a
 * `showErrors` flag that only flips on a failed Next, and render <Err> under
 * each control. Nothing is marked invalid while the user is still filling the
 * form in — errors appear when they try to move on, which is the point they
 * actually need to know.
 */
import { hintError } from "./formStyles";

/** Red asterisk marking a required label. Decorative — the error text below
 * the control is what actually explains the requirement. */
export const Req = () => (
  <span className="text-neg" aria-hidden="true">
    {" *"}
  </span>
);

/** Error line under a control. Renders nothing until the step has been
 * submitted once (`show`), so a blank form doesn't open covered in red. */
export const Err = ({ show, msg }: { show: boolean; msg?: string }) =>
  show && msg ? <span className={hintError}>{msg}</span> : null;

/** "" when present, otherwise the message — the shape the steps' error maps
 * are built from. Treats whitespace-only as missing. */
export const required = (value: unknown, msg: string): string =>
  typeof value === "string" && value.trim() !== "" ? "" : value ? "" : msg;

/** True when any field in an error map is non-empty. */
export const hasErrors = (errors: Record<string, string>): boolean =>
  Object.values(errors).some(Boolean);

/** Banner shown above the step's Next button when a submit was blocked. */
export const ErrorBanner = ({ show, count }: { show: boolean; count: number }) =>
  show && count > 0 ? (
    <p className="mt-[14px] rounded-lg border border-neg bg-[var(--neg-soft,#fef3f2)] pl-[12px] pr-[12px] pt-[9px] pb-[9px] text-[13px] text-neg">
      {count === 1
        ? "1 required field is still empty."
        : `${count} required fields are still empty.`}{" "}
      Fill them in to continue.
    </p>
  ) : null;
