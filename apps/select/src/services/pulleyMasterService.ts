import apiClient from "./apiClient";

// Mirrors the pulley_motor_option row (Drizzle camelCase; pg NUMERIC columns
// come back as strings — INTEGER columns come back as real numbers).
// Admin-only — enforced server-side via requireAdmin on the API routes.
export interface PulleyMotorRow {
  id: string;
  model: string;
  motorRpm: number;
  motorHp: string | null;
  motorKw: string | null;
  maxCapAt60Mwc: string | null;
  grooves: string | null;
  pumpShaftDia: string | null;
  pumpShaftLength: string | null;
  motorShaftDia: string | null;
  motorShaftLength: string | null;
}

// Read-only child rows shown in the Details modal.
export interface PulleyBeltRow {
  id: string;
  pulleyMotorOptionId: string;
  targetRpm: number;
  pmpPulley: string | null;
  mtrPulley: string | null;
  actualRpm: string | null;
  centerDistance: string | null;
  vBelt: string | null;
}

// Nested belt-child shape accepted by POST/PATCH — same fields as PulleyBeltRow
// but without id (server-assigned) and pulleyMotorOptionId (derived from the
// parent). targetRpm is required; the rest are optional numeric strings.
export interface PulleyBeltInput {
  targetRpm: number;
  pmpPulley?: string | null;
  mtrPulley?: string | null;
  actualRpm?: string | null;
  centerDistance?: string | null;
  vBelt?: string | null;
}

export type PulleyMotorPatch = Partial<Omit<PulleyMotorRow, "id">> & {
  /** Presence of this key on PATCH replaces ALL existing belt children with
   * the provided array. Omit to leave the belt options untouched. */
  belts?: PulleyBeltInput[];
};

export type PulleyMotorInsert = Partial<Omit<PulleyMotorRow, "id">> & {
  model: string;
  motorRpm: number;
  /** Optional belt children created atomically with the parent. */
  belts?: PulleyBeltInput[];
};

export const listPulleyMotorRows = async (): Promise<PulleyMotorRow[]> => {
  const { data } = await apiClient.get<PulleyMotorRow[]>("/pulley-motor-option");
  return data;
};

export const createPulleyMotorRow = async (
  values: PulleyMotorInsert
): Promise<PulleyMotorRow> => {
  const { data } = await apiClient.post<PulleyMotorRow>("/pulley-motor-option", values);
  return data;
};

export const updatePulleyMotorRow = async (
  id: string,
  patch: PulleyMotorPatch
): Promise<PulleyMotorRow> => {
  const { data } = await apiClient.patch<PulleyMotorRow>(`/pulley-motor-option/${id}`, patch);
  return data;
};

export const deletePulleyMotorRow = async (id: string): Promise<void> => {
  await apiClient.delete(`/pulley-motor-option/${id}`);
};

export const listPulleyBeltRows = async (
  motorOptionId: string
): Promise<PulleyBeltRow[]> => {
  const { data } = await apiClient.get<PulleyBeltRow[]>(
    `/pulley-motor-option/${motorOptionId}/belts`
  );
  return data;
};
