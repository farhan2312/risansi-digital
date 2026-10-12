/**
 * The "waiting to be approved" screen, now at Risansi Digital.
 *
 * Phase 4b. A request and its progress both live on the hub's tile grid,
 * where the tile itself says Requested, Not granted, or opens.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export default async function SignUpPendingRedirect() {
  redirect(`${HUB}/`);
}
