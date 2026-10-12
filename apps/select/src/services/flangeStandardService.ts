import apiClient from "./apiClient";

/** Flange standard options (suction and discharge share one list), from flange_standard_master. */
export const listFlangeStandards = async (): Promise<string[]> => {
  const { data } = await apiClient.get<string[]>("/flange-standards");
  return data;
};

/** Adds a value typed into "Other" so it is available to everyone afterwards.
 *  Returns the stored value (an existing one when it already exists, whatever
 *  its case) and the updated list. */
export const addFlangeStandard = async (value: string): Promise<{ value: string; options: string[] }> => {
  const { data } = await apiClient.post<{ value: string; options: string[] }>("/flange-standards", { value });
  return data;
};
