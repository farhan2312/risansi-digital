'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { AUTH_LABEL, AUTH_INP, authFocusOn, authFocusOff } from '@/components/risansi/AuthShell';

export default function SignInPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid email or password. Please try again.');
        setLoading(false);
        return;
      }
      if (result?.ok) window.location.href = '/risansi';
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="auth-fade" style={{ width: '100%', maxWidth: 380 }}>
      <div style={{ marginBottom: 30 }}>
        <img src="/logo.png" alt="Risansi" style={{ height: 40, width: 'auto', objectFit: 'contain', display: 'block' }} />
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 600, color: '#0D1B2E', letterSpacing: '-0.02em', margin: '0 0 7px' }}>
        Welcome back
      </h1>
      <p style={{ fontSize: 14, color: '#6B7F96', margin: '0 0 30px' }}>
        Sign in to continue to the Risansi platform.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={AUTH_LABEL}>Email</label>
          <input
            type="email" required autoComplete="email" value={email}
            onChange={e => setEmail(e.target.value)} placeholder="you@risansi.com"
            style={AUTH_INP} onFocus={authFocusOn} onBlur={authFocusOff}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={AUTH_LABEL}>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
              style={{ ...AUTH_INP, paddingRight: 42 }} onFocus={authFocusOn} onBlur={authFocusOff}
            />
            <button
              type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'grid', placeItems: 'center', width: 32, height: 32, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7F96', padding: 0 }}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
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
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 22, marginBottom: 0, fontSize: 13, color: '#6B7F96' }}>
        New to Risansi?{' '}
        <Link href="/api/auth/signup" style={{ color: '#1A5CB8', textDecoration: 'none', fontWeight: 600 }}>
          Request access
        </Link>
      </p>
      <p style={{ fontSize: 11, color: '#A8BAC8', textAlign: 'center', marginTop: 26, marginBottom: 0 }}>
        Risansi Industries Ltd · Internal use only
      </p>
    </div>
  );
}
