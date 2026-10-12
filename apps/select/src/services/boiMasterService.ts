import type { BoiTableKey } from "../lib/boi-tables";
import apiClient from "./apiClient";

// BOI Master — VFD tab (boi_vfd). pg NUMERIC columns come back as strings.
export interface BoiVfdRow {
  id: string;
  make: string;
  series: string | null;
  supply: string | null;
  driveDescription: string;
  frame: string | null;
  pnKw: string | null;
  inA: string | null;
  pldKw: string | null;
  ildA: string | null;
  phdKw: string | null;
  ihdA: string | null;
  listPrice: string | null;
  discountPct: string | null;
  bopExtra: string | null;
  priceListDate: string | null;
  remarks: string | null;
}

export type BoiVfdInput = Partial<Record<Exclude<keyof BoiVfdRow, "id">, string>>;

export const listBoiVfd = async (): Promise<BoiVfdRow[]> => {
  const { data } = await apiClient.get<BoiVfdRow[]>("/boi-master/vfd");
  return data;
};

export const createBoiVfd = async (values: BoiVfdInput): Promise<BoiVfdRow> => {
  const { data } = await apiClient.post<BoiVfdRow>("/boi-master/vfd", values);
  return data;
};

export const updateBoiVfd = async (id: string, values: BoiVfdInput): Promise<BoiVfdRow> => {
  const { data } = await apiClient.patch<BoiVfdRow>(`/boi-master/vfd/${id}`, values);
  return data;
};

export const deleteBoiVfd = async (id: string): Promise<void> => {
  await apiClient.delete(`/boi-master/vfd/${id}`);
};

// BOI Master — the simple tables (drp-probe | drp-panel | shaft-dia, see
// lib/boi-tables.ts), one API shape. Rows are loose records rendered from
// the table definitions.
export type BoiTableRow = { id: string } & Record<string, string | number | null>;

export const listBoiTable = async (table: BoiTableKey): Promise<BoiTableRow[]> => {
  const { data } = await apiClient.get<BoiTableRow[]>(`/boi-master/table/${table}`);
  return data;
};

export const createBoiTableRow = async (table: BoiTableKey, values: Record<string, string>): Promise<BoiTableRow> => {
  const { data } = await apiClient.post<BoiTableRow>(`/boi-master/table/${table}`, values);
  return data;
};

export const updateBoiTableRow = async (
  table: BoiTableKey,
  id: string,
  values: Record<string, string>,
): Promise<BoiTableRow> => {
  const { data } = await apiClient.patch<BoiTableRow>(`/boi-master/table/${table}/${id}`, values);
  return data;
};

export const deleteBoiTableRow = async (table: BoiTableKey, id: string): Promise<void> => {
  await apiClient.delete(`/boi-master/table/${table}/${id}`);
};
