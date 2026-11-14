// Asking for the workbook, and handing it to the browser.
//
// Client-only: it touches document. A server action cannot do this job —
// an action returns a value through the React stream, and what is wanted
// here is a response with Content-Disposition on it, which is a route.
//
// The filename is the server's to choose. It is the one place that knows the
// report's real title, and a name invented here would drift from it.

import type { PageFilters } from '@/lib/custom-analytics/types';
import type { CrossFilter } from '@/lib/custom-analytics/engine';

export interface ExportRequest {
  id: number;
  pageId?: string;
  /** One card, rather than the whole page. */
  visualId?: string;
  filters: PageFilters;
  cross?: CrossFilter | null;
}

/** Null when the file is on its way; otherwise what went wrong, in words. */
export async function downloadReportSheet(req: ExportRequest): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch('/api/risansi/reports/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    return 'Could not reach the server.';
  }

  if (!res.ok) {
    // The route answers with plain text, which is already a sentence.
    const said = await res.text().catch(() => '');
    return said.trim() || `The export failed (${res.status}).`;
  }

  const blob = await res.blob();
  const name = filenameOf(res.headers.get('Content-Disposition')) ?? 'report.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: Safari has not finished with the URL when
  // click() returns, and revoking it immediately gives a zero-byte file.
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
  return null;
}

function filenameOf(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="([^"]+)"/.exec(header) ?? /filename=([^;]+)/.exec(header);
  return m ? m[1].trim() : null;
}
