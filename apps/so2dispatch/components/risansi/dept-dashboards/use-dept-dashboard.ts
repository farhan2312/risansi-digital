"use client";

import { useMemo, useState } from "react";
import type { OrderOverviewRow } from "@/lib/orders";
import type { DeptCompletion } from "@/lib/dept-completion";
import { DEPT_VIEWS, type DeptKey } from "@/lib/dept-view";
import {
  DATE_PRESETS,
  PAST_PRESETS,
  daysFromToday,
  presetRange,
  todayIso,
  type DatePreset,
} from "./dates";

const PAGE_SIZE = 15;

/** What every department dashboard is handed by the page. */
export type DeptDashboardProps = {
  rows: OrderOverviewRow[];
  completions?: DeptCompletion[];
  /** Where a row opens — the department's own workspace. */
  workspaceHref?: string | null;
};

/**
 * Anything a department wants on top of the shared filters: its own predicate,
 * whether that predicate is currently narrowing anything (so "Clear all"
 * appears), and how to reset it.
 */
export type DeptExtras = {
  filter?: (row: OrderOverviewRow) => boolean;
  active?: boolean;
  onClear?: () => void;
};

/**
 * The whole state of one department's dashboard: which rows are theirs, the
 * filters over them, the counts, and the paging. Each department composes its
 * own page out of this — the shared parts read it, and nothing here knows
 * which department it is beyond the DeptView it was given.
 */
