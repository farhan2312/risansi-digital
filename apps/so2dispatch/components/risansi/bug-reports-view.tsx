"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ExternalLink,
  Image as ImageIcon,
  Lightbulb,
  List,
  Loader2,
  Search,
  X,
} from "lucide-react";
import type { BugReportRow, BugStatus } from "@/lib/bug-reports";
import { updateBugReportStatusAction } from "@/app/risansi/bug-reports/actions";

// Display-only rename: DB status "wont_fix" surfaces as "Closed" in the UI.
const STATUS_OPTIONS: { value: BugStatus; label: string; tone: string }[] = [
  { value: "open", label: "Open", tone: "bg-blue-50 text-blue-700" },
  {
    value: "need_clarification",
    label: "Need clarification",
    tone: "bg-cyan-50 text-cyan-700",
  },
  { value: "in_progress", label: "In progress", tone: "bg-amber-50 text-amber-700" },
  { value: "resolved", label: "Resolved", tone: "bg-emerald-50 text-emerald-700" },
  { value: "wont_fix", label: "Closed", tone: "bg-slate-100 text-slate-600" },
];

const statusMeta = (s: BugStatus) =>
  STATUS_OPTIONS.find((o) => o.value === s) ?? STATUS_OPTIONS[0];

type StatusFilter = "all" | BugStatus;
const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "need_clarification", label: "Need clarification" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "wont_fix", label: "Closed" },
];

const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;

const SEVERITY_TONES: Record<string, string> = {
  Low: "bg-slate-100 text-slate-600",
  Medium: "bg-blue-50 text-blue-700",
  High: "bg-amber-50 text-amber-700",
  Critical: "bg-rose-50 text-rose-700",
};

/** Critical first; a report with no severity goes after Low. */
const severityRank = (s: string | null) => {
  const i = SEVERITIES.indexOf((s ?? "") as (typeof SEVERITIES)[number]);
  return i < 0 ? SEVERITIES.length : i;
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function KindIcon({ kind, size = "md" }: { kind: BugReportRow["kind"]; size?: "sm" | "md" }) {
  const isFeature = kind === "feature";
  const box = size === "sm" ? "h-6 w-6 rounded-md" : "h-8 w-8 rounded-lg";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${box} ${
        isFeature ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"
      }`}
      title={isFeature ? "Feature request" : "Bug"}
    >
      {isFeature ? <Lightbulb className={icon} /> : <Bug className={icon} />}
    </span>
  );
}

function SeverityChip({ severity }: { severity: string | null }) {
  if (!severity) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        SEVERITY_TONES[severity] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {severity}
    </span>
  );
}

function StatusButtons({
  row,
  saving,
  onChange,
}: {
  row: BugReportRow;
  saving: boolean;
  onChange: (status: BugStatus) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Status
      </span>
      {STATUS_OPTIONS.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          disabled={saving || s.value === row.status}
          className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-60 ${
            s.value === row.status
              ? s.tone
              : "border border-input-border text-foreground hover:bg-background"
          }`}
        >
          {saving && s.value !== row.status && <Loader2 className="h-3 w-3 animate-spin" />}
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** The status as a chip — what a reporter sees in place of the controls. */
function StatusChip({ status }: { status: BugStatus }) {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>
      {meta.label}
    </span>
  );
}

