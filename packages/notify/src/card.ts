/**
 * The notification card.
 *
 * Deliberately the same layout the sales portal already sends
 * (`apps/sales/lib/risansi-email.ts`, `sendNotification`): 520px, coloured
 * header band, a left-accented box, an optional meta table, one call to action.
 * People at Risansi already recognise that envelope, and a second house style
 * arriving from a second system would read as something to be suspicious of —
 * which is the last thing an email about access permissions should do.
 *
 * Table-based and inline-styled on purpose. Email clients are not browsers:
 * Outlook has no flexbox and strips `<style>` blocks, so the markup that looks
 * dated here is the markup that renders.
 *
 * Everything interpolated is escaped. A person's name arrives from a sign-up
 * form, and a reason for wanting access is free text typed by whoever asked —
 * both reach an approver's inbox, so neither can be trusted into HTML.
 */

export const escapeHtml = (s: string): string =>
  String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

/** Brand navy, matching the sales portal's cards. */
const DEFAULT_ACCENT = '#0A3D8F';

export interface Card {
  /** Header label, shown after "Risansi Digital · ". */
  section: string;
  /** Hex. Defaults to brand navy; a refusal reads better in the negative red. */
  accent?: string;
  greetingName?: string | null;
  /** One or two sentences, before the box. */
  intro: string;
  title?: string | null;
  body?: string | null;
  meta?: [string, string][];
  ctaLabel?: string;
  /** Absolute URL. The hub is the destination for all of these. */
  ctaUrl?: string;
  footer?: string | null;
}

export function renderCard(c: Card): string {
  const accent = c.accent || DEFAULT_ACCENT;

  const rows = (c.meta ?? [])
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([l, v]) => `<tr>`
      + `<td style="padding:4px 0;color:#6B7280;font-size:13px;width:128px;vertical-align:top;">${escapeHtml(l)}</td>`
      + `<td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${escapeHtml(String(v))}</td>`
      + `</tr>`)
    .join('');

  const hasBox = !!(c.title || c.body || rows);
  const box = hasBox
    ? `<div style="border:1px solid #E5E7EB;border-left:3px solid ${accent};border-radius:6px;padding:14px 16px;margin-bottom:18px;">`
      + (c.title
        ? `<div style="color:${accent};font-size:15px;font-weight:600;margin-bottom:${c.body || rows ? '6px' : '0'};">${escapeHtml(c.title)}</div>`
        : '')
      + (c.body
        ? `<div style="color:#374151;font-size:13px;line-height:1.5;margin-bottom:${rows ? '10px' : '0'};white-space:pre-wrap;">${escapeHtml(c.body)}</div>`
        : '')
      + (rows ? `<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>` : '')
      + `</div>`
    : '';

  const cta = c.ctaLabel && c.ctaUrl
    ? `<a href="${escapeHtml(c.ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;`
      + `text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px;">`
      + `${escapeHtml(c.ctaLabel)}</a>`
    : '';

  return `<div style="background:#F3F4F6;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
      <tr><td style="background:${accent};padding:16px 24px;">
        <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.02em;">Risansi Digital &middot; ${escapeHtml(c.section)}</span>
      </td></tr>
      <tr><td style="padding:24px;">
        <p style="margin:0 0 4px;color:#111827;font-size:15px;">Hi ${escapeHtml(c.greetingName || 'there')},</p>
        <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(c.intro)}</p>
        ${box}${cta}
      </td></tr>
      <tr><td style="padding:14px 24px;border-top:1px solid #F3F4F6;">
        <span style="color:#9CA3AF;font-size:11px;">${escapeHtml(c.footer || 'Sent by Risansi Digital. Replies to this address are not read.')}</span>
      </td></tr>
    </table>
  </td></tr></table>
</div>`;
}
