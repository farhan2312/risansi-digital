"use client";

import { useEffect, useRef, useState } from "react";
import "./AdminShared.css";
import "./AdminBugReportsPage.css";
import ConfirmModal from "@/components/ui/ConfirmModal";
import BugReportDetailModal from "@/components/ui/BugReportDetailModal";
import { Skeleton } from "@/components/ui/Skeleton";
import AdminPageHeader, { StatCard } from "@/components/ui/AdminPageHeader";
import { timeAgo } from "@/lib/formUtils";
import { avatarColor, initialsOf } from "@/lib/avatar";
import {
  deleteBugReport,
  listBugReports,
  openBugReportScreenshot,
  setBugReportStatus,
  type BugReportFilters,
} from "@/services/adminService";
import type { BugReport, BugReportStatus } from "@/types/testing";

const PAGE_SIZE = 10;
const COLUMNS: { status: BugReportStatus; title: string; dotClass: string; subtitle: string }[] = [
  { status: "Open", title: "Open", dotClass: "status-open", subtitle: "Reported, not yet picked up" },
  { status: "In Progress", title: "In Progress", dotClass: "status-in-progress", subtitle: "Being worked on" },
  { status: "Resolved", title: "Resolved", dotClass: "status-resolved", subtitle: "Fixed & closed" },
];
const DOT_COLORS: Record<string, string> = {
  "status-open": "var(--info)",
  "status-in-progress": "var(--warn)",
  "status-resolved": "var(--pos)",
};

const severityPillClass = (severity: string) => `bug-severity-pill bug-severity-pill-${severity.toLowerCase()}`;

interface ColumnState {
  cards: BugReport[];
  page: number;
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
}

const emptyColumn = (): ColumnState => ({ cards: [], page: 0, total: 0, isLoading: true, isLoadingMore: false });

interface DraggedCard {
  id: string;
  from: BugReportStatus;
}

interface BugCardProps {
  report: BugReport;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDelete: () => void;
  onOpen: () => void;
}

const BugCard = ({ report: r, isDragging, onDragStart, onDragEnd, onDelete, onOpen }: BugCardProps) => {
  const reporterName = r.reported_by_name ?? "Unknown";
  return (
    <div
      className={`bug-card ${isDragging ? "dragging" : ""} ${!r.is_read ? "unread" : ""}`}
      draggable
      onClick={onOpen}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", r.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="bug-card-meta">
        <span className={`bug-card-severity bug-card-severity-${r.severity.toLowerCase()}`}>{r.severity}</span>
        <span className={`bug-card-type ${r.type === "bug" ? "bug-card-type-bug" : "bug-card-type-feature"}`}>{r.type === "bug" ? "Bug" : "Feature"}</span>
        {r.page && <span className="bug-page-tag">{r.page}</span>}
        {r.has_screenshot && <span className="bug-attachment-icon">📎</span>}
      </div>
      <div className="bug-card-title">
        {!r.is_read && <span className="bug-unread-dot" aria-label="Unread" />}
        {r.title}
      </div>
      {r.description && <div className="bug-card-description">{r.description}</div>}
      <div className="bug-card-footer">
        <div className="bug-card-reporter">
          <span className="bug-avatar" style={{ background: avatarColor(reporterName) }}>
            {initialsOf(reporterName)}
          </span>
          <span className="bug-card-reporter-name">{reporterName}</span>
        </div>
        <div className="bug-card-footer-actions">
          {r.has_screenshot && (
            <button
              type="button"
              className="bug-link-btn"
              onClick={(e) => {
                e.stopPropagation();
                openBugReportScreenshot(r.id);
              }}
            >
              View
            </button>
          )}
          <button
            type="button"
            className="bug-card-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            Delete
          </button>
          <span className="bug-card-time">{timeAgo(r.created_at)}</span>
        </div>
      </div>
    </div>
  );
};

interface KanbanColumnProps {
  status: BugReportStatus;
  title: string;
  subtitle: string;
  dotClass: string;
  column: ColumnState;
  draggingId: string | null;
  isDragOver: boolean;
  onLoadMore: () => void;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
  onDragOverColumn: () => void;
  onDragLeaveColumn: () => void;
  onDropColumn: () => void;
  onDeleteCard: (report: BugReport) => void;
  onOpenCard: (report: BugReport) => void;
}

