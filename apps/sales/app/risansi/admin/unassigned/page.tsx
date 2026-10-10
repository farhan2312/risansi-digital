import { redirect } from 'next/navigation';

// Unassigned clients are a tab on Reps & Managers.
export default function UnassignedAdminPage() {
  redirect('/risansi/admin/reps?tab=unassigned');
}
