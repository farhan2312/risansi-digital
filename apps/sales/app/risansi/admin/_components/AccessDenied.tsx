import { Topbar } from '@/components/risansi';

// Shown on the sysadmin pages when the viewer lacks the required role.
export function AccessDenied({ crumbs = ['Admin'] }: { crumbs?: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={crumbs} />
      </div>
      <div style={{
        flex: 1, display: 'grid', placeItems: 'center',
        background: 'var(--bg)', padding: 40,
      }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>
            Access denied
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
            This area is restricted to system administrators. If you believe you
            should have access, contact your administrator.
          </div>
        </div>
      </div>
    </div>
  );
}
