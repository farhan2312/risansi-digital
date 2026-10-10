import Link from 'next/link';

export default function PendingPage() {
  return (
    <div className="auth-fade" style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
      {/* Check icon */}
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: '#D1FAE5', border: '2px solid #059669',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 24px',
      }}>
        <svg width={26} height={26} viewBox="0 0 24 24" fill="none"
             stroke="#059669" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7"/>
        </svg>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 600, color: '#0D1B2E', letterSpacing: '-0.02em', margin: '0 0 12px' }}>
        Request submitted
      </h1>

      <p style={{ fontSize: 14, color: '#6B7F96', lineHeight: 1.65, margin: '0 0 30px' }}>
        Your account request is pending approval from the system administrator.
        You&rsquo;ll be able to sign in once it&rsquo;s approved.
      </p>

      <Link href="/api/auth/signin" style={{
        display: 'inline-block', padding: '11px 26px', background: '#1A5CB8', color: '#fff',
        borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none',
        boxShadow: '0 6px 18px rgba(26,92,184,0.28)',
      }}>
        Back to sign in
      </Link>

      <p style={{ fontSize: 11, color: '#A8BAC8', marginTop: 30, marginBottom: 0 }}>
        Risansi Industries Ltd · Internal use only
      </p>
    </div>
  );
}
