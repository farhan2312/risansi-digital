"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileSpreadsheet, History, ListPlus, Printer, RotateCcw, Save, X } from "lucide-react";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import EmptyState from "../ui/EmptyState";
import Spinner from "../ui/Spinner";
import {
  EMPTY_TECH_DOC_CONFIG,
  TECH_DOC_SECTIONS,
  buildTechDoc,
  buildTechDocHtml,
  techDocGroupLabel,
  sameSavedTechDocSheet,
  techDocExtrasFor,
  techDocGroups,
  techDocSheet,
  techDocGroupOf,
  type TechDocConfig,
  type TechDocData,
  type TechDocGroup,
  type TechDocVersion,
  type ScopeLines,
} from "../../lib/tech-doc";
import TechDocEditor, { DocHeaderEditor, DocScopeEditor, DocTagPicker } from "./TechDocEditor";
import { saveOfferScopeText } from "../../services/commercialOfferService";
import { downloadTechDocExcel } from "../../lib/tech-doc-excel";
import { printHtml } from "../../lib/enquiry-print";
import PrintPageSizeSelect, { usePrintPageSize } from "./PrintPageSize";
import {
  getEnquiryDocument,
  listTechDocVersions,
  saveEnquiryDocumentConfig,
  sendTechDocToOperation,
} from "../../services/enquiryDocumentService";

export interface EnquiryDocumentSource {
  projectId: string;
  projectCode: string;
  projectName?: string | null;
}

/**
 * The enquiry's Technical Data Sheet — the Risansi quotation format, one column
 * per confirmed tag (lib/tech-doc.ts). Per enquiry, rows can be added from the
 * optional list ("Add parameters"), removed, renamed, have values edited, or be
 * typed in by hand ("Edit rows") — saved in projects.tech_doc_config, never
 * touching the wizard data. The preview is the exact HTML that prints.
 *
 * Shown from both the Reports page and the Enquiries page.
 */
