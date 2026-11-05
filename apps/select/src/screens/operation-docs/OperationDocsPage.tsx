"use client";

import { useEffect, useMemo, useState } from "react";

import { Segmented } from "../admin/audit/auditUi";
import SavedDocsViewer, { type SavedDocKind } from "../../components/projects/SavedDocsViewer";
import ConfirmModal from "../../components/ui/ConfirmModal";
import PageHeader from "../../components/ui/PageHeader";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { isOperationRole } from "../../lib/roles";
import type { OperationDoc, SavedDocs } from "../../lib/saved-docs";
import { TECHNO_COMMERCIAL_TITLE } from "../../lib/techno-commercial";
import { getOperationDocs, listOperationDocs, markOperationDocMailed } from "../../services/operationDocsService";

// The enquiry versions reviewed and sent to operation, a table with their saved documents
// to read and print, nothing to edit. Operation has it as two pages, Pump Docs and Spare
// Docs, and confirms here when a version is mailed to the client; everyone else has it as
// Client Operation Docs, with toggles for pump / spare and all / created by me, and only
// sees whether it was mailed.

type DocType = "pump" | "spare";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
/** An enquiry date (YYYY-MM-DD), read as that day wherever the browser is. */
const fmtDate = (ymd: string | null) => (ymd ? fmtDay(`${ymd}T00:00:00`) : "—");

/** "RIL/QT/AA/26-27/PCP/1864_V1, Dt. 05.11.2026" as its no. and date; typed ones vary. */
const splitQuotationLine = (line: string): { no: string; date: string } => {
  const m = line.match(/^(.*?)[s,_]*Dt.?s*(.*)$/i);
  return m ? { no: m[1], date: m[2] } : { no: line, date: "" };
};

const DocsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M9 13h6M9 17h4" />
  </svg>
);

const PUMP_DOCS: { key: SavedDocKind; label: string }[] = [
  { key: "technical", label: "Technical" },
  { key: "commercial", label: "Commercial" },
  { key: "techno", label: TECHNO_COMMERCIAL_TITLE },
];
const SPARE_DOCS: { key: SavedDocKind; label: string }[] = [{ key: "commercial", label: "Quotation" }];

type Opened = { id: string; title: string; doc: SavedDocKind };

function DocsModal({ opened, onClose }: { opened: Opened; onClose: () => void }) {
  const [docs, setDocs] = useState<SavedDocs | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getOperationDocs(opened.id)
      .then((d) => !cancelled && setDocs(d))
      .catch(() => !cancelled && setLoadError("Couldn't load the documents."));
    return () => {
      cancelled = true;
    };
  }, [opened.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-line bg-paper" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <h3 className="min-w-0 text-[15px] font-semibold break-all text-fg">{opened.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 items-center rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent"
          >
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {loadError && <p className="text-[13px] text-neg">{loadError}</p>}
          {!docs && !loadError && <p className="py-8 text-center text-[13px] text-fg-3">Loading…</p>}
          {docs && <SavedDocsViewer docs={docs} initialDoc={opened.doc} />}
        </div>
      </div>
    </div>
  );
}

const th = "px-3 py-2.5 text-left text-[10.5px] font-semibold tracking-[0.08em] whitespace-nowrap text-fg-3 uppercase";
const td = "px-3 py-2.5 align-top";

/** A value over a smaller one, as the table's two-part columns read. */
const TwoLines = ({ top, below }: { top: React.ReactNode; below?: React.ReactNode }) => (
  <>
    <span className="block text-[12.5px] text-fg">{top}</span>
    {below && <span className="mt-0.5 block text-[11.5px] text-fg-3">{below}</span>}
  </>
);

