/**
 * @risansi/notify — transactional email for Risansi Digital.
 *
 * Kept out of @risansi/identity on purpose. Every portal will eventually import
 * identity to verify a session, and none of them should have to install Resend
 * to do it. Only the hub sends mail.
 *
 * Nothing here throws. A notification that fails must never undo the thing it
 * was notifying about — see the note at the top of send.ts.
 */

export { escapeHtml, renderCard, type Card } from './card.ts';
export { sendEmail, hubUrl, type SendResult } from './send.ts';
export {
  type Queryable,
  notifyAccessRequested,
  notifyAccessDecided,
  notifyAccessRevoked,
  notifyPendingBacklog,
} from './access.ts';
