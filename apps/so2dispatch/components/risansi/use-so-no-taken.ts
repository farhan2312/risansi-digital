"use client";

import { useEffect, useState } from "react";
import { soNoTakenAction } from "@/app/risansi/orders/actions";
import { withoutBarePrefix } from "@/lib/order-schema";

/**
 * Another SO already carrying this SO No. ("Sl. 512"), checked a moment after
 * typing stops; null when none. A warning only — the form still saves.
 */
export function useSoNoTaken(soNo: string, exceptOrderId: string | null): string | null {
  const [taken, setTaken] = useState<{ for: string; by: string | null } | null>(null);
  const v = withoutBarePrefix("so_no", soNo);
  useEffect(() => {
    if (!v) return;
    let live = true;
    const timer = setTimeout(() => {
      soNoTakenAction(v, exceptOrderId)
        .then((by) => live && setTaken({ for: v, by }))
        .catch(() => {});
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [v, exceptOrderId]);
  // Only the answer for what the box holds now.
  return v && taken?.for === v ? taken.by : null;
}
