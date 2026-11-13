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
import { usePageTitle } from "../../components/layout/PageTitle";
import { Bug, CircleAlert, LayoutGrid, Lightbulb, List, Paperclip, Search, X } from "lucide-react";
// shadcn/ui (user, 2026-11-13: the Bug Tracker in the new look, branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Alert } from "@/components/shadcn/field";
import { Input, NativeSelect } from "@/components/shadcn/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";

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
      className="rounded-md border border-dashed border-input px-3 py-2 text-[12px] font-medium text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-60"
    >
      {loading ? "Loading…" : `Show more (${remaining} left)`}
    </button>
  );
}

// Each status' tone (open=info, need clarification=warning, in progress=primary,
// resolved=success): the column dot, the soft chip used elsewhere and the drop ring.
const STATUS_STYLE: Record<BugReportStatus, { tone: "info" | "warning" | "primary" | "success"; dot: string; chip: string; drop: string }> = {
  Open: { tone: "info", dot: "bg-info", chip: "bg-info/10 text-info ring-info/25", drop: "ring-info" },
  "Need Clarification": { tone: "warning", dot: "bg-warning", chip: "bg-warning/10 text-warning ring-warning/25", drop: "ring-warning" },
  "In progress": { tone: "primary", dot: "bg-primary", chip: "bg-primary/8 text-primary ring-primary/20", drop: "ring-primary" },
  Resolved: { tone: "success", dot: "bg-success", chip: "bg-success/10 text-success ring-success/25", drop: "ring-success" },
};

