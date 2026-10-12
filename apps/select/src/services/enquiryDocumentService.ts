import apiClient from "./apiClient";
import type { TechDocConfig, TechDocData, TechDocVersion } from "../lib/tech-doc";

/** The enquiry's Technical Data Sheet data (confirmed tags, current wizard data). */
export const getEnquiryDocument = async (projectId: string): Promise<TechDocData> => {
  const { data } = await apiClient.get<TechDocData>("/enquiry-document", { params: { projectId } });
  return data;
};

/** Saves one drive group's sheet customisation (replace-all); returns it cleaned. */
export const saveEnquiryDocumentConfig = async (
  projectId: string,
  group: string,
  config: TechDocConfig,
): Promise<TechDocConfig> => {
  const { data } = await apiClient.put<{ config: TechDocConfig }>("/enquiry-document", { projectId, group, config });
  return data.config;
};

/** Every sent version of the enquiry's Technical Data Sheets, newest first. */
export const listTechDocVersions = async (projectId: string): Promise<TechDocVersion[]> => {
  const { data } = await apiClient.get<TechDocVersion[]>("/enquiry-document/versions", { params: { projectId } });
  return data;
};

/** "Send to client": freezes the group's sheet as the next Client version. */
export const sendTechDocToClient = async (projectId: string, group: string, note: string): Promise<TechDocVersion[]> => {
  const { data } = await apiClient.post<TechDocVersion[]>("/enquiry-document/versions", { projectId, group, note });
  return data;
};
