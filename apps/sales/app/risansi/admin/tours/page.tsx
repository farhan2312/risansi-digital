import { redirect } from 'next/navigation';

// Tours are no longer administered as their own thing. A route is an attribute
// of a client now, and this page's real successor is Reps & Managers.
export default function ToursAdminPage() {
  redirect('/risansi/admin/reps');
}
