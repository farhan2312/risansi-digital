import apiClient from "./apiClient";
import type { SparePart, SparePumpKind } from "../lib/spare-parts";

// The spare parts lists the part picker ticks from (app/api/spare-parts).

export const listSpareParts = async (list: SparePumpKind): Promise<SparePart[]> => {
  const { data } = await apiClient.get<SparePart[]>("/spare-parts", { params: { list } });
  return data;
};

/** A part named under Others joins the list; already there, that one comes back. */
export const addSparePart = async (list: SparePumpKind, partNo: string, partName: string): Promise<SparePart> => {
  const { data } = await apiClient.post<SparePart>("/spare-parts", { list, partNo, partName });
  return data;
};

export const updateSparePart = async (id: string, partNo: string, partName: string): Promise<SparePart> => {
  const { data } = await apiClient.patch<SparePart>(`/spare-parts/${id}`, { partNo, partName });
  return data;
};

export const deleteSparePart = async (id: string): Promise<void> => {
  await apiClient.delete(`/spare-parts/${id}`);
};
