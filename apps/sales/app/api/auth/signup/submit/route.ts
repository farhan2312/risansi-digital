import { NextRequest, NextResponse } from 'next/server';
import risansiPool from '@/lib/db-risansi';
import bcrypt from 'bcryptjs';

const VALID_ROLES = ['rep', 'manager', 'admin'];

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, role } = await req.json();

    if (!email || !email.endsWith('@risansi.com')) {
      return NextResponse.json({ error: 'Only @risansi.com emails allowed' }, { status: 400 });
    }
    if (!name || name.trim().length < 2) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    const safeRole = VALID_ROLES.includes(role) ? role : 'rep';

    const hashed = await bcrypt.hash(password, 10);
    const lcEmail = email.toLowerCase().trim();

    // Self-service signups land as Pending users for a sysadmin to approve.
    // Reject if the email is already registered — DO NOTHING + RETURNING makes
    // the duplicate check atomic (no silent overwrite of an existing account).
    const ins = await risansiPool.query(
      `INSERT INTO users (email, name, role, status, password_hash)
       VALUES ($1, $2, $3, 'Pending', $4)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id`,
      [lcEmail, name.trim(), safeRole, hashed],
    );

    if (ins.rowCount === 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please sign in, or contact your administrator if you need access.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('Signup error:', err);
    const message = err instanceof Error ? err.message : 'Failed to submit request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