const EnquiryDocumentModal = ({
  source,
  readOnly = false,
  onClose,
}: {
  source: EnquiryDocumentSource;
  /** View only - for someone who may not work on this enquiry (a worker it is
   *  not assigned to, or an older version): no edits, no Save Version. */
  readOnly?: boolean;
  onClose: () => void;
}) => {
  const [data, setData] = useState<TechDocData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One sheet per drive group, each with its own edits.
  const [configs, setConfigs] = useState<Record<string, TechDocConfig>>({});
  // Per drive group: the Scope of supply / Out of scope lines typed on a
  // document ("" = from the scope pickers). Shared with the Commercial Offer.
  const [typedScopes, setTypedScopes] = useState<Record<string, ScopeLines>>({});
  const [activeGroup, setActiveGroup] = useState<TechDocGroup | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [showPicker, setShowPicker] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [printing, setPrinting] = useState(false);
  const [pageSize, setPageSize] = usePrintPageSize();
  // Every Save Version, of every group, newest first.
  const [versions, setVersions] = useState<TechDocVersion[] | null>(null);
  const [sendNote, setSendNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  useEffect(() => {
    let cancelled = false;
    listTechDocVersions(source.projectId)
      .then((v) => !cancelled && setVersions(v))
      .catch(() => !cancelled && setVersions([]));
    return () => {
      cancelled = true;
    };
  }, [source.projectId]);
  // Pending save per group, so switching tabs never drops another group's edit.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    getEnquiryDocument(source.projectId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setConfigs(d.configs);
        setTypedScopes(Object.fromEntries(Object.entries(d.scopeEdit ?? {}).map(([g, e]) => [g, e.typed])));
      })
      .catch(() => !cancelled && setError("Couldn't load the enquiry document."));
    return () => {
      cancelled = true;
    };
  }, [source.projectId]);

  useEffect(() => () => Object.values(saveTimers.current).forEach(clearTimeout), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = data ? techDocGroups(data) : [];
  const group: TechDocGroup | null = activeGroup && groups.includes(activeGroup) ? activeGroup : (groups[0] ?? null);
  const config = (group && configs[group]) || EMPTY_TECH_DOC_CONFIG;

  // Every change applies to the sheet at once and is saved shortly after
  // (typing in the editor doesn't fire a request per keystroke).
  const updateConfig = (next: TechDocConfig) => {
    if (!group) return;
    const g = group;
    setConfigs((m) => ({ ...m, [g]: next }));
    setSaveState("saving");
    clearTimeout(saveTimers.current[g]);
    saveTimers.current[g] = setTimeout(() => {
      saveEnquiryDocumentConfig(source.projectId, g, next)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 700);
  };
  // Typed scope lines: shown at once, saved to the group's offer config.
  const updateScope = (next: ScopeLines) => {
    if (!group || group === "NONE") return;
    const g = group;
    setTypedScopes((m) => ({ ...m, [g]: next }));
    setSaveState("saving");
    const key = `scope:${g}`;
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      saveOfferScopeText(source.projectId, g, { scopeText: next.scope, outOfScopeText: next.out })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 700);
  };
  const pickedScopes = group ? data?.scopeEdit?.[group]?.picked : undefined;
  const typedScope = (group && typedScopes[group]) || { scope: "", out: "" };
  const toggleExtra = (key: string) => {
    const on = config.extras.includes(key);
    updateConfig({
      ...config,
      extras: on ? config.extras.filter((k) => k !== key) : [...config.extras, key],
      // Adding an optional row back also un-removes it.
      hidden: on ? config.hidden : config.hidden.filter((k) => k !== key),
    });
  };
  const customised =
    config.hidden.length + Object.keys(config.labels).length + Object.keys(config.values).length + config.custom.length > 0 ||
    !!config.enquiryText ||
    !!config.quotationText ||
    !!config.erpText ||
    (config.headerHidden?.length ?? 0) > 0 ||
    (config.hiddenTags?.length ?? 0) > 0;
  // Every tag of the open sheet's group, for choosing which ones it prints.
  const groupTags = useMemo(() => (data && group ? data.tags.filter((t) => techDocGroupOf(t) === group) : []), [data, group]);
  const resetAll = () => updateConfig({ ...EMPTY_TECH_DOC_CONFIG, extras: config.extras });

  const doc = useMemo(() => {
    if (!data || !group) return null;
    // The printed lines: typed, else from the pickers.
    const scopes = { ...(data.scopes ?? {}) };
    for (const [g, e] of Object.entries(data.scopeEdit ?? {})) {
      const t = typedScopes[g] ?? e.typed;
      scopes[g] = { scope: t.scope || e.picked.scope, out: t.out || e.picked.out };
    }
    return techDocSheet({ ...data, configs, scopes }, group);
  }, [data, configs, group, typedScopes]);
  const locked = readOnly;
  const html = useMemo(
    () => (doc ? buildTechDocHtml(doc, typeof window !== "undefined" ? `${window.location.origin}/logo.png` : "/logo.png") : ""),
    [doc],
  );
  const groupSends = (versions ?? []).filter((v) => v.group === group);
  const lastSent = groupSends[0] ?? null;
  // It can be saved again once the sheet has changed since the last save.
  const editedSinceSent = Boolean(lastSent && doc && !sameSavedTechDocSheet(lastSent.sheet, doc));
  const sendToOperation = async () => {
    if (!group || sending) return;
    setSending(true);
    setSendError("");
    try {
      const list = await sendTechDocToOperation(source.projectId, group, sendNote.trim());
      setVersions(list);
      setSendNote("");
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || "Couldn't save the version — try again.");
    } finally {
      setSending(false);
    }
  };
  const versionText = data ? `V${data.versionNo}` : "";
  const isLoading = data === null && error === null;
  const hasTags = (doc?.tags.length ?? 0) > 0;

  const handlePrint = async () => {
    if (!html) return;
    setPrinting(true);
    try {
      await printHtml(html, pageSize);
    } finally {
      setPrinting(false);
    }
  };

  return (
    // A plain overlay, not a Radix Dialog: printing goes through a hidden iframe added to
    // the page body (lib/enquiry-print), which a Radix focus trap would fight.
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tech-doc-title"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[0_24px_64px_rgba(15,23,42,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="grid shrink-0 gap-1 border-b border-border px-5 py-4 pr-12">
          <h3 id="tech-doc-title" className="text-[15px] leading-snug font-semibold text-foreground">
            Technical Data Sheet
            <span className="ml-2 font-mono text-[12.5px] font-normal text-muted-foreground">{source.projectCode}</span>
          </h3>
          <p className="text-[12.5px] text-muted-foreground">
            {source.projectName || "—"}
            {data ? ` · ${data.tags.length} confirmed tag${data.tags.length === 1 ? "" : "s"}` : ""}
            {groups.length > 1 ? ` · ${groups.length} drive groups, one sheet each` : ""}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
            aria-label="Close"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="py-6 text-center">
              <Spinner caption="Loading document…" />
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12.5px] font-medium text-destructive">
              {error}
            </p>
          )}
          {!isLoading && !error && !hasTags && (
            <EmptyState
              compact
              icon="alert"
              title="No document available yet"
              description="No tag on this enquiry has a confirmed selection yet. Confirm a pump on the last wizard step to build the data sheet."
            />
          )}

          {!isLoading && !error && hasTags && (
            <div className="flex flex-col gap-3">
              {groups.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Drive system">
                  {groups.map((g) => {
                    const n = data ? techDocSheet(data, g).tags.length : 0;
                    return (
                      <button
                        key={g}
                        type="button"
                        role="tab"
                        aria-selected={g === group}
                        onClick={() => {
                          setActiveGroup(g);
                        }}
                        className={`inline-flex h-8 items-center rounded-md border px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
                          g === group
                            ? "border-primary/30 bg-primary/8 text-primary"
                            : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
                        }`}
                      >
                        {techDocGroupLabel(g)}
                        {g !== "NONE" && data?.mixed && <span className="ml-1 font-mono text-[11px] opacity-75">/{g}</span>}
                        <span className="ml-1.5 font-normal opacity-75">· {n} tag{n === 1 ? "" : "s"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Save Version: again whenever the sheet has changed */}
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <History className="size-3.5 text-muted-foreground" /> Version {versionText}:
                </span>
                {versions === null ? (
                  <span className="text-muted-foreground">Loading…</span>
                ) : !lastSent ? (
                  <span className="text-muted-foreground">Not saved yet</span>
                ) : (
                  <span className="text-foreground/85" title={lastSent.note || undefined}>
                    Saved {lastSent.createdAt ? new Date(lastSent.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
                    {lastSent.createdByName ? ` by ${lastSent.createdByName}` : ""}
                    {groupSends.length > 1 ? ` · saved ${groupSends.length} times` : ""}
                  </span>
                )}
                {editedSinceSent && (
                  <Badge tone="warning" dot>
                    Edited since then
                  </Badge>
                )}
                <span className={`ml-auto flex flex-wrap items-center gap-1.5 ${readOnly ? "hidden" : ""}`}>
                  <Input
                    className="h-7 w-[200px]"
                    placeholder="Note (optional)"
                    value={sendNote}
                    maxLength={1000}
                    onChange={(e) => setSendNote(e.target.value)}
                    aria-label="Note for this version"
                  />
                  <Button
                    size="sm"
                    onClick={() => void sendToOperation()}
                    disabled={sending || saveState === "saving" || !hasTags || (Boolean(lastSent) && !editedSinceSent)}
                    title={lastSent && !editedSinceSent ? "Nothing has changed since it was saved" : `Save this sheet as Version ${versionText}`}
                  >
                    <Save /> {sending ? "Saving…" : lastSent && !editedSinceSent ? `Version ${versionText} saved` : `Save Version ${versionText}`}
                  </Button>
                </span>
                {sendError && <span className="w-full font-medium text-destructive">{sendError}</span>}
              </div>

              {readOnly && (
                <div className="flex items-center gap-1.5 rounded-md border border-info/25 bg-info/8 px-3 py-2 text-[12.5px] text-info">
                  <Eye className="size-3.5" /> View only - you can print or download it.
                </div>
              )}

              <div className={`flex flex-wrap items-center gap-2 ${locked ? "hidden" : ""}`}>
                <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 ring-1 ring-border ring-inset" role="tablist">
                  {(["preview", "edit"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={`inline-flex h-7 items-center rounded-[5px] px-3 text-[12.5px] font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${
                        mode === m ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.1)]" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "preview" ? "Preview" : "Edit rows"}
                    </button>
                  ))}
                </div>
                <Button variant="outline" onClick={() => setShowPicker((v) => !v)} aria-expanded={showPicker}>
                  <ListPlus /> {showPicker ? "Hide parameters" : "Add parameters"}
                  {config.extras.length > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{config.extras.length}</span>}
                </Button>
                {customised && (
                  <Button variant="ghost-destructive" onClick={resetAll} title="Undo every removal, rename, edited value and manual row">
                    <RotateCcw /> Reset edits
                  </Button>
                )}
                <span
                  className={`text-[12px] ${
                    saveState === "error" ? "text-destructive" : saveState === "saved" ? "text-success" : "text-muted-foreground"
                  }`}
                >
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "saved"
                      ? "Saved for this enquiry"
                      : saveState === "error"
                        ? "Couldn't save — the changes still apply for now"
                        : mode === "edit"
                          ? "Rename, edit, remove or add rows — saved for this enquiry."
                          : "Add optional rows, or switch to Edit rows to change the sheet."}
                </span>
              </div>

              {!locked && (
                <DocTagPicker
                  tags={groupTags}
                  hidden={config.hiddenTags ?? []}
                  onChange={(next) => updateConfig({ ...config, hiddenTags: next })}
                />
              )}

              {showPicker && !locked && (
                <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-muted/40 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {TECH_DOC_SECTIONS.map((section) => {
                    const fields = techDocExtrasFor(doc?.tags ?? []).filter((f) => f.section === section);
                    if (fields.length === 0) return null;
                    return (
                      <fieldset key={section} className="min-w-0">
                        <legend className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{section}</legend>
                        <div className="flex flex-col gap-1">
                          {fields.map((f) => (
                            <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12.5px] text-foreground hover:bg-card">
                              <input
                                type="checkbox"
                                checked={config.extras.includes(f.key)}
                                onChange={() => toggleExtra(f.key)}
                                className="size-3.5 rounded border-input accent-[var(--sc-primary)]"
                              />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              )}

              {mode === "edit" && doc && !locked ? (
                <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
                  <DocHeaderEditor
                    hidden={config.headerHidden ?? []}
                    onHiddenChange={(next) => updateConfig({ ...config, headerHidden: next as TechDocConfig["headerHidden"] })}
                    fields={[
                      { key: "client", label: "Client Name", value: "", auto: data?.clientName ?? "" },
                      {
                        key: "enquiry",
                        label: "Enquiry No. & Date",
                        value: config.enquiryText ?? "",
                        auto: data?.enquiry ?? "",
                        onChange: (v) => updateConfig({ ...config, enquiryText: v }),
                      },
                      {
                        key: "quotation",
                        label: "Quotation No. & Date",
                        value: config.erpText ?? "",
                        auto: (group && data?.erpNumbers?.[group]) || "",
                        onChange: (v) => updateConfig({ ...config, erpText: v }),
                      },
                    ]}
                  />
                  {group !== "NONE" && pickedScopes && (
                    <DocScopeEditor
                      scope={typedScope.scope}
                      out={typedScope.out}
                      autoScope={pickedScopes.scope}
                      autoOut={pickedScopes.out}
                      onChange={updateScope}
                    />
                  )}
                  <TechDocEditor
                    tags={doc.tags}
                    blocks={buildTechDoc(doc.tags, config, { includeHidden: true })}
                    config={config}
                    onChange={updateConfig}
                  />
                </div>
              ) : (
                /* The printable sheet itself, so what you see is what prints. */
                <iframe title="Technical Data Sheet" srcDoc={html} className="min-h-[62vh] w-full flex-1 rounded-md border border-border bg-white" />
              )}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          {/* Native print dialog - the user picks paper size, orientation,
              page range and "Save as PDF". */}
          <PrintPageSizeSelect value={pageSize} onChange={setPageSize} />
          <Button onClick={handlePrint} disabled={printing || !hasTags}>
            <Printer /> {printing ? "Preparing…" : "Print / Save as PDF"}
          </Button>
          <Button variant="outline" onClick={() => doc && downloadTechDocExcel(doc)} disabled={!hasTags}>
            <FileSpreadsheet /> Download Excel
          </Button>
        </footer>
      </div>
    </div>
  );
};

export default EnquiryDocumentModal;
