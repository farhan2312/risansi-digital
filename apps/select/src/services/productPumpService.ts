import apiClient from "./apiClient";

export interface ProductPump {
  productCode: string;
  pumpType: string;
}

/** Every pump product code (PCP), A–Z. */
export const listProductPumps = async (): Promise<ProductPump[]> => {
  const { data } = await apiClient.get<ProductPump[]>("/product-pumps");
  return data;
};

/** Adds a product code that isn't in the master yet (as PCP); returns the
 *  stored code (an existing one in any case comes back unchanged). */
export const addProductPump = async (productCode: string): Promise<ProductPump> => {
  const { data } = await apiClient.post<ProductPump>("/product-pumps", { productCode });
  return data;
};
