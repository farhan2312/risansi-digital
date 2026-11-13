"use client";

import { useEffect, useMemo, useState } from "react";

import { MultiSelect } from "../../components/projects/EnquiryFilterBar";
import DateRangeFilter, { useDateRange } from "../../components/ui/DateRangeFilter";
import SavedDocsViewer, { type SavedDocKind } from "../../components/projects/SavedDocsViewer";
import PageHeader from "../../components/ui/PageHeader";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { isOperationRole } from "../../lib/roles";
import type { OperationDoc, SavedDocs } from "../../lib/saved-docs";
import { TECHNO_COMMERCIAL_TITLE } from "../../lib/techno-commercial";
import { getOperationDocs, listOperationDocs, markOperationDocMailed } from "../../services/operationDocsService";
import { CircleAlert, Eye, Mail, Search, X } from "lucide-react";
// shadcn/ui (user, 2026-11-13: the new look, branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Input } from "@/components/shadcn/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import { ConfirmDialog } from "@/components/shadcn/alert-dialog";

// The enquiry versions reviewed and sent to operation, a table with their saved documents
// to read and print, nothing to edit. Operation has it as two pages, Pump Docs and Spare
// Docs, and confirms here when a version is mailed to the client; everyone else has it as
// Client Operation Docs, with toggles for pump / spare and all / created by me, and only
// sees whether it was mailed.

type DocType = "pump" | "spare";

/** The dropdown filters, each matching any of its picks. */
type Picks = { subtype: string[]; zone: string[]; rep: string[]; market: string[]; reviewer: string[]; sender: string[] };
const NO_PICKS: Picks = { subtype: [], zone: [], rep: [], market: [], reviewer: [], sender: [] };

