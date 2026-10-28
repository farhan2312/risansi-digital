// What the Orders list's pop-ups read about one SO, kept a few seconds in the
// browser: the read starts as the pointer rests on a row (Order details) and
// as the details open (the form's Edit), so the click finds it ready. The
// list drops it all whenever it refreshes, and the form reads afresh after a
// save.

import { getOrderCoreAction, getOrderQuickViewAction } from "@/app/risansi/orders/actions";

type Core = Awaited<ReturnType<typeof getOrderCoreAction>>;
type QuickView = Awaited<ReturnType<typeof getOrderQuickViewAction>>;

/** Long enough to bridge a hover and a click, short enough not to show old values. */
const TTL_MS = 20_000;

type Entry<T> = { at: number; promise: Promise<T> };
const cores = new Map<string, Entry<Core>>();
const quickViews = new Map<string, Entry<QuickView>>();

function cached<T>(map: Map<string, Entry<T>>, id: string, load: () => Promise<T>, fresh: boolean): Promise<T> {
  const hit = map.get(id);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = load();
  map.set(id, { at: Date.now(), promise });
  // A failed read is not kept.
  promise.catch(() => map.get(id)?.promise === promise && map.delete(id));
  return promise;
}

/** The SO's Order details (the details pop-up). */
export const loadOrderCore = (id: string, fresh = false) => cached(cores, id, () => getOrderCoreAction(id), fresh);

/** The SO and its target dates' history (the Order details form and the SO pop-ups). */
export const loadOrderQuickView = (id: string, fresh = false) =>
  cached(quickViews, id, () => getOrderQuickViewAction(id), fresh);

/** Forget everything read: the list has refreshed, so any of it may be old. */
export function clearOrderPrefetch(): void {
  cores.clear();
  quickViews.clear();
}
