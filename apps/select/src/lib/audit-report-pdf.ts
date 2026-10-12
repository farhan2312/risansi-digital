/**
 * Detailed Audit Log report as a PDF — client-side jsPDF + jspdf-autotable,
 * the same stack and visual language as the Selection Summary quotation
 * (company logo, dark section bands, plain gridded tables).
 *
 * Landscape A4: the event tables carry a free-text Detail column that needs
 * the width. Unlike the quotation — which deliberately keeps each table on one
 * page — these tables are long lists, so they flow across pages and repeat
 * their header row on every page.
 *
 * Sections, in order:
 *   1. Summary               headline figures for the selected range
 *   2. Usage by User         active time, actions, logins, failures
 *   3. How to read Active    how active time is estimated and its limits -
 *      Time                  placed right under the table it explains
 *   4. Activity by Type      what was done, how often, by how many people
 *   5. Logins & Sessions
 *   6. Access Changes        role / status / account changes
 *   7. Activity Log          every recorded action
 */
import jsPDF from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";

import { formatDuration } from "./duration";
import { loadImageAsDataUrl } from "./selection-summary-pdf";
import type { AuditReport, AuditReportSection } from "../services/auditService";

type RGB = [number, number, number];

// House style, matching the quotation PDF.
const SECTION_BAND: RGB = [60, 60, 60];
const BAND_TEXT: RGB = [255, 255, 255];
const CELL_BORDER: RGB = [150, 150, 150];
const HEAD_FILL: RGB = [232, 235, 240];
const FAILED_TEXT: RGB = [170, 30, 30];

const MARGIN = 36;

const RANGE_LABELS: Record<string, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All recorded activity",
  custom: "Custom range",
};

const ROLE_LABELS: Record<string, string> = {
  system_admin: "System Admin",
  admin: "Admin",
  selection_head: "Selection Head",
  pulley_owner: "Pulley Owner",
  user: "User",
};

const prettyRole = (role: string | null | undefined) =>
  role ? ROLE_LABELS[role] ?? role : "—";

/** "user.role_change" -> "Role change". */
/** master.create/update/delete read as what happened to the master row. */
const MASTER_ACTIONS: Record<string, string> = {
  "end_connection.add": "End connection added",
  "flange_standard.add": "Flange standard added",
  "commercial.update": "Commercial prices updated",
  "product_pump.add": "Pump product code added",
  "quotation.create": "Quotation created",
  "quotation.tsm_change": "Quotation TSM changed",
  "quotation.internal_version": "Quotation internal version",
  "quotation.send": "Quotation sent to client",
  "master.create": "Master added",
  "master.update": "Master edited",
  "master.delete": "Master deleted",
  "user.request": "Access requested",
  "user.approve": "Approved request",
  "user.reject": "Rejected request",
  "user.create": "User added",
  "user.delete": "User deleted",
};

