/**
 * The two approval emails:
 *   1. requestEmail  - to every selection head when steps are sent.
 *   2. decisionEmail - to the engineer who sent them, once a head decides.
 *
 * Email-client-safe HTML: table layout, inline styles only, no web fonts, no
 * images (a localhost logo URL would be broken in every inbox), a 600px
 * column. Every value that came from a user — names, remarks, enquiry text —
 * is HTML-escaped. Each email also has a plain-text version.
 */
import type { ApprovalStatus } from "../approval";

const BRAND = "#0a3d8f";
const INK = "#1f2937";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const PANEL = "#f5f7fa";

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  Approved: { bg: "#e6f6ec", fg: "#1d6b3a" },
  Rejected: { bg: "#fdeaea", fg: "#a02020" },
  "Awaiting Approval": { bg: "#e7f0fd", fg: BRAND },
  Pending: { bg: "#fff8e6", fg: "#96601a" },
};

const esc = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** "12 Sep 2026, 10:42 IST" — always IST, whatever zone the server runs in. */
export function formatIst(d: Date): string {
  const s = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${s} IST`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Shared frame: brand bar, body, footer. */
function layout(bodyHtml: string, footer: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:${INK};">
<tr><td style="background:${BRAND};padding:14px 24px;border-radius:8px 8px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:2px;">RISANSI</td>
<td align="right" style="color:#cfe0f7;font-size:12px;">Pump Selection Portal</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px;">${bodyHtml}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid ${LINE};color:${MUTED};font-size:11px;line-height:1.5;">${footer}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 4px;"><tr>
<td style="background:${BRAND};border-radius:6px;">
<a href="${esc(url)}" style="display:inline-block;padding:11px 24px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">${esc(label)}</a>
</td></tr></table>`;
}

function pill(status: string): string {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.Pending;
  return `<span style="display:inline-block;background:${s.bg};color:${s.fg};font-size:11px;font-weight:bold;padding:3px 10px;border-radius:999px;white-space:nowrap;">${esc(status)}</span>`;
}