export default function OperationDocsPage({ fixedType }: { /** Operation's own pages: this type, no toggles. */ fixedType?: DocType }) {
  const { user } = useCurrentUser();
  const canMarkMailed = isOperationRole(user?.role);
  const [pickedType, setPickedType] = useState<DocType>("pump");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const type = fixedType ?? pickedType;
  const mine = !fixedType && scope === "mine";
  const [rows, setRows] = useState<OperationDoc[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [mailing, setMailing] = useState<OperationDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [mailError, setMailError] = useState("");
  const title = fixedType ? (fixedType === "pump" ? "Pump Docs" : "Spare Docs") : "Client Operation Docs";
  const docColumns = type === "pump" ? PUMP_DOCS : SPARE_DOCS;

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setFailed(false);
    listOperationDocs(type, mine)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [type, mine]);

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter((r) => {
      const text = `${r.projectCode} ${r.quotations.join(" ")} ${r.clientName} ${r.clientCode ?? ""} ${r.primaryRep ?? ""} ${r.secondaryReps ?? ""} ${r.zone ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [rows, search]);

  const confirmMailed = async () => {
    if (!mailing) return;
    setBusy(true);
    setMailError("");
    try {
      const { mailedAt } = await markOperationDocMailed(mailing.id);
      const by = user?.name ?? null;
      setRows((prev) => prev?.map((r) => (r.id === mailing.id ? { ...r, mailedAt, mailedByName: by } : r)) ?? prev);
      setMailing(null);
    } catch (e) {
      setMailError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't record that. Please try again.");
      setMailing(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      <PageHeader
        icon={<DocsIcon />}
        title={title}
        subtitle="The enquiries reviewed and sent to operation, with their saved documents"
        actions={
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search enquiry, quotation, client, rep or zone"
            aria-label="Search enquiry, quotation, client, rep or zone"
            className="h-9 w-[320px] max-w-full rounded-lg border border-line bg-paper px-3 text-[13px] text-fg outline-none focus:border-accent"
          />
        }
      >
        {!fixedType && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={pickedType}
              onChange={setPickedType}
              options={[
                { key: "pump", label: "Pump Docs" },
                { key: "spare", label: "Spare Docs" },
              ]}
            />
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { key: "all", label: "All enquiries" },
                { key: "mine", label: "Created by me" },
              ]}
            />
          </div>
        )}
      </PageHeader>

      {mailError && <p className="mt-3 rounded-lg bg-[var(--neg-soft)] px-4 py-2.5 text-[13px] font-medium text-neg">{mailError}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-paper">
        {failed && <p className="px-4 py-6 text-[13px] text-neg">Couldn&apos;t load the list.</p>}
        {!failed && rows === null && <p className="px-4 py-8 text-center text-[13px] text-fg-3">Loading…</p>}
        {rows !== null && shown.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-fg-3">
            {rows.length > 0 ? "No enquiry matches that search." : mine ? "Nothing you created has been sent to operation yet." : "Nothing has been sent to operation yet."}
          </p>
        )}
        {shown.length > 0 && (
          <table className="w-full min-w-[1300px] border-collapse">
            <thead className="border-b border-line bg-sunk">
              <tr>
                <th className={th}>Enq No. / Date</th>
                <th className={th}>Quotation No. / Date</th>
                <th className={th}>Client Name / Code</th>
                <th className={th}>Reps / Zone</th>
                <th className={th}>Reviewed by</th>
                <th className={th}>Sent to Operation / Date</th>
                {docColumns.map((c) => (
                  <th key={c.label} className={th}>
                    {c.label}
                  </th>
                ))}
                <th className={th}>Mailed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => {
                const reps = [r.primaryRep, r.secondaryReps].filter(Boolean).join(", ");
                return (
                  <tr key={r.id}>
                    <td className={td}>
                      <TwoLines top={<span className="font-mono font-semibold break-all">{r.projectCode}</span>} below={fmtDate(r.enquiryDate)} />
                    </td>
                    <td className={td}>
                      {r.quotations.length === 0 && <span className="text-[12.5px] text-fg-4">—</span>}
                      {r.quotations.map((line) => {
                        const q = splitQuotationLine(line);
                        return (
                          <div key={line} className="[&+div]:mt-1.5">
                            <TwoLines top={<span className="font-mono font-semibold break-all">{q.no}</span>} below={q.date || null} />
                          </div>
                        );
                      })}
                    </td>
                    <td className={td}>
                      <TwoLines top={r.clientName} below={r.clientCode || "—"} />
                    </td>
                    <td className={td}>
                      <TwoLines top={reps || "—"} below={r.zone || "—"} />
                    </td>
                    <td className={td}>
                      <TwoLines top={r.reviewedByName || "—"} below={r.reviewedAt ? fmtDay(r.reviewedAt) : null} />
                    </td>
                    <td className={td}>
                      <TwoLines top={r.sentByName || "—"} below={fmtDay(r.sentAt)} />
                    </td>
                    {docColumns.map((c) => (
                      <td key={c.label} className={td}>
                        {/* No Technical Data Sheet saved means no Techno-Commercial either. */}
                        {c.key !== "commercial" && !r.hasTechnical ? (
                          <span className="text-[12.5px] text-fg-4">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpened({ id: r.id, title: r.projectCode, doc: c.key })}
                            aria-label={`${c.label} V${r.version} of ${r.projectCode}`}
                            className="rounded-lg border border-line bg-paper px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap text-fg-2 hover:border-accent hover:text-accent"
                          >
                            View V{r.version}
                          </button>
                        )}
                      </td>
                    ))}
                    <td className={td}>
                      {r.mailedAt ? (
                        <>
                          <span className="inline-flex rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[11px] font-semibold text-pos">Mailed</span>
                          <span className="mt-1 block text-[11.5px] whitespace-nowrap text-fg-3">
                            {fmtDay(r.mailedAt)}
                            {r.mailedByName ? ` · ${r.mailedByName}` : ""}
                          </span>
                        </>
                      ) : canMarkMailed ? (
                        <button
                          type="button"
                          onClick={() => setMailing(r)}
                          className="rounded-lg bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:opacity-90"
                          title="Confirm this version was mailed to the client"
                        >
                          Mailed
                        </button>
                      ) : (
                        <span className="inline-flex rounded-full bg-sunk px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-fg-2">Not mailed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {opened && <DocsModal opened={opened} onClose={() => setOpened(null)} />}

      <ConfirmModal
        open={mailing !== null}
        title="Confirm it is mailed to the client?"
        description={
          <>
            Records that the documents of <b>{mailing?.projectCode}</b> were mailed to {mailing?.clientName}, for everyone to see. This can&apos;t be undone here, and the portal doesn&apos;t send the mail itself.
          </>
        }
        confirmLabel="Yes, it is mailed"
        tone="primary"
        busy={busy}
        onClose={() => setMailing(null)}
        onConfirm={() => void confirmMailed()}
      />
    </div>
  );
}
