import { redirect } from 'next/navigation';

// User Management was merged into Users & Access (account management) at /admin.
// Tour assignment for reps/managers lives on Tours & Reps (/risansi/admin/reps).
export default function UsersAdminPage() {
  redirect('/admin');
}
