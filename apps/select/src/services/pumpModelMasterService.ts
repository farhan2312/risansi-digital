import apiClient from "./apiClient";

// Mirrors the pump_model_master row (Drizzle camelCase; pg NUMERIC columns come
// back as strings). Admin-only — enforced server-side via requireAdmin using
// the httpOnly session cookie sent automatically on these same-origin calls.
export interface PumpModelRow {
  id: string;
  model: string;
  headMwc: string;
  voleMin: string | null;
  voleMax: string | null;
  mechEff: string | null;
  qth: string | null;
  minKwExisting: string | null;
  minStartingKwAt1Kg: string | null;
  minKwTested: string | null;
  minKwToBeTested: string | null;
  testingRemarks: string | null;
  hardSolidMm: string | null;
  softSolidMm: string | null;
  /** integer column — pg returns this as a real number, not a string like the numeric columns above. */
  stage: number | null;
  /** Suction/discharge pipe size (inches) per viscosity band, from
   * Model_vs_Viscosity_vs_Size.xlsx. NULL when the model isn't covered by the source sheet. */
  sizeVisc0To1000In: string | null;
  sizeVisc1000To3000In: string | null;
  sizeVisc3000To5000In: string | null;
  sizeVisc5000To10000In: string | null;
  sizeViscGt10000In: string | null;
}

export type PumpModelPatch = Partial<Omit<PumpModelRow, "id">>;

export const listPumpModelRows = async (): Promise<PumpModelRow[]> => {
  const { data } = await apiClient.get<PumpModelRow[]>("/pump-model-master");
  return data;
};

// Same fields as the PATCH shape — model + headMwc are required server-side,
// everything else is optional. Values arrive as the raw strings from the
// form's <input> elements (numeric fields become NULL server-side when blank).
export type PumpModelInsert = Partial<Omit<PumpModelRow, "id">> & {
  model: string;
  headMwc: string;
};

export const createPumpModelRow = async (
  values: PumpModelInsert
): Promise<PumpModelRow> => {
  const { data } = await apiClient.post<PumpModelRow>("/pump-model-master", values);
  return data;
};

export const updatePumpModelRow = async (
  id: string,
  patch: PumpModelPatch
): Promise<PumpModelRow> => {
  const { data } = await apiClient.patch<PumpModelRow>(`/pump-model-master/${id}`, patch);
  return data;
};

export const deletePumpModelRow = async (id: string): Promise<void> => {
  await apiClient.delete(`/pump-model-master/${id}`);
};
