import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { ChangePasswordForm } from './ChangePasswordForm';

// Top-level (outside /risansi) so the forced-change redirect from the Risansi
// layout never loops. Reached when users.must_change_password is true.
export default async function ChangePasswordPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');

  const forced = session.user.mustChange === true;

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: '#0A1628', padding: 24,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, background: '#fff',
        borderRadius: 14, padding: '32px 28px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#0D1B2A', margin: '0 0 4px' }}>
          {forced ? 'Set your password' : 'Change password'}
        </h1>
        <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 20px', lineHeight: 1.5 }}>
          {forced
            ? 'Your account uses a temporary password. Choose a new one to continue.'
            : 'Update the password for your account.'}
        </p>
        <ChangePasswordForm forced={forced} />
      </div>
    </div>
  );
}
