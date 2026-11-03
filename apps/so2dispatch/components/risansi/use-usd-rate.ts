"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { usdInrRateAction } from "@/app/risansi/orders/actions";
import { isUsd, withValueRules } from "@/lib/order-schema";

/**
 * A form's order once it is in USD with no rate of its own yet: the rate it will
 * convert at, so its gross in INR shows before the save.
 */
export function useUsdRate<T extends Record<string, unknown>>(currency: unknown, setValues: Dispatch<SetStateAction<T>>) {
  const usd = isUsd(currency);
  useEffect(() => {
    if (!usd) return;
    let live = true;
    usdInrRateAction().then((rate) => {
      if (!live || rate === null) return;
      setValues((prev) =>
        String(prev.order_fx_rate ?? "").trim()
          ? prev
          : withValueRules({ ...prev, order_fx_rate: String(rate) }, "order_currency", String(prev.order_currency ?? ""))
      );
    });
    return () => {
      live = false;
    };
  }, [usd, setValues]);
}