const KanbanColumn = ({
  status,
  title,
  subtitle,
  dotClass,
  column,
  draggingId,
  isDragOver,
  onLoadMore,
  onDragStartCard,
  onDragEndCard,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropColumn,
  onDeleteCard,
  onOpenCard,
}: KanbanColumnProps) => {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = bodyRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMoreRef.current();
      },
      { root, rootMargin: "80px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      style={{ borderTopColor: DOT_COLORS[dotClass] }}
      className={`bug-kanban-column ${isDragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverColumn();
      }}
      onDragLeave={onDragLeaveColumn}
      onDrop={(e) => {
        e.preventDefault();
        onDropColumn();
      }}
    >
      <div className="bug-kanban-column-header">
        <div className="bug-kanban-column-heading">
          <span className="bug-kanban-column-title" style={{ color: DOT_COLORS[dotClass] }}>
            {title}
          </span>
          <span className="bug-kanban-column-subtitle">{subtitle}</span>
        </div>
        <span className="bug-kanban-column-count">{column.isLoading ? "-" : column.total}</span>
      </div>
      <div className="bug-kanban-column-body" ref={bodyRef}>
        {column.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <Skeleton height={14} width="60%" />
              <Skeleton height={11} width="90%" />
              <Skeleton height={11} width="75%" />
            </div>
          ))
        ) : column.cards.length === 0 ? (
          <p className="bug-kanban-empty">Nothing here</p>
        ) : (
          <>
            {column.cards.map((r) => (
              <BugCard
                key={r.id}
                report={r}
                isDragging={draggingId === r.id}
                onDragStart={() => onDragStartCard(r.id)}
                onDragEnd={onDragEndCard}
                onDelete={() => onDeleteCard(r)}
                onOpen={() => onOpenCard(r)}
              />
            ))}
            {column.cards.length < column.total && <div ref={sentinelRef} className="bug-kanban-sentinel" />}
            {column.isLoadingMore && <p className="bug-kanban-loading-more">Loading more...</p>}
          </>
        )}
      </div>
    </div>
  );
};

const AdminBugReportsPage = () => {
  const [columns, setColumns] = useState<Record<BugReportStatus, ColumnState>>({
    Open: emptyColumn(),
    "In Progress": emptyColumn(),
    Resolved: emptyColumn(),
  });
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<BugReport | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [draggedCard, setDraggedCard] = useState<DraggedCard | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<BugReportStatus | null>(null);
  const [viewingReport, setViewingReport] = useState<BugReport | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "bug" | "feature">("");
  const [severityFilter, setSeverityFilter] = useState<"" | "Low" | "Medium" | "High" | "Critical">("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters: BugReportFilters = {
    search: search || undefined,
    type: typeFilter || undefined,
    severity: severityFilter || undefined,
  };
  const filtersKey = JSON.stringify(filters);

  // Whenever the search/type/severity filter changes, every column starts
  // over at page 1 against the new filtered set -- an in-flight load for
  // the old filter (loadMore or the initial load) is ignored if it lands
  // after a newer filter has already taken over.
  useEffect(() => {
    let cancelled = false;
    setColumns({ Open: emptyColumn(), "In Progress": emptyColumn(), Resolved: emptyColumn() });
    for (const { status } of COLUMNS) {
      listBugReports(status, 1, PAGE_SIZE, filters)
        .then((result) => {
          if (cancelled) return;
          setColumns((prev) => ({
            ...prev,
            [status]: { cards: result.entries, page: 1, total: result.total, isLoading: false, isLoadingMore: false },
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setError("Could not load bug reports.");
          setColumns((prev) => ({ ...prev, [status]: { ...prev[status], isLoading: false } }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const loadMore = async (status: BugReportStatus) => {
    const col = columns[status];
    if (col.isLoading || col.isLoadingMore || col.cards.length >= col.total) return;
    const nextPage = col.page + 1;
    setColumns((prev) => ({ ...prev, [status]: { ...prev[status], isLoadingMore: true } }));
    try {
      const result = await listBugReports(status, nextPage, PAGE_SIZE, filters);
      setColumns((prev) => ({
        ...prev,
        [status]: {
          cards: [...prev[status].cards, ...result.entries],
          page: nextPage,
          total: result.total,
          isLoading: false,
          isLoadingMore: false,
        },
      }));
    } catch {
      setError("Could not load more bug reports.");
      setColumns((prev) => ({ ...prev, [status]: { ...prev[status], isLoadingMore: false } }));
    }
  };

  const handleDrop = async (targetStatus: BugReportStatus) => {
    setDragOverStatus(null);
    const dragged = draggedCard;
    setDraggedCard(null);
    if (!dragged || dragged.from === targetStatus) return;

    const { id, from } = dragged;
    const card = columns[from].cards.find((c) => c.id === id);
    if (!card) return;

    setColumns((prev) => ({
      ...prev,
      [from]: {
        ...prev[from],
        cards: prev[from].cards.filter((c) => c.id !== id),
        total: Math.max(0, prev[from].total - 1),
      },
      [targetStatus]: {
        ...prev[targetStatus],
        cards: [{ ...card, status: targetStatus }, ...prev[targetStatus].cards],
        total: prev[targetStatus].total + 1,
      },
    }));

    try {
      await setBugReportStatus(id, targetStatus);
    } catch {
      setError("Could not update status. Please try again.");
      setColumns((prev) => ({
        ...prev,
        [from]: { ...prev[from], cards: [card, ...prev[from].cards], total: prev[from].total + 1 },
        [targetStatus]: {
          ...prev[targetStatus],
          cards: prev[targetStatus].cards.filter((c) => c.id !== id),
          total: Math.max(0, prev[targetStatus].total - 1),
        },
      }));
    }
  };

  // The modal's own fetch is what actually marks the report read
  // server-side -- this just reflects that back into the card so its
  // unread dot disappears without waiting on a full column reload.
  const handleReportRead = (updated: BugReport) => {
    setColumns((prev) => ({
      ...prev,
      [updated.status]: {
        ...prev[updated.status],
        cards: prev[updated.status].cards.map((c) => (c.id === updated.id ? updated : c)),
      },
    }));
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteBugReport(pendingDelete.id);
      setColumns((prev) => ({
        ...prev,
        [pendingDelete.status]: {
          ...prev[pendingDelete.status],
          cards: prev[pendingDelete.status].cards.filter((c) => c.id !== pendingDelete.id),
          total: Math.max(0, prev[pendingDelete.status].total - 1),
        },
      }));
      setPendingDelete(null);
    } catch {
      setError("Could not delete this report. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const anyLoading = COLUMNS.some(({ status }) => columns[status].isLoading);
  const totalCount = COLUMNS.reduce((sum, { status }) => sum + columns[status].total, 0);

  return (
    <div className="admin-requests-page tw-reset flex flex-col gap-5">
      <AdminPageHeader
        title="Bug Tracker"
        subtitle="Reports filed from the “Report a Bug” widget. Drag a card across the columns as you work on it and close it."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total reports" value={anyLoading ? "–" : totalCount} />
        <StatCard label="Open" value={anyLoading ? "–" : columns.Open.total} tone="accent" sub="Not yet picked up" />
        <StatCard label="In progress" value={anyLoading ? "–" : columns["In Progress"].total} tone="warn" sub="Being worked on" />
        <StatCard label="Resolved" value={anyLoading ? "–" : columns.Resolved.total} tone="pos" sub="Fixed & closed" />
      </div>

      <div className="bug-toolbar">
        <span className="bug-toolbar-label">Filter</span>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="">All types</option>
          <option value="bug">Bug</option>
          <option value="feature">Feature</option>
        </select>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}>
          <option value="">Severity</option>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Critical">Critical</option>
        </select>
        <input
          type="text"
          placeholder="Search title / reporter…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="bug-kanban">
        {COLUMNS.map(({ status, title, dotClass, subtitle }) => (
          <KanbanColumn
            key={status}
            status={status}
            title={title}
            subtitle={subtitle}
            dotClass={dotClass}
            column={columns[status]}
            draggingId={draggedCard?.id ?? null}
            isDragOver={dragOverStatus === status}
            onLoadMore={() => loadMore(status)}
            onDragStartCard={(id) => setDraggedCard({ id, from: status })}
            onDragEndCard={() => {
              setDraggedCard(null);
              setDragOverStatus(null);
            }}
            onDragOverColumn={() => setDragOverStatus(status)}
            onDragLeaveColumn={() => setDragOverStatus((s) => (s === status ? null : s))}
            onDropColumn={() => handleDrop(status)}
            onDeleteCard={setPendingDelete}
            onOpenCard={setViewingReport}
          />
        ))}
      </div>

      {viewingReport && (
        <BugReportDetailModal
          reportId={viewingReport.id}
          onClose={() => setViewingReport(null)}
          onRead={handleReportRead}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Delete bug report?"
          message={`This permanently deletes "${pendingDelete.title}". This can't be undone.`}
          confirmLabel="Delete"
          danger
          isConfirming={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default AdminBugReportsPage;
