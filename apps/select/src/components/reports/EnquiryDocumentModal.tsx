"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../ui/EmptyState";
import Spinner from "../ui/Spinner";
import {
  EMPTY_TECH_DOC_CONFIG,
  TECH_DOC_SECTIONS,
  buildTechDoc,
  buildTechDocHtml,
  techDocGroupLabel,
  techDocExtrasFor,
  techDocGroups,
  techDocSheet,
  type TechDocConfig,
  type TechDocData,
  type TechDocGroup,
  type TechDocVersion,
} from "../../lib/tech-doc";
import TechDocEditor, { DocHeaderEditor } from "./TechDocEditor";
import { downloadTechDocExcel } from "../../lib/tech-doc-excel";
import { printHtml } from "../../lib/enquiry-print";
import {
  getEnquiryDocument,
  listTechDocVersions,
  saveEnquiryDocumentConfig,
  sendTechDocToClient,
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
// Same buttons as the Commercial Offer popup.
const frameBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const framePrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

const EnquiryDocumentModal = ({ source, onClose }: { source: EnquiryDocumentSource; onClose: () => void }) => {
  const [data, setData] = useState<TechDocData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One sheet per drive group, each with its own edits.
  const [configs, setConfigs] = useState<Record<string, TechDocConfig>>({});
  const [activeGroup, setActiveGroup] = useState<TechDocGroup | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [showPicker, setShowPicker] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [printing, setPrinting] = useState(false);
  // Client versions (sent sheets) of every group; one may be open read-only.
  const [versions, setVersions] = useState<TechDocVersion[] | null>(null);
  const [viewing, setViewing] = useState<TechDocVersion | null>(null);
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
    !!config.quotationText ||
    !!config.erpText ||
    (config.headerHidden?.length ?? 0) > 0;
  const resetAll = () => updateConfig({ ...EMPTY_TECH_DOC_CONFIG, extras: config.extras });

  const doc = useMemo(
    () => (data && group ? techDocSheet({ ...data, configs }, group) : null),
    [data, configs, group],
  );
  // What is shown / printed / exported: the open sent version, else the live sheet.
  const shown = viewing ? viewing.sheet : doc;
  const html = useMemo(
    () => (shown ? buildTechDocHtml(shown, typeof window !== "undefined" ? `${window.location.origin}/logo.png` : "/logo.png") : ""),
    [shown],
  );
  const groupVersions = (versions ?? []).filter((v) => v.group === group);
  const sendToClient = async () => {
    if (!group || sending) return;
    setSending(true);
    setSendError("");
    try {
      const list = await sendTechDocToClient(source.projectId, group, sendNote.trim());
      setVersions(list);
      setSendNote("");
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSendError(msg || "Couldn't send — try again.");
    } finally {
      setSending(false);
    }
  };
  const isLoading = data === null && error === null;
  const hasTags = (doc?.tags.length ?? 0) > 0;

  const handlePrint = async () => {
    if (!html) return;
    setPrinting(true);
    try {
      await printHtml(html);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">
              Technical Data Sheet
              <span className="ml-2 text-[13px] font-normal text-fg-3">{source.projectCode}</span>
            </h3>
            <p className="text-[12.5px] text-fg-3">
              {source.projectName || "—"}
              {data ? ` · ${data.tags.length} confirmed tag${data.tags.length === 1 ? "" : "s"}` : ""}
              {groups.length > 1 ? ` · ${groups.length} drive groups, one sheet each` : ""}
            </p>
          </div>
          <button type="button" className={frameBtn} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {isLoading && (
            <div className="py-6 text-center">
              <Spinner caption="Loading document…" />
            </div>
          )}
          {error && <p className="text-[13px] text-neg">{error}</p>}
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
                          setViewing(null);
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${
                          g === group ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-fg-2 hover:border-accent"
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
              {/* Client versions of this sheet + Send to client */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunk px-3 py-2 text-[12.5px]">
                <span className="font-semibold text-fg-2">Client versions:</span>
                {versions === null ? (
                  <span className="text-fg-3">Loading…</span>
                ) : groupVersions.length === 0 ? (
                  <span className="text-fg-3">Not sent yet</span>
                ) : (
                  groupVersions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setViewing(viewing?.id === v.id ? null : v)}
                      title={[v.createdByName && `Sent by ${v.createdByName}`, v.note].filter(Boolean).join(" — ") || undefined}
                      className={`rounded-full border px-2.5 py-0.5 font-semibold ${
                        viewing?.id === v.id ? "border-accent bg-accent text-white" : "border-line bg-paper text-fg-2 hover:border-accent"
                      }`}
                    >
                      V{v.version} · {v.createdAt ? new Date(v.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}
                    </button>
                  ))
                )}
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  <input
                    className="w-[200px] rounded-md border border-line bg-paper px-2 py-1 text-[12.5px] text-fg outline-none focus:border-accent"
                    placeholder="Note (optional)"
                    value={sendNote}
                    maxLength={1000}
                    onChange={(e) => setSendNote(e.target.value)}
                    aria-label="Note for this version"
                  />
                  <button
                    type="button"
                    onClick={() => void sendToClient()}
                    disabled={sending || saveState === "saving" || !hasTags}
                    className="rounded-md bg-accent px-3 py-1 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Freeze this sheet as it is now as the next client version"
                  >
                    {sending ? "Sending…" : `Send to client → V${groupVersions.length ? Math.max(...groupVersions.map((v) => v.version)) + 1 : 0}`}
                  </button>
                </span>
                {sendError && <span className="w-full text-neg">{sendError}</span>}
              </div>

              {viewing && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-[12.5px] text-fg">
                  <span>
                    Viewing <b>Client V{viewing.version}</b> as sent
                    {viewing.createdAt ? ` on ${new Date(viewing.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                    {viewing.createdByName ? ` by ${viewing.createdByName}` : ""} — read-only.
                    {viewing.note ? <span className="text-fg-2"> Note: {viewing.note}</span> : null}
                  </span>
                  <button type="button" className="ml-auto font-semibold text-accent hover:underline" onClick={() => setViewing(null)}>
                    Back to current sheet
                  </button>
                </div>
              )}

              <div className={`flex flex-wrap items-center gap-2 ${viewing ? "hidden" : ""}`}>
                <div className="inline-flex rounded-lg border border-line bg-sunk p-0.5" role="tablist">
                  {(["preview", "edit"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded-md px-3 py-1 text-[12.5px] font-semibold ${
                        mode === m ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"
                      }`}
                    >
                      {m === "preview" ? "Preview" : "Edit rows"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowPicker((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent"
                  aria-expanded={showPicker}
                >
                  {showPicker ? "Hide parameters" : "Add parameters"}
                  {config.extras.length > 0 && (
                    <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">{config.extras.length}</span>
                  )}
                </button>
                {customised && (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-neg hover:bg-[var(--neg-soft)]"
                    title="Undo every removal, rename, edited value and manual row"
                  >
                    Reset edits
                  </button>
                )}
                <span className="text-[12px] text-fg-3">
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

              {showPicker && !viewing && (
                <div className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-sunk p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {TECH_DOC_SECTIONS.map((section) => {
                    const fields = techDocExtrasFor(doc?.tags ?? []).filter((f) => f.section === section);
                    if (fields.length === 0) return null;
                    return (
                      <fieldset key={section} className="min-w-0">
                        <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">
                          {section}
                        </legend>
                        <div className="flex flex-col gap-1">
                          {fields.map((f) => (
                            <label key={f.key} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-fg">
                              <input
                                type="checkbox"
                                checked={config.extras.includes(f.key)}
                                onChange={() => toggleExtra(f.key)}
                                className="h-3.5 w-3.5 accent-[var(--brand-blue)]"
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

              {mode === "edit" && doc && !viewing ? (
                <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
                  <DocHeaderEditor
                    hidden={config.headerHidden ?? []}
                    onHiddenChange={(next) => updateConfig({ ...config, headerHidden: next as TechDocConfig["headerHidden"] })}
                    fields={[
                      { key: "client", label: "Client Name", value: "", auto: data?.clientName ?? "" },
                      { key: "enquiry", label: "Enquiry No. & Date", value: "", auto: data?.enquiry ?? "" },
                      {
                        key: "quotation",
                        label: "Quotation No. & Date",
                        value: config.quotationText ?? "",
                        auto: (group && data?.quotations[group]) || "",
                        onChange: (v) => updateConfig({ ...config, quotationText: v }),
                      },
                      {
                        key: "erp",
                        label: "Quotation No. & Date (ERP)",
                        value: config.erpText ?? "",
                        auto: (group && data?.erpNumbers?.[group]) || "",
                        onChange: (v) => updateConfig({ ...config, erpText: v }),
                      },
                    ]}
                  />
                  <TechDocEditor
                    tags={doc.tags}
                    blocks={buildTechDoc(doc.tags, config, { includeHidden: true })}
                    config={config}
                    onChange={updateConfig}
                  />
                </div>
              ) : (
                /* The printable sheet itself, so what you see is what prints. */
                <iframe
                  title="Technical Data Sheet"
                  srcDoc={html}
                  className="min-h-[62vh] w-full flex-1 rounded-lg border border-line bg-white"
                />
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          {/* Native print dialog - the user picks paper size, orientation,
              page range and "Save as PDF". */}
          <button type="button" className={framePrimary} onClick={handlePrint} disabled={printing || !hasTags}>
            {printing ? "Preparing…" : "Print / Save as PDF"}
          </button>
          <button type="button" className={frameBtn} onClick={() => shown && downloadTechDocExcel(shown)} disabled={!hasTags}>
            Download Excel
          </button>
        </footer>
      </div>
    </div>
  );
};

export default EnquiryDocumentModal;
