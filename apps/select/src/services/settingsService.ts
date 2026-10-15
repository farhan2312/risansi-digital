import apiClient from "./apiClient";

export type UsdInrSetting = {
  rate: number | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** The current USD -> INR rate (sidebar > USD to INR). */
export const getUsdInrSetting = async (): Promise<UsdInrSetting> => {
  const { data } = await apiClient.get<UsdInrSetting>("/settings/usd-inr");
  return data;
};

/** Saves the rate (any signed-in user). */
export const saveUsdInrRate = async (rate: number): Promise<UsdInrSetting> => {
  const { data } = await apiClient.put<{ setting: UsdInrSetting }>("/settings/usd-inr", { rate });
  return data.setting;
};
