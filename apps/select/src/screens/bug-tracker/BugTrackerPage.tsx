"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import EmptyState from "../../components/ui/EmptyState";
import Pagination from "../../components/ui/Pagination";
import {
  getBugReportScreenshotUrl,
  listBugReports,
  updateBugReportStatus,
  type BugReportQuery,
  type BugReportRow,
  type BugReportSeverity,
  type BugReportSummary,
  type BugReportStatus,
  type BugReportType,
} from "../../services/bugReportService";

// Board columns, left to right. "Resolved" is shown as "Resolved / Closed":
// the old separate Closed status is merged into it (legacy "Closed" rows
// still show there - see columnOf).
const STATUSES: BugReportStatus[] = ["Open", "Need Clarification", "In progress", "Resolved"];
const STATUS_LABEL: Record<BugReportStatus, string> = {
  Open: "Open",
  "Need Clarification": "Need Clarification",
  "In progress": "In progress",
  Resolved: "Resolved / Closed",
};
/** The column a stored status belongs to: legacy Closed → Resolved, none/unknown → Open. */
const columnOf = (s: string | null | undefined): BugReportStatus =>
  s === "Closed" ? "Resolved" : (STATUSES as string[]).includes(s ?? "") ? (s as BugReportStatus) : "Open";
const SEVERITIES: BugReportSeverity[] = ["Critical", "High", "Medium", "Low"];
const SEVERITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
/** Board: cards shown per column at first, and added each time its end scrolls into view. */
const BOARD_BATCH = 10;
/** List: rows per page. */
const LIST_PAGE_SIZE = 20;
/** Wait this long after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 300;

type Column = { rows: BugReportRow[]; total: number; loading: boolean };
type Board = Record<BugReportStatus, Column>;
const EMPTY_BOARD = Object.fromEntries(
  STATUSES.map((s) => [s, { rows: [], total: 0, loading: false }]),
) as unknown as Board;

const isOpenStatus = (s: string | null) => {
  const c = columnOf(s);
  return c === "Open" || c === "Need Clarification" || c === "In progress";
};

/** Board column order - same as the API's order=board. */
const boardOrder = (a: BugReportRow, b: BugReportRow) =>
  (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
  b.createdAt.localeCompare(a.createdAt);

/** `value`, updated only after it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Sits at the end of a board column; when it scrolls into view the column
 * shows the next batch. `scrollRef` is that column's own scroll box, so the
 * next batch loads when you reach the end of THAT column rather than the page.
 * The button is the fallback (and keyboard path).
 */
function LoadMore({
  remaining,
  loading,
  onMore,
  scrollRef,
}: {
  remaining: number;
  loading: boolean;
  onMore: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (loading) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), {
      root: scrollRef.current,
      rootMargin: "120px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
    // Re-armed after each batch: a fresh observer reports straight away, so
    // if the column end is still on screen the next batch loads too.
  }, [onMore, remaining, loading, scrollRef]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onMore}
      disabled={loading}
      className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-[12px] font-semibold text-fg-3 transition hover:border-accent hover:text-accent"
    >
      {loading ? "Loading…" : `Show more (${remaining} left)`}
    </button>
  );
}

// Column accent + the soft chip used for that status elsewhere on the page.
const STATUS_STYLE: Record<BugReportStatus, { dot: string; chip: string; drop: string }> = {
  Open: {
    dot: "bg-[var(--brand-blue)]",
    chip: "bg-accent-soft text-accent",
    drop: "ring-[var(--brand-blue)]",
  },
  "Need Clarification": {
    dot: "bg-[var(--brand-cyan)]",
    chip: "bg-[color-mix(in_srgb,var(--brand-cyan)_16%,transparent)] text-fg",
    drop: "ring-[var(--brand-cyan)]",
  },
  "In progress": {
    dot: "bg-warn",
    chip: "bg-[var(--warn-soft)] text-warn",
    drop: "ring-[var(--warn)]",
  },
  Resolved: {
    dot: "bg-pos",
    chip: "bg-[var(--pos-soft)] text-pos",
    drop: "ring-[var(--pos)]",
  },
};

const SEVERITY_STYLE: Record<string, string> = {
  Critical: "bg-[var(--neg-soft)] text-neg",
  High: "bg-[color-mix(in_srgb,#f97316_16%,transparent)] text-[#ea580c]",
  Medium: "bg-[var(--warn-soft)] text-warn",
  Low: "bg-sunk text-fg-2",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const initials = (name: string | null) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

const TypeIcon = ({ type }: { type: BugReportType }) => (
  <span
    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px] ${
      type === "feature" ? "bg-[var(--warn-soft)]" : "bg-[var(--neg-soft)]"
    }`}
    title={type === "feature" ? "Feature request" : "Bug"}
  >
    {type === "feature" ? "💡" : "🐞"}
  </span>
);

const SeverityBadge = ({ severity }: { severity: string }) => (
  <span
    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${
      SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.Low
    }`}
  >
    {severity}
  </span>
);