// Severity as a badge tone: critical=danger, high=warning, medium=info, low=neutral.
const SEVERITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  Critical: "danger",
  High: "warning",
  Medium: "info",
  Low: "neutral",
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
    className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5 ${
      type === "feature" ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
    }`}
    title={type === "feature" ? "Feature request" : "Bug"}
  >
    {type === "feature" ? <Lightbulb /> : <Bug />}
  </span>
);

const SeverityBadge = ({ severity }: { severity: string }) => <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{severity}</Badge>;
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

  usePageTitle(
    mine ? "My Bug Reports" : "Bug Tracker",
    mine
      ? "Reports you filed with the \"Report a Bug\" button, and where each one stands. The status is updated by the system admin — you are notified when it changes."
      : "Reports filed from the \"Report a Bug\" button across the portal · drag a card to change its status",
  );
  return (
    <div className="min-h-full bg-background">
    <div className="w-full px-4 pt-4 pb-10 sm:px-6 min-[1101px]:px-0">
      {/* Toolbar: view, search, filters, and the counts on the right */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Tabs value={view} onValueChange={(v) => setView(v === "list" ? "list" : "board")}>
            <TabsList aria-label="View">
              <TabsTrigger value="board">
                <LayoutGrid className="mr-1.5 size-3.5" /> Board
              </TabsTrigger>
              <TabsTrigger value="list">
                <List className="mr-1.5 size-3.5" /> List
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="min-w-[220px] flex-1 sm:max-w-[340px]">
            <Input
              type="search"
              icon={<Search />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, reporter, page…"
              aria-label="Search reports"
            />
          </div>
          <NativeSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} aria-label="Type">
            <option value="all">All types</option>
            <option value="bug">Bugs</option>
            <option value="feature">Feature requests</option>
          </NativeSelect>
          <NativeSelect value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)} aria-label="Severity">
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
          {filtersOn && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setTypeFilter("all");
                setSeverityFilter("all");
              }}
            >
              <X /> Clear filters
            </Button>
          )}
          {!isLoading && !error && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" className="px-2 py-0.5 text-[12px]">
                <b className="font-mono font-semibold text-foreground tabular-nums">{openCount}</b> open
              </Badge>
              {criticalOpen > 0 && (
                <Badge tone="danger" className="px-2 py-0.5 text-[12px]">
                  <b className="font-mono font-semibold tabular-nums">{criticalOpen}</b> critical
                </Badge>
              )}
              <Badge tone="neutral" className="px-2 py-0.5 text-[12px]">
                <b className="font-mono font-semibold text-foreground tabular-nums">{summary?.total ?? 0}</b> total
              </Badge>
            </div>
          )}
        </div>
      </Card>

      {saveError && (
        <Alert className="mt-3 flex items-center gap-2">
          <CircleAlert className="size-4 shrink-0" />
          {saveError}
        </Alert>
      )}
      {error && (
        <Alert className="mt-4 flex items-center gap-2">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </Alert>
      )}

      {isLoading && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((s) => (
            <div key={s} className="h-[320px] animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      )}

      {!isLoading && !error && summary?.total === 0 && (
        <Card className="mt-4">
          <EmptyState icon="folder" title="No reports yet" description="Reports filed from the Report a Bug button will show up here." />
        </Card>
      )}

      {/* Board */}
      {!isLoading && !!summary?.total && view === "board" && (
        <div className={`mt-4 grid grid-cols-1 items-start gap-4 transition-opacity md:grid-cols-2 xl:grid-cols-4 ${fetching ? "opacity-60" : ""}`}>
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
                className={`flex min-h-[260px] flex-col overflow-hidden rounded-lg border bg-muted/40 transition-shadow ${
                  isTarget ? `border-transparent ring-2 ${style.drop}` : "border-border"
                }`}
              >
                <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${style.dot}`} />
                    <h2 className="text-[12.5px] font-semibold text-foreground">{STATUS_LABEL[status]}</h2>
                  </div>
                  <span className="rounded-md bg-muted px-1.5 py-px font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">{col.total}</span>
                </header>

                <div
                  ref={(el) => {
                    colRef(status).current = el;
                  }}
                  className="flex max-h-[min(68vh,620px)] flex-1 flex-col gap-2 overflow-y-auto p-2.5"
                >
                  {cards.length === 0 && (
                    <div
                      className={`flex flex-1 items-center justify-center rounded-md border border-dashed px-3 py-8 text-center text-[12px] ${
                        isTarget ? "border-primary text-primary" : "border-input text-muted-foreground"
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
                      className={`group rounded-md border border-border bg-card p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition outline-none hover:border-input hover:shadow-[0_6px_16px_rgba(15,23,42,0.09)] focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
                        mine ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
                      } ${dragId === r.id ? "opacity-40" : ""} ${savingId === r.id ? "animate-pulse" : ""} ${
                        r.severity === "Critical" && isOpenStatus(status) ? "border-l-[3px] border-l-destructive" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <TypeIcon type={r.type} />
                        <h3 className="line-clamp-2 flex-1 text-[12.5px] leading-snug font-medium text-foreground">{r.title}</h3>
                      </div>
                      {r.description && <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{r.description}</p>}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <SeverityBadge severity={r.severity} />
                        {r.page && (
                          <span className="max-w-[140px] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground" title={r.page}>
                            {r.page}
                          </span>
                        )}
                        {r.screenshotFileName && (
                          <span className="text-muted-foreground" title="Has a screenshot">
                            <Paperclip className="size-3" />
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary ring-1 ring-primary/15">
                            {initials(r.reportedByName)}
                          </span>
                          <span className="truncate text-[11.5px] text-foreground">{r.reportedByName || "Unknown"}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground" title={fmt(r.createdAt)}>
                          {ago(r.createdAt)}
                        </span>
                      </div>
                    </article>
                  ))}
                  {col.total > cards.length && (
                    <LoadMore remaining={col.total - cards.length} loading={col.loading} onMore={moreFns[status]} scrollRef={colRef(status)} />
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* List */}
      {!isLoading && !!summary?.total && view === "list" && (
        <Card className={`mt-4 overflow-hidden transition-opacity ${fetching ? "opacity-60" : ""}`}>
          {listTotal === 0 ? (
            <EmptyState compact icon="search" title="No matching reports" description="Try a different filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["", "Title", "Severity", "Reported by", "Filed", "Status"].map((h) => (
                      <th
                        key={h}
                        className="border-b border-border bg-muted/60 px-4 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listRows.map((r) => (
                    <tr key={r.id} className="cursor-pointer transition-colors hover:bg-muted/50" onClick={() => setOpenId(r.id)}>
                      <td className="w-10 px-4 py-2.5">
                        <TypeIcon type={r.type} />
                      </td>
                      <td className="max-w-[420px] px-4 py-2.5">
                        <div className="truncate font-medium text-foreground">{r.title}</div>
                        {r.page && <div className="truncate font-mono text-[11px] text-muted-foreground">{r.page}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <SeverityBadge severity={r.severity} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-foreground">{r.reportedByName || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground" title={fmt(r.createdAt)}>
                        {ago(r.createdAt)}
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {mine ? (
                          <Badge tone={STATUS_STYLE[columnOf(r.status)].tone} dot>
                            {STATUS_LABEL[columnOf(r.status)]}
                          </Badge>
                        ) : (
                          <select
                            value={columnOf(r.status)}
                            disabled={savingId === r.id}
                            onChange={(e) => void moveTo(r.id, e.target.value as BugReportStatus)}
                            aria-label={`Status of ${r.title}`}
                            className={`h-7 rounded-md border-0 px-2 text-[12px] font-medium ring-1 outline-none ring-inset focus-visible:ring-[3px] focus-visible:ring-ring/30 ${STATUS_STYLE[columnOf(r.status)].chip}`}
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
            <div className="border-t border-border bg-muted/40">
              <Pagination page={page} totalItems={listTotal} pageSize={LIST_PAGE_SIZE} onPageChange={setPage} itemLabel="reports" />
            </div>
          )}
        </Card>
      )}

      {/* Details pop-up */}
      <Dialog open={!!openReport} onOpenChange={(o) => !o && setOpenId(null)}>
        {openReport && (
          <DialogContent size="lg" className="max-w-[640px]" onInteractOutside={() => undefined}>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <TypeIcon type={openReport.type} />
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-[15px]">{openReport.title}</DialogTitle>
                  <DialogDescription asChild>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={openReport.severity} />
                      <span>{openReport.type === "feature" ? "Feature request" : "Bug"}</span>
                      <span>·</span>
                      <span>
                        by {openReport.reportedByName || "Unknown"} · {fmt(openReport.createdAt)}
                      </span>
                    </div>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <div>
                <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {(mine ? [columnOf(openReport.status)] : STATUSES).map((s) => {
                    const active = columnOf(openReport.status) === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={mine || savingId === openReport.id}
                        onClick={() => !mine && void moveTo(openReport.id, s)}
                        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60 ${
                          mine ? "cursor-default disabled:opacity-100 " : ""
                        }${active ? `border-transparent ring-1 ring-inset ${STATUS_STYLE[s].chip}` : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"}`}
                      >
                        <span className={`size-2 rounded-full ${STATUS_STYLE[s].dot}`} />
                        {STATUS_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  {mine ? "Updated by the system admin — you are notified when it changes." : "The reporter is notified when the status changes."}
                </p>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Description</div>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">{openReport.description || "No description provided."}</p>
              </div>

              {openReport.page && (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Page</div>
                  <span className="rounded bg-muted px-2 py-1 font-mono text-[12px] text-foreground">{openReport.page}</span>
                </div>
              )}

              {openReport.screenshotFileName && (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Screenshot</div>
                  <a href={getBugReportScreenshotUrl(openReport.id)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={getBugReportScreenshotUrl(openReport.id)} alt="Attached screenshot" className="block max-h-[360px] w-full bg-muted object-contain" />
                  </a>
                </div>
              )}

              <div className="text-[11.5px] text-muted-foreground">Last updated {fmt(openReport.updatedAt)}</div>
            </DialogBody>
          </DialogContent>
        )}
      </Dialog>
    </div>
    </div>
  );
};

export default BugTrackerPage;
