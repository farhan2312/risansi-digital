/**
 * Sales no longer has a sign-in page. Signing in happens at Risansi Digital.
 *
 * Phase 3 step 4 of MIGRATION_PLAN.md — the one step anybody notices. What
 * used to be a 112-line email-and-password form is now a redirect, because
 * two places to type a password is the thing this whole migration exists to
 * end. Credentials for this portal live in `identity.users`; the form that
 * used to be here checked `users.password_hash`, which step 5 removes.
 *
 * The route stays rather than being deleted, and that is deliberate. It is
 * NextAuth's configured `pages.signIn`, it is linked from old notification
 * emails, and people have it bookmarked. Removing it would turn every one of
 * those into a 404; keeping it turns them into a sign-in that works.
 *
 * Anything already on its way somewhere keeps going: `callbackUrl` is what
 * NextAuth appends when it bounces a request, and `next` is what proxy.ts
 * sends. Either is passed on to the hub, which checks it with safeReturnUrl()
 * before honouring it — on a login page an unchecked destination is a
 * phishing hop, so the check belongs there and only there.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export default async function SignInRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // NextAuth spells it callbackUrl; proxy.ts spells it next. Take whichever
  // arrived. Not validated here on purpose — it is handed to the hub, which
  // validates every destination it is given, and two checks in two codebases
  // drift apart.
  const back = one(params.next) ?? one(params.callbackUrl) ?? null;

  redirect(back ? `${HUB}/sign-in?next=${encodeURIComponent(back)}` : `${HUB}/sign-in`);
}
