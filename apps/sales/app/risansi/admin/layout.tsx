import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { hasRole } from '@/lib/risansi-auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? '';

  if (!hasRole(role, 'admin')) {
    redirect('/risansi');
  }

  return <>{children}</>;
}
