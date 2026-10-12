"use client";

import React, { useEffect, useMemo, useState } from "react";
import "./SelectionSummaryPage.css";
import {
  getReportSummary,
  listReports,
  reportDownloadUrl,
  type ReportRecord,
  type ReportSummary,
  type ReportSummaryField,
} from "../../services/reportsService";
import EmptyState from "../../components/ui/EmptyState";
import PageHeader from "../../components/ui/PageHeader";
import StatusPill, { lifecycleStyle } from "../../components/ui/StatusPill";
import DateRangeFilter, { inDateWindow, useDateRange } from "../../components/ui/DateRangeFilter";
import Spinner from "../../components/ui/Spinner";
import {
  downloadSelectionSummaryPdf,
  type SelectionSummaryPdfSection,
} from "../../lib/selection-summary-pdf";
import EnquiryDocumentModal from "../../components/reports/EnquiryDocumentModal";
import FormatChoiceModal, { type DownloadFormat } from "../../components/ui/FormatChoiceModal";
import { downloadSelectionSummaryExcel } from "../../lib/selection-summary-excel";

// A saved summary can still carry the retired "Selected Motor" section and the
// Testing rows; drop them so a regenerated PDF matches the current report spec.
function normalizeSections(summary: ReportSummary): SelectionSummaryPdfSection[] {
  return summary.sections
    .filter((s) => s.title !== "Selected Motor")
    .map((s) => ({
      ...s,
      items: s.items.filter(([label]) => !/^testing\b/i.test(label)),
    }));
}

// Regenerates a tag's PDF from its stored structured summary using the CURRENT
// generator, so styling/layout changes apply to already-saved reports (the
// binary saved at Confirm time can be an older format). Falls back to the saved
// binary when there's no structured summary (pre-feature reports).
async function downloadReport(
  record: ReportRecord,
  format: DownloadFormat,
  summary?: ReportSummary | null,
): Promise<void> {
  const data = summary ?? (await getReportSummary(record.tag_id).catch(() => null));
  if (!data) {
    // Pre-feature report: only the stored PDF binary exists, nothing to
    // rebuild an Excel sheet from.
    window.open(reportDownloadUrl(record.tag_id), "_blank");
    return;
  }
  const input = {
    projectCode: record.project_code,
    projectName: record.project_name ?? undefined,
    pumpFields: data.pumpFields,
    sections: normalizeSections(data),
    generatedBy: record.created_by_name ?? undefined,
  };
  if (format === "excel") downloadSelectionSummaryExcel(input);
  else await downloadSelectionSummaryPdf(input);
}

// One enquiry group as loaded/rendered by the page.
interface EnquiryGroup {
  project_id: string;
  project_code: string;
  project_name: string | null;
  client_code: string | null;
  created_by_name: string | null;
  latest_generated_at: string | null;
  tags: ReportRecord[];
}