/** Two-column key facts panel (enquiry, customer, tag, pump, duty). */
function factsPanel(facts: [string, string][]): string {
  const filled = facts.filter(([, v]) => v);
  const rows: string[] = [];
  for (let i = 0; i < filled.length; i += 2) {
    const cell = (f?: [string, string]) =>
      f
        ? `<td width="50%" style="padding:6px 12px;vertical-align:top;"><div style="font-size:11px;color:${MUTED};">${esc(f[0])}</div><div style="font-size:13px;color:${INK};padding-top:2px;">${esc(f[1])}</div></td>`
        : `<td width="50%"></td>`;
    rows.push(`<tr>${cell(filled[i])}${cell(filled[i + 1])}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border-radius:6px;margin:4px 0 18px;padding:6px 0;">${rows.join("")}</table>`;
}

// --- 1. Request -------------------------------------------------------------

export interface RequestEmailInput {
  to: string[];
  engineerName: string;
  enquiryCode: string;
  projectName?: string | null;
  customerName?: string | null;
  tagName: string;
  pumpModel?: string;
  duty?: string;
  steps: { step: number; label: string; highlights: string }[];
  sentAt: Date;
  reviewUrl: string;
}

export function requestEmail(i: RequestEmailInput) {
  const count = plural(i.steps.length, "step");
  const subject = `Approval needed: ${i.enquiryCode} · ${i.tagName} (${count})`;

  const stepRows = i.steps
    .map(
      (s) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};">
<div style="font-size:14px;font-weight:bold;color:${INK};">${s.step} · ${esc(s.label)}</div>
${s.highlights ? `<div style="font-size:12px;color:${MUTED};padding-top:3px;line-height:1.5;">${esc(s.highlights)}</div>` : ""}
</td></tr>`,
    )
    .join("");

  const body = `
<div style="font-size:20px;font-weight:bold;color:${INK};">${esc(count)} ${i.steps.length === 1 ? "needs" : "need"} your approval</div>
<div style="font-size:14px;color:${MUTED};padding:6px 0 16px;line-height:1.5;">${esc(i.engineerName)} sent these steps for your review.</div>
${factsPanel([
  ["Enquiry", i.enquiryCode],
  ["Customer", i.customerName ?? ""],
  ["Tag · pump", [i.tagName, i.pumpModel].filter(Boolean).join(" · ")],
  ["Duty", i.duty ?? ""],
])}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};">${stepRows}</table>
${button("Review and approve", i.reviewUrl)}`;

  const html = layout(
    body,
    `Sent ${esc(formatIst(i.sentAt))}. You get this as a selection head on the Risansi Pump Selection Portal.`,
  );

  const text = [
    `${count} ${i.steps.length === 1 ? "needs" : "need"} your approval`,
    `${i.engineerName} sent these steps for your review.`,
    "",
    `Enquiry: ${i.enquiryCode}${i.customerName ? ` (${i.customerName})` : ""}`,
    `Tag: ${i.tagName}${i.pumpModel ? ` · ${i.pumpModel}` : ""}`,
    ...(i.duty ? [`Duty: ${i.duty}`] : []),
    "",
    ...i.steps.map((s) => `${s.step}. ${s.label}${s.highlights ? ` — ${s.highlights}` : ""}`),
    "",
    `Review and approve: ${i.reviewUrl}`,
    "",
    `Sent ${formatIst(i.sentAt)}.`,
  ].join("\n");

  return { subject, html, text };
}

// --- 2. Decision ------------------------------------------------------------

export interface DecisionEmailInput {
  to: string[];
  headName: string;
  enquiryCode: string;
  tagName: string;
  steps: { step: number; label: string; status: ApprovalStatus; remarks: string | null }[];
  decidedAt: Date;
  openUrl: string;
}

export function decisionEmail(i: DecisionEmailInput) {
  const approved = i.steps.filter((s) => s.status === "Approved").length;
  const rejected = i.steps.filter((s) => s.status === "Rejected").length;
  const tally = [approved ? `${approved} approved` : "", rejected ? `${rejected} rejected` : ""]
    .filter(Boolean)
    .join(", ");
  const subject = `${i.enquiryCode} · ${i.tagName}: ${tally}`;

  const stepRows = i.steps
    .map(
      (s) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:14px;color:${INK};">${s.step} · ${esc(s.label)}</td>
<td align="right">${pill(s.status)}</td>
</tr></table>
${s.remarks ? `<div style="margin-top:8px;padding:8px 12px;background:${PANEL};border-radius:6px;font-size:13px;color:${INK};line-height:1.5;">&ldquo;${esc(s.remarks)}&rdquo;</div>` : ""}
</td></tr>`,
    )
    .join("");

  const next = rejected
    ? `<div style="font-size:13px;color:${MUTED};padding-top:14px;line-height:1.5;">Fix the rejected ${rejected === 1 ? "step" : "steps"} and send again from the Approval step.</div>`
    : "";

  const body = `
<div style="font-size:20px;font-weight:bold;color:${INK};">Your approval request was reviewed</div>
<div style="font-size:14px;color:${MUTED};padding:6px 0 16px;line-height:1.5;">Selection head ${esc(i.headName)} reviewed ${esc(plural(i.steps.length, "step"))} of ${esc(i.enquiryCode)} · ${esc(i.tagName)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};">${stepRows}</table>
${next}
${button("Open enquiry", i.openUrl)}`;

  const html = layout(body, `Decided ${esc(formatIst(i.decidedAt))}. Risansi Pump Selection Portal.`);

  const text = [
    "Your approval request was reviewed",
    `Selection head ${i.headName} reviewed ${plural(i.steps.length, "step")} of ${i.enquiryCode} · ${i.tagName}.`,
    "",
    ...i.steps.map(
      (s) => `${s.step}. ${s.label}: ${s.status}${s.remarks ? ` — "${s.remarks}"` : ""}`,
    ),
    ...(rejected ? ["", "Fix the rejected steps and send again from the Approval step."] : []),
    "",
    `Open enquiry: ${i.openUrl}`,
    "",
    `Decided ${formatIst(i.decidedAt)}.`,
  ].join("\n");

  return { subject, html, text };
}
