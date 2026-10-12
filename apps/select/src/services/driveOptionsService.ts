import apiClient from "./apiClient";
import type { DriveOptionKind, DriveOptions } from "../lib/drive-options";

/** All four rating-plate lists (Frequency / Voltage / Efficiency / Protection). */
export const getDriveOptions = async (): Promise<DriveOptions> => {
  const { data } = await apiClient.get<DriveOptions>("/drive-options");
  return data;
};

/** Adds a value typed into "Other". A value already on the list (in any case)
 * comes back as its stored spelling instead of being duplicated. */
export const addDriveOption = async (
  kind: DriveOptionKind,
  value: string,
): Promise<{ value: string; options: DriveOptions }> => {
  const { data } = await apiClient.post<{ value: string; options: DriveOptions }>(
    "/drive-options",
    { kind, value },
  );
  return data;
};