// Roll up the tag statuses under one enquiry into a single enquiry-level
// status - same rule the /api/projects list uses server-side, mirrored here
// so the enquiry row and the nested tag rows agree.
function rollupTagStatuses(statuses: string[]): string {
  if (statuses.length === 0) return "—";
  const norm = (s: string) => (s || "").trim().toLowerCase();
  if (statuses.every((s) => norm(s) === "completed")) return "Completed";
  if (statuses.every((s) => norm(s) === "pending")) return "Pending";
  return "In Progress";
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// Reports grouped per enquiry, then per tag. A tag can have at most one
// generated Selection Summary report (enquiry_tags.id is unique, one row per
// tag), so a single enquiry shows one nested row per confirmed tag. Same
// chevron-expand pattern the Projects page uses for its own tag list.
const SelectionSummaryPage = () => {
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Report generated-date filter.
  const dates = useDateRange("all");
  const [viewing, setViewing] = useState<ReportRecord | null>(null);
  const [viewingEnquiry, setViewingEnquiry] = useState<EnquiryGroup | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Row-level download asks PDF or Excel before generating.
  const [choosingFor, setChoosingFor] = useState<ReportRecord | null>(null);
  const [choiceBusy, setChoiceBusy] = useState<DownloadFormat | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReports()
      .then((rows) => {
        if (!cancelled) setReports(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load reports.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter(
      (r) =>
        inDateWindow(r.document_generated_at, dates.window) &&
        (!q ||
          r.project_code.toLowerCase().includes(q) ||
          (r.project_name ?? "").toLowerCase().includes(q) ||
          (r.client_code ?? "").toLowerCase().includes(q) ||
          r.tag_name.toLowerCase().includes(q)),
    );
  }, [reports, search, dates.window]);

  // Group the flat per-tag list by enquiry so the outer table shows one row
  // per enquiry with the tag reports nested underneath. Enquiries are sorted
  // by their newest tag's generated_at so the most recent activity floats to
  // the top - matches the flat ordering the API returns.
  const grouped = useMemo(() => {
    const map = new Map<string, EnquiryGroup>();
    for (const r of filtered) {
      let entry = map.get(r.project_id);
      if (!entry) {
        entry = {
          project_id: r.project_id,
          project_code: r.project_code,
          project_name: r.project_name,
          client_code: r.client_code,
          created_by_name: r.created_by_name,
          latest_generated_at: r.document_generated_at,
          tags: [],
        };
        map.set(r.project_id, entry);
      }
      entry.tags.push(r);
      if (
        r.document_generated_at &&
        (!entry.latest_generated_at ||
          r.document_generated_at > entry.latest_generated_at)
      ) {
        entry.latest_generated_at = r.document_generated_at;
      }
    }
    return [...map.values()].sort((a, b) =>
      (b.latest_generated_at ?? "").localeCompare(a.latest_generated_at ?? ""),
    );
  }, [filtered]);

  const toggleExpanded = (projectId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-fg-2 transition-colors hover:border-[color-mix(in_srgb,var(--brand-blue)_35%,transparent)] hover:bg-paper hover:text-accent [&_svg]:h-[14px] [&_svg]:w-[14px]";
  const btnPrimary =
    "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgba(10,61,143,0.15)] transition hover:-translate-y-px hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--brand-blue)_30%,transparent)] [&_svg]:h-[14px] [&_svg]:w-[14px]";
  const completedTags = filtered.filter((r) => (r.status ?? "").toLowerCase() === "completed").length;
  const enquiryCount = new Set(filtered.map((r) => r.project_id)).size;

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      <PageHeader
        icon={<ReportGlyph />}
        title="Reports"
        subtitle="Generated Selection Summary reports, grouped by enquiry · open a tag to preview or download it"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[340px]">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3">
              <SearchGlyph />
            </span>
            <input
              type="search"
              className="w-full rounded-lg border border-line bg-paper py-2 pr-3 pl-9 text-[13px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft"
              placeholder="Search enquiry, name, client or tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <DateRangeFilter state={dates} fromLabel="Generated from" toLabel="Generated to" />
          {!isLoading && !error && (
            <div className="ml-auto flex flex-wrap gap-2 text-[12px] text-fg-3">
              <span className="rounded-lg border border-line bg-paper px-3 py-1.5">
                <b className="font-mono text-[14px] text-fg">{enquiryCount}</b> enquir{enquiryCount === 1 ? "y" : "ies"}
              </span>
              <span className="rounded-lg border border-line bg-paper px-3 py-1.5">
                <b className="font-mono text-[14px] text-fg">{filtered.length}</b> report{filtered.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-lg border border-[var(--pos-soft)] bg-[var(--pos-soft)] px-3 py-1.5 text-pos">
                <b className="font-mono text-[14px]">{completedTags}</b> completed
              </span>
            </div>
          )}
        </div>
      </PageHeader>

      {error && <div className="mt-4 rounded-lg bg-[var(--neg-soft)] px-4 py-3 text-[13px] font-medium text-neg">{error}</div>}

      {isLoading && (
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-xl border border-line bg-paper" />
          ))}
        </div>
      )}

      {!isLoading && !error && reports.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon="table"
            title="No reports generated yet"
            description="Click Confirm Pump Selection on the last wizard step of a tag to generate and save its report here."
          />
        </div>
      )}

      {!isLoading && !error && reports.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-paper shadow-[0_1px_2px_rgba(10,22,40,0.04),0_8px_24px_rgba(10,22,40,0.04)]">
          {grouped.length === 0 ? (
            <EmptyState
              compact
              icon="search"
              title={search.trim() ? `No reports match “${search}”` : "No reports in this date range"}
              description="Try a different enquiry, name, client, tag or date range."
            />
          ) : (
            <div className="overflow-x-auto">
            <div className="min-w-[950px]">
            <div className={`border-b border-line bg-elev px-4 py-2.5 grid grid-cols-[28px_minmax(170px,2.2fr)_minmax(90px,0.8fr)_minmax(110px,1fr)_minmax(120px,1fr)_minmax(72px,0.6fr)_minmax(96px,0.8fr)_140px] items-center gap-x-3 [&>*]:min-w-0`}>
              <span />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Enquiry</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Client Code</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Generated By</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Latest Report</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Reports</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Status</span>
              <span className="pl-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Document</span>
            </div>
            <ul className="divide-y divide-line">
              {grouped.map((g) => {
                const isOpen = expanded.has(g.project_id);
                const enquiryStatus = rollupTagStatuses(g.tags.map((t) => t.status ?? ""));
                return (
                  <li key={g.project_id} className={isOpen ? "bg-[color-mix(in_srgb,var(--accent-soft)_45%,transparent)]" : ""}>
                    <div className={`group px-4 py-3 transition-colors hover:bg-elev grid grid-cols-[28px_minmax(170px,2.2fr)_minmax(90px,0.8fr)_minmax(110px,1fr)_minmax(120px,1fr)_minmax(72px,0.6fr)_minmax(96px,0.8fr)_140px] items-center gap-x-3 [&>*]:min-w-0`}>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(g.project_id)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Hide tag reports" : "Show tag reports"}
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                          isOpen
                            ? "rotate-90 border-transparent bg-accent text-white"
                            : "border-line bg-paper text-fg-3 hover:border-accent hover:text-accent"
                        }`}
                      >
                        <ChevronIcon />
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleExpanded(g.project_id)}
                        className="min-w-0 flex-1 text-left"
                        title={isOpen ? "Hide tag reports" : "Show tag reports"}
                      >
                        <span className="block font-mono text-[12.5px] font-bold text-title">{g.project_code}</span>
                        <span className="mt-0.5 block truncate text-[13.5px] font-semibold text-fg group-hover:text-accent">
                          {g.project_name || "—"}
                        </span>
                      </button>

                      <span className="min-w-0">
                        {g.client_code ? (
                          <span className="inline-block max-w-full truncate rounded-md bg-elev px-1.5 py-0.5 font-mono text-[11.5px] text-fg-2">
                            {g.client_code}
                          </span>
                        ) : (
                          <span className="text-fg-4">—</span>
                        )}
                      </span>

                      <span className="min-w-0 truncate text-[12.5px] text-fg-2">{g.created_by_name || <span className="text-fg-4">—</span>}</span>

                      <span className="truncate text-[12.5px] whitespace-nowrap text-fg-2" title={fmtDate(g.latest_generated_at)}>{fmtDate(g.latest_generated_at)}</span>

                      <span>
                        <span className="rounded-full bg-elev px-2 py-0.5 text-[11.5px] font-semibold text-fg-2">
                          {g.tags.length} report{g.tags.length === 1 ? "" : "s"}
                        </span>
                      </span>

                      <span>
                        <StatusPill status={enquiryStatus} />
                      </span>

                      <div className="flex justify-start">
                        <button type="button" className={btn} onClick={() => setViewingEnquiry(g)}>
                          <DocGlyph /> View Document
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="pr-4 pb-4 pl-[60px]">
                        <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
                          {g.tags.map((t) => (
                            <li key={t.tag_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5 hover:bg-elev">
                              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: lifecycleStyle(t.status).color }} aria-hidden />
                              <button
                                type="button"
                                onClick={() => setViewing(t)}
                                className="min-w-[180px] flex-1 text-left"
                                title="Preview this report"
                              >
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13px] font-semibold text-fg hover:text-accent">{t.tag_name}</span>
                                  <StatusPill status={t.status} />
                                </span>
                                <span className="mt-0.5 block text-[11.5px] text-fg-3">Generated {fmtDate(t.document_generated_at)}</span>
                              </button>
                              <div className="flex items-center gap-0.5">
                                <button type="button" className={btn} onClick={() => setViewing(t)}>
                                  <EyeGlyph /> Preview
                                </button>
                                <button type="button" className={btnPrimary} onClick={() => setChoosingFor(t)}>
                                  <DownloadGlyph /> Download
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            </div>
            </div>
          )}
        </div>
      )}

      {viewing && (
        <ReportSummaryModal report={viewing} onClose={() => setViewing(null)} />
      )}

      {choosingFor && (
        <FormatChoiceModal
          title="Download report"
          message={`${choosingFor.project_code} · ${choosingFor.tag_name}`}
          busy={choiceBusy}
          onCancel={() => {
            if (choiceBusy) return;
            setChoosingFor(null);
          }}
          onChoose={async (format) => {
            const record = choosingFor;
            setChoiceBusy(format);
            try {
              await downloadReport(record, format);
              setChoosingFor(null);
            } finally {
              setChoiceBusy(null);
            }
          }}
        />
      )}

      {viewingEnquiry && (
        <EnquiryDocumentModal
          source={{
            projectId: viewingEnquiry.project_id,
            projectCode: viewingEnquiry.project_code,
            projectName: viewingEnquiry.project_name,
          }}
          onClose={() => setViewingEnquiry(null)}
        />
      )}
    </div>
  );
};

// --- Summary modal -----------------------------------------------------

const SummaryFieldGrid = ({ items, pos }: { items: ReportSummaryField[]; pos?: boolean }) => {
  const filled = items.filter(([, v]) => v && String(v).trim() !== "");
  if (filled.length === 0) return null;
  return (
    <div className={`summary-modal-grid ${pos ? "summary-modal-grid-pos" : ""}`}>
      {filled.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
};

const ReportSummaryModal = ({
  report,
  onClose,
}: {
  report: ReportRecord;
  onClose: () => void;
}) => {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadReport(report, "excel", summary);
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getReportSummary(report.tag_id)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the report summary.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [report.tag_id]);

  return (
    <div className="summary-modal-overlay" onClick={onClose}>
      <div
        className="summary-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="summary-modal-header">
          <div>
            <h3>
              {report.project_code} <span className="summary-modal-tag">· {report.tag_name}</span>
            </h3>
            <p>{report.project_name || "—"}</p>
          </div>
          <button className="summary-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="summary-modal-body">
          {isLoading && (
            <div style={{ padding: "24px 0", textAlign: "center" }}>
              <Spinner caption="Loading summary…" />
            </div>
          )}
          {!isLoading && error && <p className="error-message">{error}</p>}
          {!isLoading && !error && !summary && (
            <EmptyState
              compact
              icon="alert"
              title="No summary saved for this report"
              description="Older reports generated before this feature was added won't have one — the PDF download still works."
            />
          )}

          {!isLoading && !error && summary && (
            <>
              {summary.pumpFields.length > 0 && (
                <div className="summary-modal-section">
                  <span className="summary-modal-section-title">Pump Selection</span>
                  <SummaryFieldGrid items={summary.pumpFields} />
                </div>
              )}
              {summary.sections.map((section) => {
                const hasValue = section.items.some(([, v]) => v && String(v).trim() !== "");
                if (!hasValue) return null;
                return (
                  <div className="summary-modal-section" key={section.title}>
                    <span
                      className={`summary-modal-section-title ${
                        section.highlight ? "summary-modal-section-title-pos" : ""
                      }`}
                    >
                      {section.title}
                    </span>
                    <SummaryFieldGrid items={section.items} pos={section.highlight} />
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="summary-modal-footer">
          <button
            className="summary-download-btn"
            onClick={handleDownload}
            disabled={downloading || isLoading}
          >
            {downloading ? "Generating…" : "Download Excel"}
          </button>
          <button className="summary-modal-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// The chevron ships as a right-arrow; the .summary-chevron.is-open class in
// SelectionSummaryPage.css rotates it 90 deg down when expanded.
const ReportGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </svg>
);
const SearchGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4-4" />
  </svg>
);
const DocGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </svg>
);
const EyeGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const DownloadGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v11M7 10l5 5 5-5M4 19h16" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="M4.5 3l3 3-3 3"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default SelectionSummaryPage;
