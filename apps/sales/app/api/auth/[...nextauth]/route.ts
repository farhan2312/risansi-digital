import NextAuth, { type AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import risansiPool from '@/lib/db-risansi';
import { recordAuth } from '@/lib/audit';

// NextAuth's authorize req carries the request headers as a plain object.
function reqIpUa(req: unknown): { ip: string | null; ua: string | null } {
  const h = (req as { headers?: Record<string, string> } | undefined)?.headers ?? {};
  const fwd = h['x-forwarded-for'];
  const ip = (fwd ? fwd.split(',')[0].trim() : null) || h['x-real-ip'] || null;
  return { ip, ua: h['user-agent'] ?? null };
}

export const authOptions: AuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? 'risansi-dev-secret-2026',
  session: {
    strategy: 'jwt' as const,
    maxAge:   8 * 60 * 60,  // 8 hours
  },
  jwt: {
    maxAge: 8 * 60 * 60,
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.toLowerCase().trim() ?? '';
        const pass  = credentials?.password ?? '';
        const { ip, ua } = reqIpUa(req);

        // Unified users table is the source of truth for credentials + access.
        const res = await risansiPool.query<{
          id: number; email: string; name: string; password_hash: string | null;
          status: string; role: string;
        }>(
          `SELECT id, email, name, password_hash, status, role
           FROM users
           WHERE lower(email) = $1 AND status = 'Approved' AND is_active = TRUE
           LIMIT 1`,
          [email],
        );

        const row = res.rows[0];
        if (!row || !row.password_hash) {
          await recordAuth({ event: 'login_failed', email, reason: 'no_user', ip, userAgent: ua });
          return null;
        }

        const bcrypt = await import('bcryptjs');
        const valid  = await bcrypt.compare(pass, row.password_hash);
        if (!valid) {
          await recordAuth({ event: 'login_failed', email, userId: row.id, role: row.role, reason: 'bad_password', ip, userAgent: ua });
          return null;
        }

        await recordAuth({ event: 'login', email: row.email, userId: row.id, role: row.role, ip, userAgent: ua });
        return {
          id:    row.email,
          email: row.email,
          name:  row.name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user || token.email) {
        const email = (token.email ?? '').toLowerCase().trim();

        try {
          // Unified users table carries identity, role, access state and the
          // canonical id (same integer space as the old reps.id).
          const res = await risansiPool.query<{
            id: number; status: string; role: string; name: string | null;
            must_change_password: boolean; departments: string[] | null;
          }>(
            // Departments come back as an array from the join table. A person
            // holds zero or more, so this is an aggregate, not a column.
            //
            // `FROM users u` — the alias is not decoration. Adding the u. prefixes
            // without it made this query fail with "missing FROM-clause entry for
            // table u", and the catch below turns ANY failure here into a Pending
            // rep with no id. Which is what every signed-in person silently became.
            `SELECT u.id, u.status, u.role, u.name, u.must_change_password,
                    ARRAY(SELECT d.department FROM user_departments d
                           WHERE d.user_id = u.id ORDER BY d.department) AS departments
             FROM users u
             WHERE lower(u.email) = $1 AND u.is_active = TRUE
             LIMIT 1`,
            [email],
          );

          const row = res.rows[0];

          if (row) {
            token.risansiAccess = row.status;
            token.role          = row.role;
            token.repId         = row.id;
            token.mustChange    = row.must_change_password;
            token.name          = row.name ?? token.name;
            token.departments   = row.departments ?? [];
          } else {
            token.risansiAccess = 'Pending';
            token.role          = 'rep';
            token.repId         = null;
            token.mustChange    = false;
            token.departments   = [];
          }
        } catch (err) {
          console.error('JWT callback error:', err);
          token.risansiAccess = 'Pending';
          token.role          = 'rep';
          token.repId         = null;
          token.mustChange    = false;
          token.departments   = [];
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.risansiAccess = token.risansiAccess as string;
      session.user.role          = token.role          as string;
      session.user.repId         = (token.repId as number | null) ?? null;
      session.user.departments   = (token.departments as string[] | undefined) ?? [];
      session.user.mustChange    = (token.mustChange as boolean) ?? false;
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      await recordAuth({
        event: 'logout',
        email: (token?.email as string | undefined) ?? null,
        userId: (token?.repId as number | undefined) ?? null,
        role: (token?.role as string | undefined) ?? null,
      });
    },
  },
  pages: {
    signIn: '/api/auth/signin',
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
