/**
 * The Drive step's rating-plate option lists: Frequency, Voltage, Efficiency
 * and Protection. Values live in drive_option_master so a list can grow — the
 * dropdowns offer "Other", and what the engineer types there is added to the
 * list for next time.
 *
 * Shared by the client (the dropdowns) and the server (/api/drive-options) so
 * the two can't disagree about which lists exist.
 */

export const DRIVE_OPTION_KINDS = ["frequency", "voltage", "efficiency", "protection"] as const;
export type DriveOptionKind = (typeof DRIVE_OPTION_KINDS)[number];

export const isDriveOptionKind = (value: string): value is DriveOptionKind =>
  (DRIVE_OPTION_KINDS as readonly string[]).includes(value);

/** One list per kind; empty arrays until the fetch lands. */
export type DriveOptions = Record<DriveOptionKind, string[]>;

export const emptyDriveOptions = (): DriveOptions => ({
  frequency: [],
  voltage: [],
  efficiency: [],
  protection: [],
});

/** Sentinel for the "type a new one" branch of each dropdown. Never stored —
 * the field ends up holding the typed value itself. */
export const OTHER_OPTION = "Other";

/** Longest value the lists accept (the column is varchar(50)). */
export const MAX_DRIVE_OPTION_LENGTH = 50;

/**
 * What "Standard" means on a rating plate. Choosing Std / Non-Std = Standard
 * fills these in; every one stays editable, and Non-Standard leaves whatever
 * is already there alone.
 */
export const STANDARD_RATING_PLATE = {
  driveMotorFrequency: "50",
  driveMotorVoltage: "415",
  driveMotorEfficiency: "IE2",
  driveMotorProtection: "IP55",
} as const;
