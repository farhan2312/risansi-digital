import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { recordAuth } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { currentPw, newPw } = await req.json();

    if (!currentPw || !newPw) {
      return NextResponse.json({ error: 'Both passwords required' }, { status: 400 });
    }
    if (typeof newPw !== 'string' || newPw.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 },
      );
    }

    // Credentials live in the unified users table.
    const email = session.user.email.toLowerCase().trim();

    const userRes = await risansiPool.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users
       WHERE lower(email) = $1 AND status = 'Approved'
       LIMIT 1`,
      [email],
    );

    const hash = userRes.rows[0]?.password_hash;
    if (!hash) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPw, hash);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Cost factor 10 to match the existing signup flow (app/api/auth/signup/submit).
    const newHash = await bcrypt.hash(newPw, 10);

    // Clear the forced-reset flag once the user sets their own password.
    await risansiPool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW()
       WHERE lower(email) = $2`,
      [newHash, email],
    );

    await recordAuth({ event: 'password_changed', email, role: (session.user.role as string | undefined) ?? null });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
