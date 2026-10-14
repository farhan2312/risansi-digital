// Reading an SO's readiness history: which entries moved the date, which
// changed the status, and how often each happened. One reading for the
// history popup and the Planning PDF, so their counts always agree.
//
// Plain module (no server imports).

import type { ReadyLotEvent } from "@/lib/orders";

/** What one entry did. */
export type HistoryKind = "date" | "status" | "first" | "cleared" | "added" | "removed" | "recorded";

/** The same change saved again (EC by EC, or twice in a row) is one entry. */
export type HistoryEntry = { e: ReadyLotEvent; times: number };

/** The history newest first, with repeats of one change folded together. */
export function collapseHistory(events: ReadyLotEvent[]): HistoryEntry[] {
  const key = (e: ReadyLotEvent) =>
    [e.lot_no, e.action, e.prev_status, e.status, e.prev_ready_date?.slice(0, 10), e.ready_date?.slice(0, 10)].join("|");
  const out: HistoryEntry[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && key(last.e) === key(e)) last.times += 1;
    else out.push({ e, times: 1 });
  }
  return out;
}

/**
 * Each entry's kinds, read along the timeline (oldest first): the SO's date
 * moved when a date is given that differs from the last date it had — even
 * with a blank or a new lot in between — and likewise its status.
 */
export function tagHistory(entries: HistoryEntry[]): Map<HistoryEntry, HistoryKind[]> {
  const tags = new Map<HistoryEntry, HistoryKind[]>();
  let lastDate: string | null = null;
  let lastStatus: string | null = null;
  for (const x of [...entries].reverse()) {
    const e = x.e;
    const kinds: HistoryKind[] = [];
    if (e.action === "recorded" || e.action === "added" || e.action === "removed") kinds.push(e.action);
    if (e.action !== "removed") {
      const d = e.ready_date ? e.ready_date.slice(0, 10) : null;
      if (d) {
        if (lastDate && d !== lastDate) kinds.push("date");
        else if (!lastDate && e.action !== "recorded") kinds.push("first");
        lastDate = d;
      } else if (e.prev_ready_date && e.action !== "added") kinds.push("cleared");
      const st = e.status ?? null;
      if (st) {
        if (lastStatus && st !== lastStatus) kinds.push("status");
        lastStatus = st;
      }
    }
    tags.set(x, kinds);
  }
  return tags;
}

/**
 * The history in brief: how often the date moved and the status changed, and
 * the dates the SO has had, oldest first ("03 Oct → 06 Oct → 18 Sept").
 */
export function readinessSummary(events: ReadyLotEvent[]): {
  dateMoves: number;
  statusChanges: number;
  dates: string[];
} {
  const entries = collapseHistory(events);
  const tags = tagHistory(entries);
  const dates: string[] = [];
  for (const x of [...entries].reverse()) {
    const d = x.e.action === "removed" ? null : x.e.ready_date?.slice(0, 10);
    if (d && dates[dates.length - 1] !== d) dates.push(d);
  }
  return {
    dateMoves: entries.filter((x) => tags.get(x)!.includes("date")).length,
    statusChanges: entries.filter((x) => tags.get(x)!.includes("status")).length,
    dates,
  };
}
