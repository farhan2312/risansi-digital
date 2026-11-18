import { isRetrofitSpare } from "@/lib/order-schema";

/** Under a Spare SO's Order Type: "Retrofit" when it is a Retrofit Spare. */
export function RetrofitLine({ row }: { row: object }) {
  if (!isRetrofitSpare(row)) return null;
  return <span className="block text-[11px] font-medium text-violet-700 dark:text-violet-300">Retrofit</span>;
}
