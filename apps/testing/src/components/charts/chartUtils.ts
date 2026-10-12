"use client";

import { useEffect, useRef, useState } from "react";

/** Clean, round y-axis ticks (0 / 5 / 10 ...) covering 0..max. */
export const niceTicks = (max: number, count = 4): number[] => {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Charts bucket by month ("2026-03") or, for short windows, by day ("2026-03-14"). */
const isDayKey = (key: string) => key.length === 10;

/** "2026-03" -> "Mar" (or "Mar '26" with the year); "2026-03-14" -> "14" (or "14 Mar" when `withYear`, i.e. at a boundary). */
export const monthLabel = (key: string, withYear = false): string => {
  const [y, m, d] = key.split("-");
  const name = MONTHS[Number(m) - 1] ?? key;
  if (isDayKey(key)) return withYear ? `${Number(d)} ${name}` : String(Number(d));
  return withYear ? `${name} '${y.slice(2)}` : name;
};

/** "2026-03" -> "March 2026", "2026-03-14" -> "14 March 2026" for tooltips. */
export const monthLong = (key: string): string => {
  const [y, m, d] = key.split("-");
  return new Intl.DateTimeFormat("en-GB", isDayKey(key) ? { day: "numeric", month: "long", year: "numeric" } : { month: "long", year: "numeric" }).format(
    new Date(Number(y), Number(m) - 1, isDayKey(key) ? Number(d) : 1)
  );
};

export const compactNumber = (n: number): string =>
  new Intl.NumberFormat("en-IN", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);

/** Live pixel width of a container -- charts draw at real pixel size so
 * hairlines stay 1px and text never scales with the viewBox. */
export const useElementWidth = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};
