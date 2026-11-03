import apiClient from "./apiClient";
import type { ClearanceEntry, ClearanceNow, ClearanceStatus } from "../lib/clearance";

export const getClearance = async (projectId: string): Promise<{ history: ClearanceEntry[]; otherReasons: string[] }> => {
  const { data } = await apiClient.get(`/projects/${projectId}/clearance`);
  return data;
};

export const saveClearance = async (
  projectId: string,
  input: { status: ClearanceStatus; group?: string; reason?: string; remarks: string },
): Promise<{ now: ClearanceNow; history: ClearanceEntry[] }> => {
  const { data } = await apiClient.post(`/projects/${projectId}/clearance`, input);
  return data;
};

export const addClearanceReason = async (label: string): Promise<string> => {
  const { data } = await apiClient.post<{ label: string }>("/projects/clearance-reasons", { label });
  return data.label;
};