const prettyAction = (action: string | null | undefined): string => {
  if (!action) return "—";
  if (MASTER_ACTIONS[action]) return MASTER_ACTIONS[action];
  const tail = action.includes(".") ? action.slice(action.indexOf(".") + 1) : action;
  const words = tail.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "wizard.save" -> "Wizard · Save" - keeps the area for the by-type table. */
const actionWithArea = (action: string): string => {
  if (!action.includes(".")) return prettyAction(action);
  if (MASTER_ACTIONS[action]) return MASTER_ACTIONS[action];
  const area = action.slice(0, action.indexOf("."));
  return `${area.charAt(0).toUpperCase() + area.slice(1)} · ${prettyAction(action)}`;
};

const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/** "RIL/EN/26-27/1331 · Tag-1" plus the client on a second line, or "—". */
const enquiryTag = (r: {
  enquiryCode: string | null;
  tagName: string | null;
  clientName: string | null;
}): string => {
  const head = [r.enquiryCode, r.tagName].filter(Boolean).join(" · ");
  if (!head) return "—";
  return r.clientName ? `${head}\n${r.clientName}` : head;
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export interface AuditReportPdfInput {
  report: AuditReport;
  generatedBy?: string;
}

/** Builds the PDF and, by default, downloads it. `save: false` skips the
 *  download and just returns the bytes (same shape as
 *  downloadSelectionSummaryPdf) - used to render and check the output. */
export async function downloadAuditReportPdf(
  { report, generatedBy }: AuditReportPdfInput,
  opts: { save?: boolean } = {},
): Promise<{ filename: string; bytes: ArrayBuffer }> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - MARGIN - 20) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // Full-width dark band with a centred title - same as the quotation.
  const band = (title: string, subtitle?: string) => {
    // Room for the band, its subtitle, a table header and a few rows - so a
    // section never starts as a lone heading at the foot of a page.
    ensureSpace(110);
    doc.setFillColor(...SECTION_BAND);
    doc.rect(MARGIN, y, contentWidth, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...BAND_TEXT);
    doc.text(title, pageWidth / 2, y + 13.5, { align: "center" });
    y += 20;
    if (subtitle) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      doc.setTextColor(95);
      y += 12;
      doc.text(subtitle, MARGIN, y);
      y += 4;
    }
  };

  const table = (
    head: string[],
    body: RowInput[],
    columnStyles: Record<number, Record<string, unknown>> = {},
    didParseCell?: (data: {
      section: string;
      column: { index: number };
      cell: { raw: unknown; styles: { textColor: unknown; fontStyle: string } };
      row: { raw: unknown };
    }) => void,
  ) => {
    autoTable(doc, {
      head: [head],
      body,
      startY: y + 4,
      margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 20 },
      theme: "grid",
      showHead: "everyPage",
      // Two-line cells (enquiry/tag + client) must not be cut in half by a
      // page break, leaving a stray client name atop the next page.
      rowPageBreak: "avoid",
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 4,
        lineColor: CELL_BORDER,
        lineWidth: 0.5,
        textColor: 30,
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        fillColor: HEAD_FILL,
        textColor: 25,
        fontStyle: "bold",
        lineColor: CELL_BORDER,
        lineWidth: 0.5,
      },
      columnStyles,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: didParseCell as any,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 18;
  };

  const emptyNote = (text: string) => {
    ensureSpace(24);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    y += 14;
    doc.text(text, MARGIN, y);
    y += 16;
  };

  const truncatedNote = (s: AuditReportSection) =>
    s.truncated ? ` Showing the most recent ${s.rows.length} — the full trail is longer.` : "";

  // Bulleted paragraphs with a hanging indent, so a wrapped line sits under
  // the text rather than back at the margin under the bullet.
  const bullets = (items: string[]) => {
    const indent = 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(60);
    y += 14;
    for (const item of items) {
      const lines = doc.splitTextToSize(item, contentWidth - indent);
      ensureSpace(lines.length * 11 + 6);
      doc.text("•", MARGIN, y);
      doc.text(lines, MARGIN + indent, y);
      y += lines.length * 11 + 5;
    }
    y += 10;
  };

  // ---------------------------------------------------------------- Header
  const logo = await loadImageAsDataUrl("/logo.png");
  if (logo) {
    const h = 34;
    doc.addImage(logo.dataUrl, MARGIN, y, (logo.width / logo.height) * h, h);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Generated: ${fmtWhen(report.generatedAt)}`, pageWidth - MARGIN, y + 13, {
    align: "right",
  });
  if (generatedBy) {
    doc.text(`Generated by ${generatedBy}`, pageWidth - MARGIN, y + 27, { align: "right" });
  }
  y += 52;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20);
  doc.text("Audit Log Report", MARGIN, y);
  y += 7;
  doc.setDrawColor(210);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 16;

  const periodEnd = report.until ? fmtDate(report.until) : fmtDate(report.generatedAt);
  const periodStart = report.since ? fmtDate(report.since) : fmtDate(report.totals.first);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(70);
  doc.text(
    `${RANGE_LABELS[report.range] ?? report.range}  •  ${periodStart} – ${periodEnd}`,
    MARGIN,
    y,
  );
  y += 22;

  // --------------------------------------------------------------- Summary
  band("Summary");
  const t = report.totals;
  const figures: [string, string][] = [
    ["Events recorded", String(t.events)],
    ["Active users", String(t.activeUsers)],
    ["Total active time", formatDuration(t.totalActiveSeconds)],
    ["Actions performed", String(t.actions)],
    ["Successful logins", String(t.logins)],
    ["Failed login attempts", String(t.failed)],
  ];
  // Two rows of three label/value pairs.
  const rows: RowInput[] = [
    figures.slice(0, 3).flat(),
    figures.slice(3, 6).flat(),
  ];
  autoTable(doc, {
    body: rows,
    startY: y + 4,
    margin: { left: MARGIN, right: MARGIN },
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      cellPadding: 6,
      lineColor: CELL_BORDER,
      lineWidth: 0.5,
      textColor: 25,
    },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: HEAD_FILL },
      2: { fontStyle: "bold", fillColor: HEAD_FILL },
      4: { fontStyle: "bold", fillColor: HEAD_FILL },
      1: { halign: "right" },
      3: { halign: "right" },
      5: { halign: "right" },
    },
    didParseCell: (data) => {
      // Flag failed logins in red when there were any.
      if (data.section === "body" && data.row.index === 1 && data.column.index === 5 && t.failed > 0) {
        data.cell.styles.textColor = FAILED_TEXT;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 22;

  // ---------------------------------------------------------- Usage by user
  band(
    "Usage by User",
    `Sorted by active time. Active time is estimated from activity — see "How to read Active Time" below.`,
  );
  if (report.usage.length === 0) {
    emptyNote("No user activity was recorded in this period.");
  } else {
    table(
      [
        "User",
        "Role",
        "Active Time",
        "Actions",
        "Logins",
        "Failed",
        "First Seen",
        "Last Active",
        "Last IP",
      ],
      report.usage.map((u) => [
        u.email ?? "—",
        prettyRole(u.role),
        formatDuration(u.activeSeconds),
        String(u.actions),
        String(u.sessions),
        String(u.failed),
        fmtWhen(u.firstSeen),
        fmtWhen(u.lastActive),
        u.lastIp ? (u.ipCount > 1 ? `${u.lastIp} (+${u.ipCount - 1})` : u.lastIp) : "—",
      ]),
      {
        2: { halign: "right", fontStyle: "bold" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
      (data) => {
        if (data.section === "body" && data.column.index === 5 && Number(data.cell.raw) > 0) {
          data.cell.styles.textColor = FAILED_TEXT;
          data.cell.styles.fontStyle = "bold";
        }
      },
    );
  }

  // ------------------------------------------------ How active time is read
  // Right under the table it explains, not after pages of raw log.
  band("How to read Active Time");
  bullets([
    `Active time is an estimate built from recorded activity, not from sign-in to sign-out. Sign-outs are rarely recorded (people close the browser tab), so session length cannot be measured directly.`,
    `Each user's events are placed in time order (failed sign-ins are left out) and the gaps between consecutive events are added up. Only gaps of ${report.idleCutoffMinutes} minutes or less count as active; a longer gap means the person stepped away, so it is treated as idle.`,
    `Active time is conservative: time spent before a user's first recorded action after a break (reading a page, filling in a form before saving it) is not visible to the audit trail, and a lone event adds nothing.`,
    `Role is the user's most recent role within this period, as recorded at the time of their activity. Only actions the application records appear here; work done before auditing was switched on is not included.`,
  ]);

  // -------------------------------------------------------- Activity by type
  band("Activity by Type", "What was done in this period, how often, and by how many people.");
  if (report.byAction.length === 0) {
    emptyNote("No actions were recorded in this period.");
  } else {
    const totalActions = report.byAction.reduce((s, a) => s + a.count, 0) || 1;
    table(
      ["Action", "Count", "Share", "Users"],
      report.byAction.map((a) => [
        actionWithArea(a.action),
        String(a.count),
        `${((a.count / totalActions) * 100).toFixed(1)}%`,
        String(a.users),
      ]),
      { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    );
  }

  // ------------------------------------------------------ Logins & sessions
  band(
    "Logins & Sessions",
    `Sign-ins, sign-outs and failed attempts, newest first.${truncatedNote(report.logins)}`,
  );
  if (report.logins.rows.length === 0) {
    emptyNote("No sign-in activity was recorded in this period.");
  } else {
    table(
      ["When", "User", "Event", "IP Address", "Detail"],
      report.logins.rows.map((r) => [
        fmtWhen(r.createdAt),
        r.email ?? "—",
        r.eventType === "login_failed"
          ? "Failed login"
          : r.eventType === "logout"
            ? "Sign out"
            : "Sign in",
        r.ip ?? "—",
        r.detail ?? "—",
      ]),
      { 0: { cellWidth: 95 }, 1: { cellWidth: 170 }, 2: { cellWidth: 70 }, 3: { cellWidth: 90 } },
      (data) => {
        if (data.section === "body" && data.column.index === 2 && data.cell.raw === "Failed login") {
          data.cell.styles.textColor = FAILED_TEXT;
          data.cell.styles.fontStyle = "bold";
        }
      },
    );
  }

  // --------------------------------------------------------- Access changes
  band(
    "Access Changes",
    `Accounts created, removed, re-roled or edited.${truncatedNote(report.access)}`,
  );
  if (report.access.rows.length === 0) {
    emptyNote("No access changes were made in this period.");
  } else {
    table(
      ["When", "Changed By", "Change", "IP Address", "Detail"],
      report.access.rows.map((r) => [
        fmtWhen(r.createdAt),
        r.email ?? "—",
        prettyAction(r.action),
        r.ip ?? "—",
        r.detail ?? "—",
      ]),
      { 0: { cellWidth: 95 }, 1: { cellWidth: 170 }, 2: { cellWidth: 90 }, 3: { cellWidth: 90 } },
    );
  }

  // ----------------------------------------------------------- Activity log
  band(
    "Activity Log",
    `Every recorded action, newest first.${truncatedNote(report.activity)}`,
  );
  if (report.activity.rows.length === 0) {
    emptyNote("No actions were recorded in this period.");
  } else {
    table(
      ["When", "User", "Action", "Enquiry / Tag", "IP Address", "Detail"],
      report.activity.rows.map((r) => [
        fmtWhen(r.createdAt),
        r.email ?? "—",
        prettyAction(r.action),
        enquiryTag(r),
        r.ip ?? "—",
        r.detail ?? "—",
      ]),
      { 0: { cellWidth: 88 }, 1: { cellWidth: 150 }, 2: { cellWidth: 65 }, 3: { cellWidth: 160 }, 4: { cellWidth: 85 } },
    );
  }

  // ------------------------------------------------------------- Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      "Confidential — Risansi Pump Selection Portal system audit trail.",
      MARGIN,
      pageHeight - 18,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 18, {
      align: "right",
    });
  }

  const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);
  const filename = `Audit-Report-${report.range}-${stamp}.pdf`;
  if (opts.save !== false) doc.save(filename);
  return { filename, bytes: doc.output("arraybuffer") };
}
