import apiClient from "./apiClient";
import type { CodeOption } from "../lib/pump-code";

/** Every active choice for the pump product-code builder. */
export const listPumpCodeOptions = async (): Promise<CodeOption[]> => {
  const { data } = await apiClient.get<CodeOption[]>("/pump-code-options");
  return data;
};

/** "+ Add" a choice to an addable part (segment as stored, e.g. "sub_category"). */
export const addPumpCodeOption = async (segment: string, code: string, label?: string): Promise<CodeOption> => {
  const { data } = await apiClient.post<CodeOption>("/pump-code-options", { segment, code, label });
  return data;
};
