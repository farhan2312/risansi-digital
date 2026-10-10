import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUser, getSession, hasRole } from '@/lib/risansi-auth';
import { cache } from 'react';
import { Sidebar } from '@/components/risansi';
import type { SidebarRole } from '@/components/risansi/Sidebar';
import { BottomNav } from '@/components/risansi/BottomNav';
import { ActivityTracker } from '@/components/risansi/ActivityTracker';
import risansiPool from '@/lib/db-risansi';

// Was a local `cache(() => getSession())`. That is why the
// first shared-session test still bounced to sign-in with everything else
// working: the proxy let the request through, the grant resolved, and then
// this helper asked NextAuth — which knew nothing about it — and found
// nobody. The shared-aware one lives in lib/risansi-auth.ts and tries the
// Risansi Digital cookie before falling back to NextAuth.

const ibmPlexSans = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

function toSidebarRole(role: string): SidebarRole {
  if (role === 'sysadmin') return 'sysadmin';
  if (role === 'admin')    return 'admin';
  if (role === 'manager')  return 'manager';
  return 'rep';
}

export default async function RisansiLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user?.email) {
    redirect('/api/auth/signin');
  }

  // Approval is checked HERE, not only in proxy.ts, and the difference matters.
  //
  // `withAuth` reads the cookie with getToken(), which decodes it and does not
  // run the jwt callback — so the `risansiAccess` the proxy tests is whatever
  // was baked in when the token was last written, not the live row. A person
  // deactivated mid-session therefore walks straight past that gate until
  // their cookie happens to be re-issued.
  //
  // What they got instead of a refusal was worse than it sounds: the session
  // still carries an email and a name, so this layout let them in, and
  // getCurrentUser correctly resolved them to SIGNED_OUT — whose role is 'rep'
  // and whose id is null. The result was a portal that looked signed in, with
  // their old name in the header, labelled "sales representative", and every
  // figure on it zero. No data escaped. It just read as a broken portal rather
  // than as being told.
  //
  // getCurrentUser goes through getServerSession, which DOES run the jwt
  // callback and re-reads the row, so this is the live answer.
  const current = await getCurrentUser();
  if (!current.email) {
    redirect('/api/auth/signup/pending');
  }

  // The two path rules proxy.ts applies, applied again here from the role this
  // layout actually resolved.
  //
  // Not belt-and-braces. proxy.ts reads them off the NextAuth token, and a
  // request carrying a Risansi Digital session instead has no such token — it
  // is waved through there precisely so that it can be judged here, where the
  // grant has been read. Without this, the shared session would be a way past
  // both rules.
  //
  // It also fixes them for NextAuth sessions, which were being judged on a
  // role baked into a cookie that getToken() never re-reads. The staff
  // allowlist in particular existed in exactly one place, and that place was
  // working from a value that could be hours stale.
  const pathname = (await headers()).get('x-risansi-path') ?? '';
  if (pathname) {
    if (pathname.startsWith('/risansi/admin') && !hasRole(current.role, 'admin')) {
      redirect('/risansi');
    }
    // Staff reach Client 360 and Complaints and nothing else — an allowlist,
    // so a screen added later fails closed rather than quietly inheriting.
    if (current.role === 'staff') {
      const allowed = ['/risansi/clients', '/risansi/complaints']
        .some(p => pathname === p || pathname.startsWith(`${p}/`));
      if (!allowed) redirect('/risansi/complaints');
    }
  }

  // Force temp-password users to set their own password before using the app.
  // The change-password page lives outside /risansi so this never loops; the
  // jwt callback re-reads must_change_password each request, so the flag clears
  // automatically once they change it.
  if (session.user.mustChange) {
    // To the HUB's change-password screen, not this app's.
    //
    // Since step 4 the password that signs somebody in lives in
    // identity.users. This app's /change-password writes users.password_hash,
    // which nothing reads any more — so sending them there would have them
    // type a new password, be told it worked, and still be prompted for a
    // change on their next sign-in, having altered a column with no effect.
    //
    // The flag itself is carried in the shared session token, and the hub
    // clears it and re-issues the token when the password is actually
    // changed.
    const hub = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');
    redirect(`${hub}/change-password`);
  }

  const email       = session.user.email;
  const role        = session.user.role ?? 'rep';
  const fontClasses = `${ibmPlexSans.variable} ${ibmPlexMono.variable} ${instrumentSerif.variable}`;

  // Pending access requests count — only fetched for admin/sysadmin
  let pendingCount = 0;
  if (['admin', 'sysadmin'].includes(role)) {
    try {
      const res = await risansiPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE status = 'Pending'`,
      );
      pendingCount = parseInt(res.rows[0]?.count ?? '0', 10);
    } catch { /* non-fatal */ }
  }

  return (
    <div
      className={fontClasses}
      style={{
        fontFamily:          'var(--font-sans, "IBM Plex Sans", system-ui, sans-serif)',
        WebkitFontSmoothing: 'antialiased',
        fontSize:            13,
        lineHeight:          1.45,
        display:             'flex',
        height:              '100vh',
        overflow:            'hidden',
        background:          'var(--bg)',
      }}
    >
      <Sidebar
        role={toSidebarRole(role)}
        pendingCount={pendingCount}
        user={{
          name:     session.user.name ?? email,
          initials: getInitials(session.user.name ?? email),
          // Pass the raw lowercase role so UserMenu's ROLE_LABELS map resolves
          // it to a friendly label (e.g. 'rep' → 'Sales Representative').
          role:     role,
          email:    email,
        }}
      />
      <main className="risansi-main" style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)', minWidth: 0 }}>
        {children}
      </main>

      {/* Mobile-only bottom navigation (hidden ≥768px) */}
      <BottomNav
        role={toSidebarRole(role)}
        user={{ name: session.user.name ?? email, email }}
      />

      {/* Records active time per page for the Audit Log → Usage tab */}
      <ActivityTracker />
    </div>
  );
}
