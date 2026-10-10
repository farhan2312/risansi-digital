'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AUTH_LABEL, AUTH_INP, authFocusOn, authFocusOff } from '@/components/risansi/AuthShell';

export default function SignUpPage() {
  const router = useRouter();
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [role,     setRole]     = useState('rep');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.toLowerCase().endsWith('@risansi.com')) {
      setError('Only @risansi.com email addresses are allowed');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email.toLowerCase().trim(), password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      router.push('/api/auth/signup/pending');
    } catch (err: unknown) {
      console.error('Signup error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-fade" style={{ width: '100%', maxWidth: 380 }}>
      <div style={{ marginBottom: 26 }}>
        <img src="/logo.png" alt="Risansi" style={{ height: 40, width: 'auto', objectFit: 'contain', display: 'block' }} />
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 600, color: '#0D1B2E', letterSpacing: '-0.02em', margin: '0 0 7px' }}>
        Request access
      </h1>
      <p style={{ fontSize: 14, color: '#6B7F96', margin: '0 0 26px' }}>
        Create your Risansi account — an admin approves it before you can sign in.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={AUTH_LABEL}>Full name</label>
          <input
            type="text" required value={name} onChange={e => setName(e.target.value)}
            placeholder="Your full name" style={AUTH_INP} onFocus={authFocusOn} onBlur={authFocusOff}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={AUTH_LABEL}>Email</label>
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@risansi.com" style={AUTH_INP} onFocus={authFocusOn} onBlur={authFocusOff}
          />
          {email && !email.toLowerCase().endsWith('@risansi.com') && (
            <div style={{ fontSize: 11, color: '#DC2626' }}>Only @risansi.com email addresses are allowed</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={AUTH_LABEL}>Password <span style={{ color: '#A8BAC8', fontWeight: 400 }}>· min 8 chars</span></label>
          <input
            type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••" style={AUTH_INP} onFocus={authFocusOn} onBlur={authFocusOff}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={AUTH_LABEL}>Confirm password</label>
          <input
            type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••" style={AUTH_INP} onFocus={authFocusOn} onBlur={authFocusOff}
          />
          {confirm && password !== confirm && (
            <div style={{ fontSize: 11, color: '#DC2626' }}>Passwords do not match</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={AUTH_LABEL}>Role</label>
          <select
            value={role} onChange={e => setRole(e.target.value)}
            style={{ ...AUTH_INP, cursor: 'pointer' }} onFocus={authFocusOn} onBlur={authFocusOff}
          >
            <option value="rep">Field Rep</option>
            <option value="manager">Sales Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        {error && (
          <div style={{ padding: '10px 12px', background: '#FDE8E8', border: '1px solid #F87171', borderLeft: '3px solid #E02424', borderRadius: 8, color: '#9B1C1C', fontSize: 13 }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          marginTop: 4, padding: '12px 0', fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
          background: '#1A5CB8', color: '#fff', border: 'none', borderRadius: 8,
          cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '-0.005em',
          opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
          boxShadow: '0 6px 18px rgba(26,92,184,0.28)',
        }}>
          {loading ? 'Submitting…' : 'Request access'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 20, marginBottom: 0, fontSize: 13, color: '#6B7F96' }}>
        Already have an account?{' '}
        <Link href="/api/auth/signin" style={{ color: '#1A5CB8', textDecoration: 'none', fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
      <p style={{ fontSize: 11, color: '#A8BAC8', textAlign: 'center', marginTop: 24, marginBottom: 0 }}>
        Risansi Industries Ltd · Internal use only
      </p>
    </div>
  );
}
