import apiClient from "./apiClient";

export type GearboxTableKey = "pbl" | "ptl" | "top-gear";

// Mirrors a pbl_gearbox/ptl_gearbox/top_gear_gearbox row (Drizzle camelCase;
// pg NUMERIC columns come back as strings). power_rating_raw is intentionally
// omitted here — the admin UI ignores that column entirely (per spec); the
// server derives/keeps it in sync from power_rating_kw.
export interface GearboxMasterRow {
  id: string;
  powerRatingKw: string | null;
  outputRpm: string;
  model: string;
  gearBoxType: string | null;
  serviceFactor: string | null;
  ratePerNos: string | null;
}

export type GearboxMasterPatch = Partial<Omit<GearboxMasterRow, "id">>;

export type GearboxMasterInsert = Partial<Omit<GearboxMasterRow, "id">> & {
  model: string;
  outputRpm: string;
};

export const listGearboxRows = async (
  table: GearboxTableKey
): Promise<GearboxMasterRow[]> => {
  const { data } = await apiClient.get<GearboxMasterRow[]>(`/gearbox-master/${table}`);
  return data;
};

export const createGearboxRow = async (
  table: GearboxTableKey,
  values: GearboxMasterInsert
): Promise<GearboxMasterRow> => {
  const { data } = await apiClient.post<GearboxMasterRow>(`/gearbox-master/${table}`, values);
  return data;
};

export const updateGearboxRow = async (
  table: GearboxTableKey,
  id: string,
  patch: GearboxMasterPatch
): Promise<GearboxMasterRow> => {
  const { data } = await apiClient.patch<GearboxMasterRow>(
    `/gearbox-master/${table}/${id}`,
    patch
  );
  return data;
};

export const deleteGearboxRow = async (
  table: GearboxTableKey,
  id: string
): Promise<void> => {
  await apiClient.delete(`/gearbox-master/${table}/${id}`);
};