export function useDeptDashboard(
  dept: DeptKey,
  { rows: allRows, completions = [], workspaceHref }: DeptDashboardProps,
  extras: DeptExtras = {}
) {
  const view = DEPT_VIEWS[dept];

  const [text, setText] = useState("");
  const [zones, setZones] = useState<string[]>([]);
  const [reps, setReps] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [signOff, setSignOff] = useState<string | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const signedBy = useMemo(() => {
    const map = new Map<string, DeptCompletion>();
    for (const c of completions) {
      if (c.dept !== view.key) continue;
      map.set(c.item_id ?? c.order_id, c);
    }
    return map;
  }, [completions, view.key]);

  /** The rows this department actually works on. */
  const mine = useMemo(() => {
    // Per-EC departments work on ECs; the SO-scope ones see each order once,
    // so an order's ECs must not multiply its row.
    if (view.perEc) return allRows.filter((r) => r.id !== null);
    const seen = new Set<string>();
    return allRows.filter((r) => {
      if (seen.has(r.order_id)) return false;
      seen.add(r.order_id);
      return true;
    });
  }, [allRows, view.perEc]);

  const signOffOf = (r: OrderOverviewRow) =>
    signedBy.get((view.perEc ? r.id : r.order_id) ?? "") ?? null;

  // A department with no deadline of its own filters by when the order came
  // in instead — the presets stay useful either way.
  const dateOf = (r: OrderOverviewRow) =>
    view.hasTarget ? view.target(r) : r.so_date;
  const dateLabel = view.hasTarget ? "Target date" : "SO date";
  const presets = view.hasTarget ? DATE_PRESETS : PAST_PRESETS;

  // Facet options come from the rows themselves, so a value nobody uses never
  // appears in the dropdown.
  const optionsOf = (pick: (r: OrderOverviewRow) => string | null) =>
    [...new Set(mine.map(pick).filter((v): v is string => !!v?.trim()))].sort();

  const options = {
    zones: optionsOf((r) => r.zone),
    reps: optionsOf((r) => r.reps),
    types: optionsOf((r) => r.item_type ?? r.order_type),
    terms: optionsOf((r) => r.payment_terms),
    statuses: [...new Set(mine.map(view.status))].sort(),
  };

  // Filtering a few hundred rows costs nothing, so it runs plainly on each
  // render — a memo here would only add a dependency list to get wrong once a
  // department layers its own predicate on top.
  const needle = text.trim().toLowerCase();
  const has = (v: string | null, list: string[]) =>
    list.length === 0 || (v ? list.includes(v.trim()) : false);

  const rows = mine.filter((r) => {
    if (needle) {
      const hay = [r.so_no, r.ec_no, r.client_name, r.client_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (!has(r.zone, zones)) return false;
    if (!has(r.reps, reps)) return false;
    if (!has(r.item_type ?? r.order_type, types)) return false;
    if (status && view.status(r) !== status) return false;

    const signed = signOffOf(r);
    if (signOff === "Signed off" && !signed) return false;
    if (signOff === "Not signed off" && signed) return false;

    if (fromDate || toDate) {
      const d = dateOf(r) ?? "";
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
    }
    return extras.filter ? extras.filter(r) : true;
  });

  const filterActive =
    !!text.trim() ||
    zones.length > 0 ||
    reps.length > 0 ||
    types.length > 0 ||
    !!status ||
    !!signOff ||
    !!fromDate ||
    !!toDate ||
    !!extras.active;

  function applyPreset(next: string | null) {
    setPreset(next);
    setPage(1);
    if (!next) {
      setFromDate("");
      setToDate("");
      return;
    }
    const [from, to] = presetRange(next as DatePreset);
    setFromDate(from);
    setToDate(to);
  }

  function clearFilters() {
    setText("");
    setZones([]);
    setReps([]);
    setTypes([]);
    setStatus(null);
    setSignOff(null);
    setPreset(null);
    setFromDate("");
    setToDate("");
    setPage(1);
    extras.onClear?.();
  }

  // The counts describe the department's whole plate, not its current search —
  // a filter is a way to look, not a redefinition of what is assigned.
  const today = todayIso();
  const applicable = mine.filter((r) => !view.na(r));
  const finished = applicable.filter(view.done);
  const outstanding = applicable.filter((r) => !view.done(r));
  const overdue = outstanding.filter((r) => {
    const t = view.target(r);
    return !!t && t < today;
  });
  const dueSoon = outstanding.filter((r) => {
    const t = view.target(r);
    if (!t) return false;
    const days = daysFromToday(t);
    return days >= 0 && days <= 7;
  });
  const signedOff = applicable.filter((r) => signOffOf(r)).length;

  /** Newest first — what the department has closed off lately. */
  const recentSignOffs = mine
    .map((row) => ({ row, done: signOffOf(row) }))
    .filter((x): x is { row: OrderOverviewRow; done: DeptCompletion } => !!x.done)
    .sort((a, b) => (a.done.completed_on < b.done.completed_on ? 1 : -1))
    .slice(0, 6);

  const statusBars = [...new Set(mine.map(view.status))]
    .map((label) => ({
      label,
      count: mine.filter((r) => view.status(r) === label).length,
      done: mine.some((r) => view.status(r) === label && view.done(r)),
    }))
    .sort((a, b) => b.count - a.count);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const rowHref = (r: OrderOverviewRow) =>
    workspaceHref
      ? `${workspaceHref}?edit=${view.perEc ? (r.id ?? r.order_id) : r.order_id}`
      : `/risansi/orders/${r.order_id}`;

  return {
    view,
    mine,
    rows,
    pageRows,
    rowHref,
    signOffOf,
    today,
    stats: {
      applicable,
      finished,
      outstanding,
      overdue,
      dueSoon,
      signedOff,
      recentSignOffs,
      statusBars,
    },
    filters: {
      text,
      setText,
      zones,
      setZones,
      reps,
      setReps,
      types,
      setTypes,
      status,
      setStatus,
      signOff,
      setSignOff,
      preset,
      applyPreset,
      presets,
      fromDate,
      setFromDate,
      toDate,
      setToDate,
      dateLabel,
      options,
      filterActive,
      clearFilters,
    },
    paging: {
      page: current,
      setPage,
      totalPages,
      from: rows.length === 0 ? 0 : (current - 1) * PAGE_SIZE + 1,
      to: Math.min(current * PAGE_SIZE, rows.length),
      total: rows.length,
    },
  };
}

export type DeptDashboard = ReturnType<typeof useDeptDashboard>;