/** Primary and secondary reps ("A, B" is stored as one text). */
const repsOf = (r: OperationDoc): string[] => [r.primaryRep ?? "", ...(r.secondaryReps ?? "").split(",")].map((x) => x.trim()).filter(Boolean);
const uniqueSorted = (values: (string | null)[]): string[] =>
  [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
/** An enquiry date (YYYY-MM-DD), read as that day wherever the browser is. */
const fmtDate = (ymd: string | null) => (ymd ? fmtDay(`${ymd}T00:00:00`) : "—");

/** "RIL/QT/AA/26-27/PCP/1864_V1, Dt. 05.11.2026" (the document's "Quotation No. & Date"
 *  line) as its no. and date, the date shown like the enquiry's. Typed lines vary: a date
 *  that doesn't read as one is shown as typed. */
const splitQuotationLine = (line: string): { no: string; date: string } => {
  const m = line.match(/^(.*?)[\s,_]*\bDt\b\.?\s*(.*)$/i);
  if (!m) return { no: line, date: "" };
  const d = m[2].match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const ok = d && Number(d[1]) >= 1 && Number(d[1]) <= 31 && Number(d[2]) >= 1 && Number(d[2]) <= 12;
  return { no: m[1], date: ok ? fmtDate(`${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`) : m[2] };
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

  // A plain overlay, not a Radix Dialog: SavedDocsViewer prints through printHtml's hidden
  // iframe, which a Radix focus / pointer lock could block.
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[0_24px_64px_rgba(15,23,42,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <h3 className="min-w-0 font-mono text-[14px] font-semibold break-all text-foreground">{opened.title}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" title="Close">
            <X />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {loadError && (
            <p className="flex items-center gap-2 text-[13px] font-medium text-destructive">
              <CircleAlert className="size-4" /> {loadError}
            </p>
          )}
          {!docs && !loadError && <p className="py-8 text-center text-[13px] text-muted-foreground">Loading…</p>}
          {docs && <SavedDocsViewer docs={docs} initialDoc={opened.doc} />}
        </div>
      </div>
    </div>
  );
}

const th = "px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase";
const td = "px-3 py-2.5 align-top";

/** A value over a smaller one, as the table's two-part columns read. */
const TwoLines = ({ top, below }: { top: React.ReactNode; below?: React.ReactNode }) => (
  <>
    <span className="block text-[12.5px] text-foreground">{top}</span>
    {below && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{below}</span>}
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
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const [mailedFilter, setMailedFilter] = useState<"all" | "mailed" | "not">("all");
  // By the day it was sent to operation.
  const dates = useDateRange("all");
  const pick = (key: keyof Picks) => (next: string[]) => setPicks((p) => ({ ...p, [key]: next }));
  const filtering = search.trim() !== "" || Object.values(picks).some((v) => v.length > 0) || mailedFilter !== "all" || dates.active;
  const clearFilters = () => {
    setSearch("");
    setPicks(NO_PICKS);
    setMailedFilter("all");
    dates.reset();
  };
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

  // Each dropdown offers what the list has.
  const options = useMemo(() => {
    const list = rows ?? [];
    return {
      subtype: uniqueSorted(list.map((r) => r.subtype)),
      zone: uniqueSorted(list.map((r) => r.zone)),
      rep: uniqueSorted(list.flatMap(repsOf)),
      market: uniqueSorted(list.map((r) => r.market)),
      reviewer: uniqueSorted(list.map((r) => r.reviewedByName)),
      sender: uniqueSorted(list.map((r) => r.sentByName)),
    };
  }, [rows]);

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const one = (picked: string[], v: string | null) => picked.length === 0 || picked.includes((v ?? "").trim());
    const { from, to } = dates.window;
    return (rows ?? []).filter((r) => {
      const text = `${r.projectCode} V${r.version} ${r.quotations.join(" ")} ${r.clientName} ${r.clientCode ?? ""} ${r.primaryRep ?? ""} ${r.secondaryReps ?? ""} ${r.zone ?? ""}`.toLowerCase();
      return (
        words.every((w) => text.includes(w)) &&
        one(picks.subtype, r.subtype) &&
        one(picks.zone, r.zone) &&
        one(picks.market, r.market) &&
        one(picks.reviewer, r.reviewedByName) &&
        one(picks.sender, r.sentByName) &&
        (picks.rep.length === 0 || repsOf(r).some((x) => picks.rep.includes(x))) &&
        (mailedFilter === "all" || (mailedFilter === "mailed") === Boolean(r.mailedAt)) &&
        (!from || r.sentAt >= from) &&
        (!to || r.sentAt <= to)
      );
    });
  }, [rows, search, picks, mailedFilter, dates.window]);

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
    <div className="min-h-full bg-background">
    <div className="w-full px-4 pt-4 pb-10 sm:px-6 min-[1101px]:px-0">
      {/* The heading goes to the top bar (PageHeader with nothing else renders nothing). */}
      <PageHeader icon={<DocsIcon />} title={title} subtitle="The enquiries reviewed and sent to operation, with their saved documents" />

      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {!fixedType && (
            <>
              <Tabs
                value={pickedType}
                onValueChange={(v) => {
                  setPickedType(v === "spare" ? "spare" : "pump");
                  // Pump and spare types differ.
                  setPicks((p) => ({ ...p, subtype: [] }));
                }}
              >
                <TabsList aria-label="Pump or spare documents">
                  <TabsTrigger value="pump">Pump Docs</TabsTrigger>
                  <TabsTrigger value="spare">Spare Docs</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs value={scope} onValueChange={(v) => setScope(v === "mine" ? "mine" : "all")}>
                <TabsList aria-label="Which enquiries">
                  <TabsTrigger value="all">All enquiries</TabsTrigger>
                  <TabsTrigger value="mine">Created by me</TabsTrigger>
                </TabsList>
              </Tabs>
            </>
          )}
          <div className="w-full sm:w-[340px]">
            <Input
              type="search"
              icon={<Search />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search enquiry, quotation no., client, rep or zone"
              aria-label="Search enquiry, quotation no., client, rep or zone"
            />
          </div>
          {rows !== null && (
            <span className="ml-auto text-[12.5px] text-muted-foreground">
              <b className="font-mono font-semibold text-foreground tabular-nums">{filtering ? `${shown.length} of ${rows.length}` : rows.length}</b> version{rows.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
          <MultiSelect label={type === "pump" ? "Pump type" : "Spare type"} options={options.subtype} value={picks.subtype} onChange={pick("subtype")} />
          <MultiSelect label="Rep" options={options.rep} value={picks.rep} onChange={pick("rep")} />
          <MultiSelect label="Zone" options={options.zone} value={picks.zone} onChange={pick("zone")} />
          <MultiSelect label="Market" options={options.market} value={picks.market} onChange={pick("market")} />
          <MultiSelect label="Reviewed by" options={options.reviewer} value={picks.reviewer} onChange={pick("reviewer")} />
          <MultiSelect label="Sent by" options={options.sender} value={picks.sender} onChange={pick("sender")} />
          <Tabs value={mailedFilter} onValueChange={(v) => setMailedFilter(v === "mailed" ? "mailed" : v === "not" ? "not" : "all")}>
            <TabsList aria-label="Mailed">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="mailed">Mailed</TabsTrigger>
              <TabsTrigger value="not">Not mailed</TabsTrigger>
            </TabsList>
          </Tabs>
          <DateRangeFilter state={dates} fromLabel="Sent from" toLabel="Sent to" />
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X /> Clear filters
            </Button>
          )}
        </div>
      </Card>

      {mailError && (
        <p className="mt-3 flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/8 px-4 py-2.5 text-[13px] font-medium text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" />
          {mailError}
        </p>
      )}

      <Card className="mt-4 overflow-x-auto">
        {failed && <p className="px-4 py-6 text-[13px] font-medium text-destructive">Couldn&apos;t load the list.</p>}
        {!failed && rows === null && <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>}
        {rows !== null && shown.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            {rows.length > 0 ? "No enquiry matches these filters." : mine ? "Nothing you created has been sent to operation yet." : "Nothing has been sent to operation yet."}
          </p>
        )}
        {shown.length > 0 && (
          <table className="w-full min-w-[1380px] border-collapse">
            <thead className="border-b border-border bg-muted/60">
              <tr>
                <th className={th}>Enq No. / Date</th>
                <th className={th}>Version</th>
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
            <tbody className="divide-y divide-border">
              {shown.map((r) => {
                const reps = [r.primaryRep, r.secondaryReps].filter(Boolean).join(", ");
                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted/50">
                    <td className={td}>
                      <TwoLines top={<span className="font-mono font-semibold break-all text-primary">{r.projectCode}</span>} below={fmtDate(r.enquiryDate)} />
                    </td>
                    {/* Its own column: a version never goes beside the enquiry no. */}
                    <td className={td}>
                      <Badge tone="neutral" className="font-mono">
                        V{r.version}
                      </Badge>
                    </td>
                    <td className={td}>
                      {r.quotations.length === 0 && <span className="text-[12.5px] text-muted-foreground">—</span>}
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
                      <TwoLines top={<span className="font-medium">{r.clientName}</span>} below={<span className="font-mono">{r.clientCode || "—"}</span>} />
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
                          <span className="text-[12.5px] text-muted-foreground">—</span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOpened({ id: r.id, title: r.projectCode, doc: c.key })}
                            aria-label={`${c.label} V${r.version} of ${r.projectCode}`}
                          >
                            <Eye /> View
                          </Button>
                        )}
                      </td>
                    ))}
                    <td className={td}>
                      {r.mailedAt ? (
                        <>
                          <Badge tone="success" dot>
                            Mailed
                          </Badge>
                          <span className="mt-1 block text-[11.5px] whitespace-nowrap text-muted-foreground">
                            {fmtDay(r.mailedAt)}
                            {r.mailedByName ? ` · ${r.mailedByName}` : ""}
                          </span>
                        </>
                      ) : canMarkMailed ? (
                        <Button size="sm" onClick={() => setMailing(r)} title="Confirm this version was mailed to the client">
                          <Mail /> Mailed
                        </Button>
                      ) : (
                        <Badge tone="neutral" dot>
                          Not mailed
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {opened && <DocsModal opened={opened} onClose={() => setOpened(null)} />}

      <ConfirmDialog
        open={mailing !== null}
        title="Confirm it is mailed to the client?"
        description={
          <>
            Records that the documents of <b>{mailing?.projectCode}</b> were mailed to {mailing?.clientName}, for everyone to see. This can&apos;t be undone here, and the portal doesn&apos;t send the mail itself.
          </>
        }
        confirmLabel="Yes, it is mailed"
        busy={busy}
        onClose={() => setMailing(null)}
        onConfirm={() => void confirmMailed()}
      />
    </div>
    </div>
  );
}
