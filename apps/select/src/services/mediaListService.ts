import apiClient from "./apiClient";

/** Media / Application options for the General Information dropdown, from
 * the media_list reference table (industry + media only — no MOC
 * recommendation data). */
export const listMedia = async (): Promise<string[]> => {
  const { data } = await apiClient.get<string[]>("/media-list");
  return data;
};

/** Server-side search of the media list: names containing `q`, those
 *  starting with it first. */
/** An empty `q` gives the first names A-Z. */
export const searchMedia = async (q: string, signal?: AbortSignal): Promise<string[]> => {
  // Browsing (no text) shows a longer scrollable list than a search does.
  const limit = q.trim() ? 20 : 50;
  const { data } = await apiClient.get<string[]>("/media-list", { params: { q, limit }, signal });
  return data;
};

/** Adds a media a user typed manually via "Other" so it's available in the
 * dropdown for everyone afterwards. A repeat of an existing media is a
 * no-op server-side (upsert on the unique media column). */
export const addMedia = async (media: string): Promise<void> => {
  await apiClient.post("/media-list", { media });
};