// system_admin only — gated by middleware (/admin/bug-tracker) and by the
// underlying GET /api/bug-reports route itself. Search, filters and paging run
// on the server: the board asks for each column BOARD_BATCH cards at a time,
// the list one LIST_PAGE_SIZE page at a time. Lists every report filed
// from the "Report a Bug" button across the portal; changing a report's status
// here (drag to another column, or from the details popup) is what lights up
// the reporter's bell (see NotificationBell.tsx).
/**
 * `mine`: the read-only "My Bug Reports" page for every user — only the
 * reports they filed (the API scopes it), same board/list, but no dragging
 * and no status changes (triage stays with system admins).
 */
const BugTrackerPage = ({ mine = false }: { mine?: boolean }) => {
  const [summary, setSummary] = useState<BugReportSummary | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [listRows, setListRows] = useState<BugReportRow[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true); // before the first response
  const [fetching, setFetching] = useState(false); // any later refetch
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | BugReportType>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | BugReportSeverity>("all");

  const [savingId, setSavingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<BugReportStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Search goes to the server only once typing pauses.
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const filterQuery = useMemo<BugReportQuery>(
    () => ({
      q: debouncedSearch || undefined,
      type: typeFilter === "all" ? undefined : typeFilter,
      severity: severityFilter === "all" ? undefined : severityFilter,
      mine: mine ? "1" : undefined,
    }),
    [debouncedSearch, typeFilter, severityFilter, mine],
  );
  const filterKey = JSON.stringify(filterQuery);

  // Only the newest request may write state: a slow response for an old
  // filter can't overwrite a newer one.
  const reqId = useRef(0);
  // Each board column scrolls on its own; its box is what LoadMore watches.
  const colRefs = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({});
  const colRef = (status: string) => (colRefs.current[status] ??= { current: null });
  const filterRef = useRef(filterQuery);
  filterRef.current = filterQuery;
  const boardRef = useRef(board);
  boardRef.current = board;

  const fail = useCallback((id: number) => {
    if (id !== reqId.current) return;
    setError("Couldn't load bug reports.");
  }, []);
  const settle = useCallback((id: number) => {
    if (id !== reqId.current) return;
    setIsLoading(false);
    setFetching(false);
  }, []);

  // Board: the first BOARD_BATCH cards of every column, whenever the board
  // opens or the filters change.
  useEffect(() => {
    if (view !== "board") return;
    const id = ++reqId.current;
    setFetching(true);
    Promise.all(
      STATUSES.map((status) =>
        listBugReports({ ...filterQuery, status, order: "board", offset: 0, limit: BOARD_BATCH }),
      ),
    )
      .then((pages) => {
        if (id !== reqId.current) return;
        setBoard(
          Object.fromEntries(
            STATUSES.map((st, i) => [st, { rows: pages[i].rows, total: pages[i].total, loading: false }]),
          ) as Board,
        );
        setSummary(pages[0].summary);
        setError(null);
      })
      .catch(() => fail(id))
      .finally(() => settle(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filterKey]);

  /** Next BOARD_BATCH cards of one column (scrolling / Show more). */
  const loadMore = useCallback((status: BugReportStatus) => {
    const col = boardRef.current[status];
    if (col.loading || col.rows.length >= col.total) return;
    const id = reqId.current;
    setBoard((b) => ({ ...b, [status]: { ...b[status], loading: true } }));
    listBugReports({ ...filterRef.current, status, order: "board", offset: col.rows.length, limit: BOARD_BATCH })
      .then((res) => {
        if (id !== reqId.current) return;
        setBoard((b) => {
          const have = new Set(b[status].rows.map((r) => r.id));
          return {
            ...b,
            [status]: { rows: [...b[status].rows, ...res.rows.filter((r) => !have.has(r.id))], total: res.total, loading: false },
          };
        });
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setBoard((b) => ({ ...b, [status]: { ...b[status], loading: false } }));
        setError("Couldn't load more reports.");
      });
  }, []);
  const moreFns = useMemo(
    () => Object.fromEntries(STATUSES.map((st) => [st, () => loadMore(st)])) as Record<BugReportStatus, () => void>,
    [loadMore],
  );

  // List: numbered pages of LIST_PAGE_SIZE, back to page 1 when filters change.
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });
  useEffect(() => {
    if (view !== "list") return;
    const id = ++reqId.current;
    setFetching(true);
    listBugReports({ ...filterQuery, order: "newest", offset: (page - 1) * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE })
      .then((res) => {
        if (id !== reqId.current) return;
        setListRows(res.rows);
        setListTotal(res.total);
        setSummary(res.summary);
        setError(null);
      })
      .catch(() => fail(id))
      .finally(() => settle(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filterKey, page]);

  const loaded = useMemo(
    () => [...listRows, ...STATUSES.flatMap((st) => board[st].rows)],
    [listRows, board],
  );
  const openReport = loaded.find((r) => r.id === openId) ?? null;

  // Esc closes the details popup.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  /** Optimistic: the card moves at once and snaps back if the save fails. */
  const moveTo = async (id: string, status: BugReportStatus) => {
    const current = loaded.find((r) => r.id === id);
    if (!current || columnOf(current.status) === status) return;
    const before = { board, listRows, summary };
    setSaveError(null);
    setSavingId(id);
    const moved = { ...current, status };
    const from = columnOf(current.status);
    setBoard((b) => {
      if (!b[from].rows.some((r) => r.id === id)) return b;
      return {
        ...b,
        [from]: { ...b[from], rows: b[from].rows.filter((r) => r.id !== id), total: b[from].total - 1 },
        [status]: { ...b[status], rows: [...b[status].rows, moved].sort(boardOrder), total: b[status].total + 1 },
      };
    });
    setListRows((rows) => rows.map((r) => (r.id === id ? moved : r)));
    // Worked out now, not inside the updater, so the figures are from before
    // the move whenever React runs it.
    const openDelta = Number(isOpenStatus(status)) - Number(isOpenStatus(current.status));
    const criticalDelta = current.severity === "Critical" ? openDelta : 0;
    setSummary((sm) => (sm ? { ...sm, open: sm.open + openDelta, criticalOpen: sm.criticalOpen + criticalDelta } : sm));
    try {
      const updated = await updateBugReportStatus(id, status);
      const patch = (r: BugReportRow) => (r.id === id ? { ...r, status: updated.status, updatedAt: updated.updatedAt } : r);
      setBoard((b) => ({ ...b, [status]: { ...b[status], rows: b[status].rows.map(patch) } }));
      setListRows((rows) => rows.map(patch));
    } catch {
      setBoard(before.board);
      setListRows(before.listRows);
      setSummary(before.summary);
      setSaveError(`Couldn't move "${current.title}". Please try again.`);
    } finally {
      setSavingId(null);
    }
  };

  const onDrop = (e: DragEvent, status: BugReportStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setDropTarget(null);
    setDragId(null);
    if (id) void moveTo(id, status);
  };

  const openCount = summary?.open ?? 0;
  const criticalOpen = summary?.criticalOpen ?? 0;
  const filtersOn = Boolean(search.trim()) || typeFilter !== "all" || severityFilter !== "all";

  const selectCls =
    "rounded-lg border border-line bg-paper px-2.5 py-2 text-[12.5px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-fg">{mine ? "My Bug Reports" : "Bug Tracker"}</h1>
          <p className="mt-0.5 text-[13px] text-fg-3">
            {mine
              ? "Reports you filed with the \"Report a Bug\" button, and where each one stands. The status is updated by the system admin — you are notified when it changes."
              : "Reports filed from the \"Report a Bug\" button across the portal · drag a card to change its status"}
          </p>
        </div>
        {!isLoading && !error && (
          <div className="flex gap-2">
            <div className="rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-fg-3">
              <b className="font-mono text-[15px] text-fg">{openCount}</b> open
            </div>
            {criticalOpen > 0 && (
              <div className="rounded-lg border border-[var(--neg-soft)] bg-[var(--neg-soft)] px-3 py-1.5 text-[12px] text-neg">
                <b className="font-mono text-[15px]">{criticalOpen}</b> critical
              </div>
            )}
            <div className="rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-fg-3">
              <b className="font-mono text-[15px] text-fg">{summary?.total ?? 0}</b> total
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <div className="inline-flex rounded-lg border border-line bg-paper p-0.5">
          {(["board", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                view === v ? "bg-accent text-white" : "text-fg-3 hover:bg-elev hover:text-fg"
              }`}
            >
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, description, reporter, page…"
          className="min-w-[220px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft sm:max-w-[340px]"
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className={selectCls}>
          <option value="all">All types</option>
          <option value="bug">Bugs</option>
          <option value="feature">Feature requests</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
          className={selectCls}
        >
          <option value="all">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {filtersOn && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setTypeFilter("all");
              setSeverityFilter("all");
            }}
            className="rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft"
          >
            Clear filters
          </button>
        )}
      </div>

      {saveError && (
        <div className="mt-3 rounded-lg bg-[var(--neg-soft)] px-4 py-2.5 text-[13px] font-medium text-neg">{saveError}</div>
      )}
      {error && (
        <div className="mt-4 rounded-lg bg-[var(--neg-soft)] px-4 py-3 text-[13px] font-medium text-neg">{error}</div>
      )}

      {isLoading && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((s) => (
            <div key={s} className="h-[320px] animate-pulse rounded-xl border border-line bg-paper" />
          ))}
        </div>
      )}

      {!isLoading && !error && summary?.total === 0 && (
        <div className="mt-6">
          <EmptyState
            icon="folder"
            title="No reports yet"
            description="Reports filed from the Report a Bug button will show up here."
          />
        </div>
      )}

      {/* Board */}
      {!isLoading && !!summary?.total && view === "board" && (
        <div
          className={`mt-4 grid grid-cols-1 items-start gap-4 transition-opacity md:grid-cols-2 xl:grid-cols-4 ${
            fetching ? "opacity-60" : ""
          }`}
        >
          {STATUSES.map((status) => {
            const col = board[status];
            const cards = col.rows;
            const style = STATUS_STYLE[status];
            const isTarget = dropTarget === status;
            return (
              <section
                key={status}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTarget !== status) setDropTarget(status);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={(e) => onDrop(e, status)}
                className={`flex min-h-[260px] flex-col rounded-xl border bg-sunk/50 transition-shadow ${
                  isTarget ? `border-transparent ring-2 ${style.drop}` : "border-line"
                }`}
              >
                <header className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                    <h2 className="text-[13px] font-semibold text-fg">{STATUS_LABEL[status]}</h2>
                    <span className="rounded-full bg-paper px-2 py-0.5 font-mono text-[11px] font-semibold text-fg-3">
                      {col.total}
                    </span>
                  </div>
                </header>

                <div
                  ref={(el) => {
                    colRef(status).current = el;
                  }}
                  className="flex max-h-[min(68vh,620px)] flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-3"
                >
                  {cards.length === 0 && (
                    <div
                      className={`flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-8 text-center text-[12px] ${
                        isTarget ? "border-accent text-accent" : "border-line-strong text-fg-4"
                      }`}
                    >
                      {isTarget ? "Drop here" : filtersOn ? "No matching reports" : "Nothing here"}
                    </div>
                  )}

                  {cards.map((r) => (
                    <article
                      key={r.id}
                      draggable={!mine && savingId !== r.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", r.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(r.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
                      }}
                      onClick={() => setOpenId(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpenId(r.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${r.title} — ${r.severity}, ${STATUS_LABEL[columnOf(r.status)]}`}
                      className={`group cursor-grab rounded-lg border border-line bg-paper p-3 text-left shadow-[0_1px_2px_rgba(10,22,40,0.05)] transition hover:-translate-y-px hover:border-line-strong hover:shadow-[0_6px_16px_rgba(10,22,40,0.1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing ${
                        dragId === r.id ? "opacity-40" : ""
                      } ${savingId === r.id ? "animate-pulse" : ""} ${
                        r.severity === "Critical" && isOpenStatus(status)
                          ? "border-l-[3px] border-l-[var(--neg)]"
                          : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <TypeIcon type={r.type} />
                        <h3 className="line-clamp-2 flex-1 text-[13px] leading-snug font-semibold text-fg">{r.title}</h3>
                      </div>
                      {r.description && (
                        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-fg-3">{r.description}</p>
                      )}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <SeverityBadge severity={r.severity} />
                        {r.page && (
                          <span className="max-w-[140px] truncate rounded bg-elev px-1.5 py-0.5 font-mono text-[10.5px] text-fg-3" title={r.page}>
                            {r.page}
                          </span>
                        )}
                        {r.screenshotFileName && (
                          <span className="text-[11px] text-fg-3" title="Has a screenshot">
                            📎
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-cyan)] text-[9px] font-bold text-white">
                            {initials(r.reportedByName)}
                          </span>
                          <span className="truncate text-[11.5px] text-fg-2">{r.reportedByName || "Unknown"}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-fg-3" title={fmt(r.createdAt)}>
                          {ago(r.createdAt)}
                        </span>
                      </div>
                    </article>
                  ))}
                  {col.total > cards.length && (
                    <LoadMore
                      remaining={col.total - cards.length}
                      loading={col.loading}
                      onMore={moreFns[status]}
                      scrollRef={colRef(status)}
                    />
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* List */}
      {!isLoading && !!summary?.total && view === "list" && (
        <div
          className={`mt-4 overflow-hidden rounded-xl border border-line bg-paper transition-opacity ${
            fetching ? "opacity-60" : ""
          }`}
        >
          {listTotal === 0 ? (
            <EmptyState compact icon="search" title="No matching reports" description="Try a different filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {["", "Title", "Severity", "Reported by", "Filed", "Status"].map((h) => (
                      <th
                        key={h}
                        className="border-b border-line bg-elev px-4 py-2.5 text-left text-[10.5px] font-semibold tracking-[0.08em] whitespace-nowrap text-fg-3 uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {listRows.map((r) => (
                    <tr key={r.id} className="cursor-pointer transition-colors hover:bg-elev" onClick={() => setOpenId(r.id)}>
                      <td className="w-10 px-4 py-2.5">
                        <TypeIcon type={r.type} />
                      </td>
                      <td className="max-w-[420px] px-4 py-2.5">
                        <div className="truncate font-medium text-fg">{r.title}</div>
                        {r.page && <div className="truncate font-mono text-[11px] text-fg-3">{r.page}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <SeverityBadge severity={r.severity} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-fg-2">{r.reportedByName || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-fg-2" title={fmt(r.createdAt)}>
                        {ago(r.createdAt)}
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {mine ? (
                          <span
                            className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${STATUS_STYLE[columnOf(r.status)].chip}`}
                          >
                            {STATUS_LABEL[columnOf(r.status)]}
                          </span>
                        ) : (
                        <select
                          value={columnOf(r.status)}
                          disabled={savingId === r.id}
                          onChange={(e) => void moveTo(r.id, e.target.value as BugReportStatus)}
                          className={`rounded-full border-0 px-2.5 py-1 text-[12px] font-semibold outline-none ${STATUS_STYLE[columnOf(r.status)].chip}`}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {listTotal > 0 && (
            <Pagination
              page={page}
              totalItems={listTotal}
              pageSize={LIST_PAGE_SIZE}
              onPageChange={setPage}
              itemLabel="reports"
            />
          )}
        </div>
      )}

      {/* Details popup */}
      {openReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,22,40,0.55)] p-4"
          onClick={() => setOpenId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={openReport.title}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-line bg-paper shadow-[0_24px_64px_rgba(0,0,0,0.25)]"
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <TypeIcon type={openReport.type} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] leading-snug font-semibold text-fg">{openReport.title}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
                  <SeverityBadge severity={openReport.severity} />
                  <span>{openReport.type === "feature" ? "Feature request" : "Bug"}</span>
                  <span>·</span>
                  <span>
                    by {openReport.reportedByName || "Unknown"} · {fmt(openReport.createdAt)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-[18px] leading-none text-fg-3 hover:bg-elev hover:text-fg"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {(mine ? [columnOf(openReport.status)] : STATUSES).map((s) => {
                    const active = columnOf(openReport.status) === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={mine || savingId === openReport.id}
                        onClick={() => !mine && void moveTo(openReport.id, s)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-60 ${mine ? "cursor-default disabled:opacity-100 " : ""}${
                          active
                            ? `border-transparent ${STATUS_STYLE[s].chip}`
                            : "border-line text-fg-3 hover:border-line-strong hover:text-fg"
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${STATUS_STYLE[s].dot}`} />
                        {STATUS_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11.5px] text-fg-3">
                  {mine
                    ? "Updated by the system admin — you are notified when it changes."
                    : "The reporter is notified when the status changes."}
                </p>
              </div>

              <div>
                <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Description</div>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-fg-2">
                  {openReport.description || "No description provided."}
                </p>
              </div>

              {openReport.page && (
                <div>
                  <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Page</div>
                  <span className="rounded bg-elev px-2 py-1 font-mono text-[12px] text-fg-2">{openReport.page}</span>
                </div>
              )}

              {openReport.screenshotFileName && (
                <div>
                  <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-fg-3 uppercase">Screenshot</div>
                  <a
                    href={getBugReportScreenshotUrl(openReport.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border border-line"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getBugReportScreenshotUrl(openReport.id)}
                      alt="Attached screenshot"
                      className="block max-h-[360px] w-full bg-sunk object-contain"
                    />
                  </a>
                </div>
              )}

              <div className="text-[11.5px] text-fg-3">Last updated {fmt(openReport.updatedAt)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BugTrackerPage;