function Details({ row }: { row: BugReportRow }) {
  return (
    <>
      {row.description ? (
        <p className="whitespace-pre-wrap text-sm text-foreground">{row.description}</p>
      ) : (
        <p className="text-sm text-muted">No description provided.</p>
      )}
      {row.screenshot_name && (
        <a
          href={`/api/bug-reports/${row.id}/screenshot`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-input-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          {row.screenshot_name}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/**
 * The board's four columns. Need Clarification holds reports waiting on
 * their reporter. Resolved and Closed share the last one: both mean nobody
 * has anything left to do, and apart they would be two columns that only ever
 * grow.
 */
const COLUMNS: {
  key: "open" | "need_clarification" | "in_progress" | "done";
  label: string;
  statuses: BugStatus[];
  /** What a card dropped here becomes. */
  dropAs: BugStatus;
  /** The header dot, in the same hue as the status chips. */
  dot: string;
}[] = [
  { key: "open", label: "Open", statuses: ["open"], dropAs: "open", dot: "bg-blue-600" },
  {
    key: "need_clarification",
    label: "Need Clarification",
    statuses: ["need_clarification"],
    dropAs: "need_clarification",
    dot: "bg-cyan-500",
  },
  {
    key: "in_progress",
    label: "In progress",
    statuses: ["in_progress"],
    dropAs: "in_progress",
    dot: "bg-amber-600",
  },
  {
    key: "done",
    label: "Resolved / Closed",
    statuses: ["resolved", "wont_fix"],
    dropAs: "resolved",
    dot: "bg-emerald-500",
  },
];

/**
 * Three steps of ground, so page, column and card never merge: the page; the
 * column, the page with a little of the text colour mixed in (a step darker in
 * light mode, a step lighter in dark); and the card — white in light mode, and
 * in dark a further step lighter than its column.
 */
const COLUMN_BG =
  "bg-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] dark:bg-[color-mix(in_oklab,var(--foreground)_8%,var(--background))]";
const CARD_BG = "bg-surface dark:bg-[color-mix(in_oklab,var(--foreground)_17%,var(--background))]";

/** Cards a column shows at first, and adds each time its foot scrolls into view. */
const COLUMN_BATCH = 10;

/**
 * One column's cards, ten at a time: the column scrolls on its own, and
 * reaching its foot brings the next ten. Every report is already loaded, so
 * this only paces what is drawn — a long Resolved / Closed column no longer
 * stretches the page past the others.
 */
function ColumnCards({
  cards,
  render,
}: {
  cards: BugReportRow[];
  render: (row: BugReportRow) => React.ReactNode;
}) {
  const [shown, setShown] = useState(COLUMN_BATCH);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const footRef = useRef<HTMLDivElement | null>(null);
  const more = shown < cards.length;

  useEffect(() => {
    const foot = footRef.current;
    if (!foot || !more) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShown((n) => n + COLUMN_BATCH);
      },
      { root: scrollRef.current, rootMargin: "80px" }
    );
    observer.observe(foot);
    return () => observer.disconnect();
  }, [more, shown]);

  return (
    <div
      ref={scrollRef}
      // relative: the cards' visually-hidden labels are absolutely positioned,
      // and must be clipped by this box, not stretch the page past it.
      className="relative -mr-1 max-h-[70vh] overflow-y-auto pr-1 xl:max-h-none xl:min-h-0 xl:flex-1"
    >
      <ul className="space-y-2">{cards.slice(0, shown).map(render)}</ul>
      <div ref={footRef} className="h-px" aria-hidden />
      {cards.length > COLUMN_BATCH && (
        <p className="pt-2 text-center text-[11px] text-muted">
          {more
            ? `${Math.min(shown, cards.length)} of ${cards.length} — scroll for more`
            : `All ${cards.length} shown`}
        </p>
      )}
    </div>
  );
}

function BoardCard({
  row,
  saving,
  readOnly,
  onOpen,
  onChange,
  onDragStart,
}: {
  row: BugReportRow;
  saving: boolean;
  /** The reporter's own view: the status shows, nothing moves. */
  readOnly: boolean;
  onOpen: () => void;
  onChange: (status: BugStatus) => void;
  onDragStart: (e: DragEvent) => void;
}) {
  const meta = statusMeta(row.status);
  return (
    <li
      draggable={!saving && !readOnly}
      onDragStart={readOnly ? undefined : onDragStart}
      className={`group rounded-lg border border-card-border ${CARD_BG} p-3 shadow-sm transition-shadow hover:shadow-md ${
        saving ? "opacity-60" : readOnly ? "" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-start gap-2">
          <KindIcon kind={row.kind} size="sm" />
          <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium text-foreground">
            {row.title}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <SeverityChip severity={row.severity} />
          {/* Done holds two outcomes; the chip says which. */}
          {(row.status === "resolved" || row.status === "wont_fix") && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.tone}`}>
              {meta.label}
            </span>
          )}
          {row.screenshot_name && (
            <ImageIcon className="h-3.5 w-3.5" aria-label="Has a screenshot" />
          )}
          <span className="ml-auto whitespace-nowrap">{timeAgo(row.created_at)}</span>
        </div>
        {(row.user_email || row.page_path) && (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            {row.user_email && <span className="truncate">{row.user_email}</span>}
            {row.page_path && (
              <span className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                {row.page_path}
              </span>
            )}
          </div>
        )}
      </button>

      {/* Dragging needs a mouse; this does the same on a phone or keyboard. */}
      {!readOnly && (
      <div className="mt-2 flex items-center justify-end border-t border-card-border pt-2">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
        ) : (
          <label className="inline-flex items-center gap-1 text-[11px] text-muted">
            <span className="sr-only">Move to</span>
            <select
              value={row.status}
              onChange={(e) => onChange(e.target.value as BugStatus)}
              className="h-6 rounded-md border border-input-border bg-surface px-1.5 text-[11px] text-foreground"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      )}
    </li>
  );
}

function Board({
  rows,
  savingId,
  readOnly,
  filterKey,
  onChange,
  onOpen,
}: {
  rows: BugReportRow[];
  savingId: string | null;
  readOnly: boolean;
  /** Changes when search or filters do, so each column starts again at ten. */
  filterKey: string;
  onChange: (id: string, status: BugStatus) => void;
  onOpen: (id: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-4 xl:grid-rows-[minmax(0,1fr)]">
      {COLUMNS.map((col) => {
        const cards = rows
          .filter((r) => col.statuses.includes(r.status))
          .sort((a, b) =>
            col.key === "done"
              ? // History: the latest first.
                b.created_at.localeCompare(a.created_at)
              : // Work: the worst first, then whatever has waited longest.
                severityRank(a.severity) - severityRank(b.severity) ||
                a.created_at.localeCompare(b.created_at)
          );

        return (
          <section
            key={col.key}
            aria-label={col.label}
            onDragOver={(e) => {
              if (readOnly) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(col.key);
            }}
            onDragLeave={(e) => {
              // Leaving for one of its own cards is not leaving the column.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              if (readOnly) return;
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              const row = rows.find((r) => r.id === id);
              // Already in this column (Resolved and Closed both live in Done):
              // nothing to change.
              if (!row || col.statuses.includes(row.status)) return;
              onChange(id, col.dropAs);
            }}
            className={`flex min-h-48 flex-col rounded-xl border p-3 transition-colors xl:min-h-0 ${
              over === col.key
                ? "border-primary bg-primary/10"
                : `border-card-border ${COLUMN_BG}`
            }`}
          >
            <header className="mb-3 flex shrink-0 items-center gap-2 px-1">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className={`h-2 w-2 rounded-full ${col.dot}`} aria-hidden />
                {col.label}
              </h2>
              <span className="min-w-6 rounded-full border border-card-border bg-surface px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums text-foreground">
                {cards.length}
              </span>
            </header>
            {cards.length === 0 ? (
              <p className="rounded-lg border border-dashed border-input-border px-3 py-8 text-center text-xs text-muted">
                {col.key === "done" ? "Nothing finished yet." : "Nothing here."}
              </p>
            ) : (
              <ColumnCards
                key={filterKey}
                cards={cards}
                render={(r) => (
                  <BoardCard
                    key={r.id}
                    row={r}
                    saving={savingId === r.id}
                    readOnly={readOnly}
                    onOpen={() => onOpen(r.id)}
                    onChange={(s) => onChange(r.id, s)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", r.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  />
                )}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function ReportModal({
  row,
  saving,
  readOnly,
  onChange,
  onClose,
}: {
  row: BugReportRow;
  saving: boolean;
  readOnly: boolean;
  onChange: (status: BugStatus) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={row.title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-card-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <KindIcon kind={row.kind} />
            <div className="min-w-0">
              <p className="font-display text-base font-semibold text-foreground">{row.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>{timeAgo(row.created_at)}</span>
                {row.user_email && (
                  <>
                    <span>·</span>
                    <span>{row.user_email}</span>
                  </>
                )}
                {row.page_path && (
                  <>
                    <span>·</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {row.page_path}
                    </span>
                  </>
                )}
                <SeverityChip severity={row.severity} />
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          <Details row={row} />
        </div>
        <div className="border-t border-card-border px-5 py-3">
          {readOnly ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </span>
              <StatusChip status={row.status} />
            </div>
          ) : (
            <StatusButtons row={row} saving={saving} onChange={onChange} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List — the earlier view, kept for history and looking things up
// ---------------------------------------------------------------------------

/** Reports a page of the list shows. */
const LIST_PAGE_SIZE = 20;

/**
 * Numbered pages for the list, in the same form as the app's other tables.
 * Every report is already loaded, so paging is local — no round trip.
 */
function ListPager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  if (total === 0) return null;
  const from = (page - 1) * LIST_PAGE_SIZE + 1;
  const to = Math.min(page * LIST_PAGE_SIZE, total);
  // A short window around the current page, so many pages don't render many chips.
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, Math.max(page + 2, 5));
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  const step =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border px-4 py-3 text-sm text-muted">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={step}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors ${
              p === page
                ? "bg-primary text-primary-foreground"
                : "border border-input-border text-foreground hover:bg-background"
            }`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className={step}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ReportList({
  rows,
  savingId,
  readOnly,
  onChange,
}: {
  rows: BugReportRow[];
  savingId: string | null;
  readOnly: boolean;
  onChange: (id: string, status: BugStatus) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const counts: Record<StatusFilter, number> = {
    all: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    need_clarification: rows.filter((r) => r.status === "need_clarification").length,
    in_progress: rows.filter((r) => r.status === "in_progress").length,
    resolved: rows.filter((r) => r.status === "resolved").length,
    wont_fix: rows.filter((r) => r.status === "wont_fix").length,
  };
  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  // A move can take the last report off the page; land on the last page left.
  const pageCount = Math.max(1, Math.ceil(visible.length / LIST_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pageRows = visible.slice(
    (current - 1) * LIST_PAGE_SIZE,
    current * LIST_PAGE_SIZE
  );

  return (
    <>
      <div className="mb-4 inline-flex flex-wrap gap-1 rounded-full bg-background p-1">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setFilter(f.value);
                setPage(1);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
              aria-pressed={active}
            >
              {f.label}
              <span
                className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                  active
                    ? "bg-white/25 text-primary-foreground"
                    : "bg-card-border text-muted-foreground"
                }`}
              >
                {counts[f.value]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        {visible.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-foreground">Nothing here</p>
            <p className="mt-1 text-sm text-muted">No reports match this filter.</p>
          </div>
        ) : (
          <ul className="divide-y divide-card-border">
            {pageRows.map((r) => {
              const isOpen = open.has(r.id);
              const meta = statusMeta(r.status);
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <KindIcon kind={r.kind} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{r.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span>{timeAgo(r.created_at)}</span>
                          {r.user_email && (
                            <>
                              <span>·</span>
                              <span>{r.user_email}</span>
                            </>
                          )}
                          {r.page_path && (
                            <>
                              <span>·</span>
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                                {r.page_path}
                              </span>
                            </>
                          )}
                          <SeverityChip severity={r.severity} />
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}
                      >
                        {meta.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(r.id)}
                        aria-expanded={isOpen}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
                      >
                        Details
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-4 space-y-4 rounded-lg bg-background/40 p-4">
                      <Details row={r} />
                      {!readOnly && (
                        <div className="pt-1">
                          <StatusButtons
                            row={r}
                            saving={savingId === r.id}
                            onChange={(s) => onChange(r.id, s)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ListPager page={current} total={visible.length} onPage={setPage} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The page body: filters shared by both views, and the switch between them
// ---------------------------------------------------------------------------

type View = "board" | "list";
const VIEW_KEY = "bug-tracker-view";

export function BugReportsView({
  rows,
  readOnly = false,
  initialOpenId = null,
}: {
  rows: BugReportRow[];
  /**
   * The reporter's view of their own reports: statuses show, nothing moves.
   * Changing a status is the admin's alone (and the action says so too).
   */
  readOnly?: boolean;
  /** A report to open on arrival — where a notification about it links. */
  initialOpenId?: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("board");
  const [kind, setKind] = useState<"all" | BugReportRow["kind"]>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [error, setError] = useState<string | null>(null);
  // A move shows straight away; the server's answer confirms or undoes it.
  // Each is kept with the status it moved from, and applies only while the
  // server still reports that — so once the page data catches up (or someone
  // else moves the card) the server's status wins without clearing anything.
  const [moved, setMoved] = useState<Record<string, { from: BugStatus; to: BugStatus }>>({});

  // The last view chosen, on this browser. Read after mounting so the server
  // render and the first client render agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a stored preference
      if (saved === "list" || saved === "board") setView(saved);
    } catch {
      // storage unavailable: keep the board
    }
  }, []);

  function chooseView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // not remembered, still switched
    }
  }

  const current = useMemo(
    () =>
      rows.map((r) =>
        moved[r.id]?.from === r.status ? { ...r, status: moved[r.id].to } : r
      ),
    [rows, moved]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return current.filter(
      (r) =>
        (kind === "all" || r.kind === kind) &&
        (severity === "all" || (r.severity ?? "none") === severity) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          (r.user_email ?? "").toLowerCase().includes(q) ||
          (r.page_path ?? "").toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q))
    );
  }, [current, kind, severity, search]);

  async function changeStatus(id: string, status: BugStatus) {
    const before = current.find((r) => r.id === id)?.status;
    const serverStatus = rows.find((r) => r.id === id)?.status;
    if (!before || !serverStatus || before === status) return;
    setError(null);
    setMoved((m) => ({ ...m, [id]: { from: serverStatus, to: status } }));
    setSavingId(id);
    const res = await updateBugReportStatusAction(id, status);
    setSavingId(null);
    if (!res.ok) {
      setMoved((m) => {
        const rest = { ...m };
        delete rest[id];
        return rest;
      });
      setError(res.error);
      return;
    }
    // Also refreshes the open-report count in the top bar.
    router.refresh();
  }

  const openRow = openId ? current.find((r) => r.id === openId) ?? null : null;
  const filtering = kind !== "all" || severity !== "all" || search.trim() !== "";

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-surface px-6 py-16 text-center shadow-sm">
        <p className="text-sm font-medium text-foreground">No reports yet</p>
        <p className="mt-1 text-sm text-muted">
          {readOnly
            ? "Bugs and ideas you send with the “Report a Bug” button will show here, with where each one stands."
            : "Submissions from the “Report a Bug” button will show here."}
        </p>
      </div>
    );
  }

  return (
    // On a wide screen the tracker fits the window: the page holds still and
    // each column (or the list) scrolls inside it.
    <div
      className="flex flex-col xl:min-h-0 xl:flex-1"
      // The page fits the window only for the board (see bug-reports/page.tsx);
      // the list scrolls with the page and pages through its reports.
      data-board-fit={view === "board" ? "" : undefined}
    >
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, reporter, page…"
            aria-label="Search reports"
            className="h-9 w-full rounded-lg border border-input-border bg-surface pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          aria-label="Type"
          className="h-9 rounded-lg border border-input-border bg-surface px-2 text-sm text-foreground"
        >
          <option value="all">Bugs & features</option>
          <option value="bug">Bugs</option>
          <option value="feature">Feature requests</option>
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          aria-label="Severity"
          className="h-9 rounded-lg border border-input-border bg-surface px-2 text-sm text-foreground"
        >
          <option value="all">Any severity</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="none">No severity</option>
        </select>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setKind("all");
              setSeverity("all");
              setSearch("");
            }}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}

        <div
          role="group"
          aria-label="View"
          className="ml-auto inline-flex rounded-lg border border-input-border bg-surface p-0.5"
        >
          {(
            [
              { key: "board", label: "Board", Icon: Columns3 },
              { key: "list", label: "List", Icon: List },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => chooseView(key)}
              aria-pressed={view === key}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                view === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {filtering && (
        <p className="mb-3 text-xs text-muted">
          {filtered.length} of {rows.length} reports match.
        </p>
      )}

      {view === "board" ? (
        <Board
          rows={filtered}
          savingId={savingId}
          readOnly={readOnly}
          filterKey={`${kind}|${severity}|${search.trim()}`}
          onChange={changeStatus}
          onOpen={setOpenId}
        />
      ) : (
        <ReportList
          // Search or filters changing starts the list again at page one.
          key={`${kind}|${severity}|${search.trim()}`}
          rows={filtered}
          savingId={savingId}
          readOnly={readOnly}
          onChange={changeStatus}
        />
      )}

      {openRow && (
        <ReportModal
          row={openRow}
          saving={savingId === openRow.id}
          readOnly={readOnly}
          onChange={(s) => changeStatus(openRow.id, s)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
