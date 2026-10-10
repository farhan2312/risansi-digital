import type { ReactNode } from 'react';
import { AuthVideoPanel } from '@/components/risansi/AuthShell';

// Shared shell for the auth pages (sign in · request access · pending). Because the
// video panel lives in this layout, client-side navigation between the pages keeps it
// mounted and playing — only the form column ({children}) swaps, with a fade.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login-grid" style={{
      minHeight: '100vh', display: 'grid', gridTemplateColumns: '7fr 3fr',
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif', WebkitFontSmoothing: 'antialiased',
    }}>
      <AuthVideoPanel description="Real-time competitive positioning, visit analytics, and revenue intelligence for the Risansi field team." />
      <div className="login-form" style={{
        background: '#F7F9FC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 32px',
      }}>
        {children}
      </div>
    </div>
  );
}
