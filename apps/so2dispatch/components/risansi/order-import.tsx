"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Download,
  Loader2,
  RotateCcw,
  Upload,
  XCircle,
} from "lucide-react";
import {
  commitImportAction,
  parseImportAction,
} from "@/app/risansi/orders/import/actions";
import type { ImportRow, ParsedImport } from "@/lib/order-import";
import { TEMPLATE_HEADERS } from "@/lib/order-import-headers";

// Preview columns, in sheet order. Values that came from the client directory
// rather than the sheet are marked so it's obvious they were filled in.
const PREVIEW_COLUMNS: {
  key: keyof ImportRow["values"];
  label: string;
  enriched?: boolean;
  format?: "date" | "number";
}[] = [
  { key: "client_code", label: "Client Code" },
  { key: "client_name", label: "Client Name", enriched: true },
  { key: "quotation_no", label: "Quotation No." },
  { key: "so_no", label: "SO No." },
  { key: "so_date", label: "SO Date", format: "date" },
  { key: "order_type", label: "Order Type" },
  { key: "po_no", label: "Cust PO No." },
  { key: "customer_po_date", label: "PO Date", format: "date" },
  { key: "payment_terms_remarks", label: "Payment Terms Remarks" },
  { key: "ld", label: "LD" },
  { key: "ld_date", label: "LD Date", format: "date" },
  { key: "total_quantity", label: "Qty", format: "number" },
  { key: "order_value", label: "Order Value", format: "number" },
];

// Match how the rest of the app renders dates and amounts.
function formatCell(value: string | undefined, format?: "date" | "number"): string {
  if (!value) return "—";
  if (format === "date") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (format === "number") {
    const n = Number(value);
    if (Number.isFinite(n)) return new Intl.NumberFormat("en-IN").format(n);
  }
  return value;
}

type Summary = { created: number; failures: { rowNo: number; error: string }[] };

function StatTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
        ? "text-rose-600"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-card-border bg-background px-4 py-3">
      <div className={`font-display text-2xl font-bold tabular-nums ${toneClass}`}>
        {value}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function OrderImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const validRows = parsed?.rows.filter((r) => r.errors.length === 0) ?? [];
  const badRows = parsed?.rows.filter((r) => r.errors.length > 0) ?? [];

  async function handleFile(file: File) {
    setError(null);
    setSummary(null);
    setParsed(null);
    setFileName(file.name);
    setParsing(true);

    const formData = new FormData();
    formData.append("file", file);
    const res = await parseImportAction(formData);
    setParsing(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setParsed(res.parsed);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function runImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    setError(null);
    const res = await commitImportAction(validRows);
    setImporting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSummary({ created: res.created, failures: res.failures });
    setParsed(null);
    router.refresh();
  }

  function reset() {
    setParsed(null);
    setSummary(null);
    setError(null);
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const showDropzone = !parsed && !summary;

  return (
    <div className="space-y-5">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Step 1 — pick the file. */}
      {showDropzone && (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-12 ${
            dragging
              ? "border-primary bg-primary/[0.05]"
              : "border-card-border bg-surface hover:border-primary/40"
          }`}
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            {parsing ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-6 w-6" />
            )}
          </div>

          <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
            {parsing ? "Reading the sheet…" : "Drop the daily sheet here"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {parsing
              ? fileName
              : "or browse for it — one .xlsx file, up to 5 MB"}
          </p>

          {!parsing && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Upload className="h-4 w-4" />
                Choose file
              </button>
              {/* Blank workbook with just the header row, so the daily sheet
                  always starts from the columns the parser expects. */}
              <a
                href="/risansi/orders/import/template"
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-input-border bg-surface px-5 text-sm font-semibold text-foreground transition-colors hover:bg-background"
              >
                <Download className="h-4 w-4" />
                Download sample headers
              </a>
            </div>
          )}

          <div className="mx-auto mt-8 max-w-3xl border-t border-card-border pt-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Expected columns
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {TEMPLATE_HEADERS.map((h) => (
                <span
                  key={h}
                  className="rounded-full border border-card-border bg-background px-2.5 py-1 text-xs text-muted"
                >
                  {h}
                </span>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">
              Client name, market type, zone and rep are filled in from the
              client directory. Dates may be Excel dates or dd/mm/yyyy, and
              order values are read as INR.
            </p>
          </div>
        </section>
      )}

      {/* Step 3 — what happened. */}
      {summary && (
        <section className="rounded-2xl border border-card-border bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-bold text-foreground">
            {summary.created} {summary.created === 1 ? "order" : "orders"}{" "}
            imported
          </h2>
          {summary.failures.length > 0 ? (
            <div className="mx-auto mt-5 max-w-xl rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-left">
              <p className="text-xs font-semibold uppercase tracking-wider text-danger">
                {summary.failures.length} row
                {summary.failures.length === 1 ? "" : "s"} could not be created
              </p>
              <ul className="mt-2 space-y-1 text-sm text-danger">
                {summary.failures.map((f) => (
                  <li key={f.rowNo}>
                    Row {f.rowNo}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Every row in the sheet was created.
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/risansi/orders"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              View orders
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-input-border bg-surface px-5 text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              <RotateCcw className="h-4 w-4" />
              Import another sheet
            </button>
          </div>
        </section>
      )}

      {/* Step 2 — check the preview, then commit. */}
      {parsed && (
        <section className="overflow-hidden rounded-2xl border border-card-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-card-border p-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
                <h2 className="truncate font-display text-base font-semibold text-foreground">
                  {fileName}
                </h2>
              </div>
              <p className="mt-1 text-sm text-muted">
                Review the rows below, then import.
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-2">
              <StatTile value={parsed.rows.length} label="Rows" tone="neutral" />
              <StatTile value={validRows.length} label="Ready" tone="good" />
              <StatTile
                value={badRows.length}
                label="Errors"
                tone={badRows.length > 0 ? "bad" : "neutral"}
              />
            </div>
          </div>

          {parsed.unmapped.length > 0 && (
            <p className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Ignored column{parsed.unmapped.length === 1 ? "" : "s"}:{" "}
              {parsed.unmapped.join(", ")}
            </p>
          )}

          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="border-b border-card-border px-4 py-3">Row</th>
                  <th className="border-b border-card-border px-4 py-3">
                    Status
                  </th>
                  {PREVIEW_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`border-b border-card-border px-4 py-3 whitespace-nowrap ${
                        c.format === "number" ? "text-right" : ""
                      }`}
                    >
                      {c.label}
                      {c.enriched && (
                        <span className="ml-1 font-medium normal-case tracking-normal text-primary">
                          (directory)
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {parsed.rows.map((row) => {
                  const bad = row.errors.length > 0;
                  const warned = row.warnings.length > 0;
                  return (
                    <tr
                      key={row.rowNo}
                      className={
                        bad
                          ? "bg-rose-50/50"
                          : "transition-colors hover:bg-background"
                      }
                    >
                      <td className="px-4 py-3 align-top tabular-nums text-muted-foreground">
                        {row.rowNo}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="w-[13rem]">
                        {bad ? (
                          <div className="space-y-1">
                            {row.errors.map((e, j) => (
                              <div
                                key={`e${j}`}
                                className="flex items-start gap-1.5 text-xs font-medium text-rose-600"
                              >
                                <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                                <span>{e}</span>
                              </div>
                            ))}
                          </div>
                        ) : warned ? (
                          <div className="space-y-1">
                            {row.warnings.map((w, j) => (
                              <div
                                key={`w${j}`}
                                className="flex items-start gap-1.5 text-xs font-medium text-amber-700"
                              >
                                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                                <span>{w}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Ready
                          </span>
                        )}
                        </div>
                      </td>
                      {PREVIEW_COLUMNS.map((c) => {
                        const value = row.values[c.key];
                        // Client names run long — cap and ellipsize that one
                        // column so the rest of the row stays on one line.
                        const wide = c.key === "client_name";
                        return (
                          <td
                            key={c.key}
                            title={wide ? value : undefined}
                            className={`px-4 py-3 align-top ${
                              wide ? "max-w-[15rem] truncate" : "whitespace-nowrap"
                            } ${c.format === "number" ? "text-right tabular-nums" : ""} ${
                              value ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {formatCell(value, c.format)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border bg-background px-5 py-4">
            <p className="text-sm text-muted">
              {badRows.length > 0
                ? `${badRows.length} row${badRows.length === 1 ? "" : "s"} will be skipped.`
                : "All rows passed validation."}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={importing}
                className="h-10 rounded-[10px] border border-input-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface/60 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={importing || validRows.length === 0}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {importing
                  ? "Importing…"
                  : `Import ${validRows.length} ${validRows.length === 1 ? "order" : "orders"}`}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
