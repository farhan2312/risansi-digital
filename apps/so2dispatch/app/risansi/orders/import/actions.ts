"use server";

import { getCurrentUser } from "@/lib/session";
import { canImportOrders } from "@/lib/roles";
import {
  enrichClients,
  flagDuplicateSoNos,
  parseOrderWorkbook,
  type ImportRow,
  type ParsedImport,
} from "@/lib/order-import";
import { createOrderAction } from "../actions";

// Excel files are small; this only guards against an accidental huge upload.
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type ParseImportResult =
  | { ok: true; parsed: ParsedImport }
  | { ok: false; error: string };

export async function parseImportAction(
  formData: FormData
): Promise<ParseImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canImportOrders(user.role)) {
    return { ok: false, error: "You don't have permission to create orders." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an .xlsx file to import." };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: "That file is larger than 5 MB." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "Only .xlsx files can be imported." };
  }

  try {
    const parsed = await parseOrderWorkbook(
      Buffer.from(await file.arrayBuffer())
    );
    if (parsed.rows.length === 0) {
      return { ok: false, error: "That sheet has no data rows." };
    }
    return { ok: true, parsed };
  } catch (error) {
    console.error("parseOrderWorkbook failed:", error);
    return { ok: false, error: "Could not read that workbook." };
  }
}

export type CommitImportResult =
  | { ok: true; created: number; failures: { rowNo: number; error: string }[] }
  | { ok: false; error: string };

/**
 * Create one order per row. The browser sends back the rows it previewed, so
 * everything is re-validated here — duplicates are re-checked against the live
 * table and client details are re-read from the directory rather than trusted.
 */
export async function commitImportAction(
  rows: ImportRow[]
): Promise<CommitImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canImportOrders(user.role)) {
    return { ok: false, error: "You don't have permission to create orders." };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "Nothing to import." };
  }

  // Drop anything the preview already flagged, then re-run the checks that
  // depend on live state (the table may have moved on since the preview).
  const candidates: ImportRow[] = rows
    .filter((r) => r && Array.isArray(r.errors) && r.errors.length === 0)
    .map((r) => ({
      rowNo: Number(r.rowNo),
      values: { ...r.values },
      errors: [],
      warnings: [],
    }));
  if (candidates.length === 0) {
    return { ok: false, error: "Every row has an error — fix the sheet first." };
  }

  try {
    await enrichClients(candidates);
    await flagDuplicateSoNos(candidates);
  } catch (error) {
    console.error("import re-validation failed:", error);
    return { ok: false, error: "Could not validate the rows. Please retry." };
  }

  let created = 0;
  const failures: { rowNo: number; error: string }[] = [];

  for (const row of candidates) {
    if (row.errors.length > 0) {
      failures.push({ rowNo: row.rowNo, error: row.errors[0] });
      continue;
    }
    const res = await createOrderAction(row.values);
    if (res.ok) created += 1;
    else failures.push({ rowNo: row.rowNo, error: res.error });
  }

  return { ok: true, created, failures };
}
