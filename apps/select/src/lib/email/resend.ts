/**
 * Transactional email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Plain fetch, no SDK dependency.
 *
 * Never throws: an email is a notification on top of an action that has
 * already been saved (sending steps for approval, deciding them), so a mail
 * failure must not undo or block it. Callers get a result to record instead.
 *
 * Configuration (.env.local):
 *   RESEND_API_KEY  - Resend API key. Left as the placeholder, or unset, every
 *                     send is skipped and logged rather than attempted.
 *   RESEND_FROM     - sender, e.g. "Risansi Pump Selection <approvals@risansi.com>".
 *                     The domain must be verified in Resend.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** The placeholder written to .env.local until a real key is added. */
const PLACEHOLDER_KEY = "re_dummy_replace_me";
const DEFAULT_FROM = "Risansi Pump Selection <approvals@example.com>";
const TIMEOUT_MS = 10_000;

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export type EmailResult =
  | { status: "sent"; id: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export function emailConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim();
  return Boolean(key) && key !== PLACEHOLDER_KEY;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const to = [...new Set(message.to.map((a) => a.trim()).filter(Boolean))];
  if (to.length === 0) return { status: "skipped", reason: "no recipients" };
  if (!emailConfigured()) {
    console.info(`[email] skipped (RESEND_API_KEY not set): "${message.subject}" to ${to.join(", ")}`);
    return { status: "skipped", reason: "email not configured" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM?.trim() || DEFAULT_FROM,
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const reason = body.message || `HTTP ${res.status}`;
      console.error(`[email] Resend refused "${message.subject}": ${reason}`);
      return { status: "failed", reason };
    }
    return { status: "sent", id: body.id ?? null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[email] send failed for "${message.subject}": ${reason}`);
    return { status: "failed", reason };
  }
}

/** "emailed 2 selection heads" / "email skipped (email not configured)" — for
 *  the audit detail, so the trail says whether anyone was actually told. */
export function describeEmailResult(result: EmailResult, who: string): string {
  if (result.status === "sent") return `emailed ${who}`;
  if (result.status === "skipped") return `email skipped (${result.reason})`;
  return `email failed (${result.reason})`;
}
