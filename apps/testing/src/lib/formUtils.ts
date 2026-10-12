import type { ChangeEvent } from "react";
import { MOTOR_RPM_OPTIONS } from "@/types/testing";

/** Normalizes a pump model input as the user types: uppercase, no hyphens. */
export const normalizeModelOnChange = (e: ChangeEvent<HTMLInputElement>) => {
  e.target.value = e.target.value.toUpperCase().replace(/-/g, "");
};

/** "342 KB" / "1.3 MB" -- shared by the attachment picker and its read-only
 * display on the requisition detail page. */
export const formatFileSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Motor RPM is a fixed-choice <select> (MOTOR_RPM_OPTIONS), but values
 * loaded from the DB come back as decimal-formatted numeric strings (e.g.
 * "1440.00"). Normalize to plain "1440"/"960" so the <select> pre-selects
 * correctly; returns "" for anything that isn't one of the two options
 * (older/legacy data with a different measured RPM) so the field shows
 * blank rather than silently pre-selecting the wrong option.
 */
export const normalizeMotorRpm = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const s = String(n);
  return (MOTOR_RPM_OPTIONS as readonly string[]).includes(s) ? s : "";
};

/**
 * Installed motor power, read out of the free-text Motor field ("CGL 30HP"
 * -> 30 HP / 22.38 KW). Reports don't carry a dedicated installed-power
 * column -- every one of them records it inside the motor string instead.
 *
 * Anchors on the number immediately before "HP" rather than the first number
 * in the string, so brands that contain digits or dots ("SI.NO. 3HP",
 * "ABB-3 HP") still resolve, as do decimals ("7.5HP") and the leading-dot
 * form ("ABB .5HP"). Returns null when there's no parseable figure, so the
 * caller can fall back to showing the raw text.
 */
export const installedPowerFromMotor = (
  motor: string | null | undefined
): { hp: number; kw: number } | null => {
  if (!motor) return null;
  const match = motor.match(/(\d*\.?\d+)\s*HP/i);
  if (!match) return null;
  const hp = Number(match[1]);
  if (!Number.isFinite(hp) || hp <= 0) return null;
  return { hp, kw: Math.round(hp * 0.746 * 100) / 100 };
};

/** "Installed Power (KW)" label for a Motor field -- always KW, never the
 * raw HP a source team member typed (see installedPowerFromMotor above).
 * Falls back to the raw motor text when no HP figure can be read out of it
 * at all, so the caller always has something to show. */
export const installedPowerLabel = (motor: string | null | undefined): string => {
  const power = installedPowerFromMotor(motor);
  if (power) return `${power.kw} KW`;
  return motor ?? "-";
};

/** "CGL 3HP" -> "CGL 3HP (2.24 KW)" -- appends the KW conversion rather than
 * replacing the raw text, for a spot where the brand/model info in Motor is
 * worth keeping alongside it (e.g. a compact list column). Unparseable motor
 * text (or none) is returned as-is. */
export const motorWithKw = (motor: string | null | undefined): string => {
  if (!motor) return motor ?? "-";
  const power = installedPowerFromMotor(motor);
  return power ? `${motor} (${power.kw} KW)` : motor;
};

/**
 * Renders a stored date as dd/mm/yy for display. Accepts a plain date
 * ("2026-08-10") or a timestamp ("2026-08-10T07:16:04.694Z") and returns "-"
 * for a missing one.
 *
 * Deliberately string-slicing rather than going through `new Date()`: the DB
 * hands back a plain calendar date, and parsing it into a Date would drag the
 * viewer's timezone in and can shift the day by one. Everything stored,
 * sorted and computed with stays ISO -- this is display only.
 */
export const formatDate = (value: string | null | undefined): string => {
  if (!value) return "-";
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y.slice(2)}`;
};

/** "3d ago" / "5h ago" / "12m ago" / "just now" -- for compact card
 * timestamps (Bug Reports Kanban) where a full date/time is more detail
 * than the space allows. Falls back to a short date once it's over a week
 * old, rather than "52w ago". */
export const timeAgo = (value: string): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
};

const addDays = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Caps any numeric display to at most 3 decimal places, stripping trailing
 * zeros ("22.380000" -> "22.38", "320.00" -> "320", "9.140000" -> "9.14") --
 * whole numbers stay whole. Postgres `numeric` columns serialize with their
 * full column scale (up to 6 decimals in this schema), and raw formula-engine
 * output can carry long floating-point tails -- this is the one place that
 * caps both before they reach the screen. Returns "-" for anything
 * null/undefined/empty/non-numeric, so it's a safe drop-in wherever a value
 * is actually numeric (not for free-text/identifier fields like PO No. or
 * Gearbox No., which can contain non-numeric characters worth preserving
 * as-is).
 */
export const formatNumber = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return String(Number(n.toFixed(3)));
};

/**
 * Suggested filename for a report's "Export PDF" (window.print() -> the
 * browser's own Save as PDF, no PDF library involved) -- the EC/Quotation
 * number if the report has one, since that's what the source/testing teams
 * actually file these reports by, not the generic page title. Falls back to
 * the report number, then the model, when there's no EC/Quotation number on
 * the report yet. Slashes (EC numbers are typically "EC/26/1/965/39071",
 * Quotation numbers similarly slash-delimited) aren't valid in file names on
 * most OSes, so they're swapped for dashes.
 *
 * Sets `document.title`, which Chrome/Edge/Firefox all use as the default
 * Save-as-PDF filename -- call this right before `window.print()` (or keep
 * it live via an effect) and restore the previous title afterward so the
 * browser tab doesn't stay stuck on it.
 */
export const reportExportFileName = (
  report: { ec_no?: string | null; report_no?: string | null; model: string },
  suffix?: string
): string => {
  const base = report.ec_no || report.report_no || report.model || "Pump Test Report";
  const sanitized = base.replace(/[\\/]/g, "-");
  return suffix ? `${sanitized} - ${suffix}` : sanitized;
};

/** A requisition's Target Date: the source team's explicit value if they set
 * one (only shown/filled for "Against R&D Trials" on the requisition form),
 * otherwise 7 days after Date of Requisition, falling back to the submission
 * date if that's also blank. Computed live rather than stored so it stays in
 * sync if Date of Requisition gets edited later. */
export const targetDateFor = (r: {
  target_date?: string | null;
  date_of_requisition?: string | null;
  created_at?: string | null;
}): { date: string; isAuto: boolean } | null => {
  if (r.target_date) return { date: r.target_date, isAuto: false };
  const base = r.date_of_requisition ?? r.created_at?.slice(0, 10);
  if (!base) return null;
  return { date: addDays(base, 7), isAuto: true };
};
