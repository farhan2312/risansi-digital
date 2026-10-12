import apiClient from "./apiClient";

// Mirrors the motor_master row (Drizzle camelCase; pg NUMERIC columns come back
// as strings, the integer motor_rpm as a real number). Admin-only — enforced
// server-side via requireAdmin using the httpOnly session cookie sent
// automatically on these same-origin calls. Normalized long form: one row per
// motor rating × brand (see schema.ts).
export interface MotorMasterRow {
  id: string;
  motorKw: string | null;
  motorHp: string | null;
  /** integer column — pg returns a real number, not a string. */
  motorRpm: number | null;
  motorType: string | null;
  mounting: string | null;
  brand: string | null;
  frameSize: string | null;
  lpPrice: string | null;
  finalPrice: string | null;
  /** Price-list effective date, "YYYY-MM-DD" (date column), or null. */
  effectiveDate: string | null;
}

export type MotorMasterPatch = Partial<Omit<MotorMasterRow, "id">>;

// brand + motorKw are required server-side; everything else is optional and
// arrives as the raw strings the form's <input> elements produce (numeric
// fields become NULL server-side when blank).
export type MotorMasterInsert = Partial<Omit<MotorMasterRow, "id">> & {
  brand: string;
  motorKw: string;
};

export const listMotorMasterRows = async (): Promise<MotorMasterRow[]> => {
  const { data } = await apiClient.get<MotorMasterRow[]>("/motor-master");
  return data;
};

export const createMotorMasterRow = async (
  values: MotorMasterInsert
): Promise<MotorMasterRow> => {
  const { data } = await apiClient.post<MotorMasterRow>("/motor-master", values);
  return data;
};

export const updateMotorMasterRow = async (
  id: string,
  patch: MotorMasterPatch
): Promise<MotorMasterRow> => {
  const { data } = await apiClient.patch<MotorMasterRow>(`/motor-master/${id}`, patch);
  return data;
};

export const deleteMotorMasterRow = async (id: string): Promise<void> => {
  await apiClient.delete(`/motor-master/${id}`);
};

/** Motor candidates for the Drive step's selection cards — screened by the
 * fixed motor rating (kW) plus RPM/mounting, optionally narrowed by make.
 * Read-only and open to any authenticated user (see /api/motor-options),
 * unlike the admin-only CRUD calls above. */
export const listMotorOptions = async (query: {
  kw: string | number;
  rpm?: string | number;
  mounting?: string;
  make?: string;
  /** Efficiency (IE) class — matched against motor_master.motor_type. */
  motorType?: string;
}): Promise<MotorMasterRow[]> => {
  const { data } = await apiClient.get<MotorMasterRow[]>("/motor-options", {
    params: {
      kw: query.kw,
      rpm: query.rpm || undefined,
      mounting: query.mounting || undefined,
      make: query.make || undefined,
      motorType: query.motorType || undefined,
    },
  });
  return data;
};
