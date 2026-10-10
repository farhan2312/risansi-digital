import { redirect } from 'next/navigation';

export default function VisitPlanRedirect() {
  redirect('/risansi/field?tab=calendar');
}
