import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { homeFor, mayOpenPage } from "@/lib/view-pages";
import { boardFilterOf, loadDeptPage } from "@/lib/dept-board";
import { boardDept } from "@/lib/dept-board-keys";
import { describeOrderListFilter } from "@/lib/order-list-filter";
import { DeptDashboard } from "@/components/risansi/dept-dashboard";

export const metadata: Metadata = { title: "Department dashboard | Risansi" };
export const dynamic = "force-dynamic";

/**
 * One department off the Orders board: its own summary cards as figures and
 * charts, and every SO of the Orders filter in its queue with its own
 * status. Read only.
 */
export default async function DeptBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewAll(user.role)) redirect("/risansi/dashboard");
  if (!mayOpenPage(user, "/risansi/orders")) redirect(homeFor(user));
  const dept = boardDept((await params).dept);
  if (!dept) notFound();

  const sp = await searchParams;
  const filter = boardFilterOf(user, (k) => sp[k]);
  const { cards, rows, kind, today } = await loadDeptPage(filter, dept.key);
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => e[1] !== undefined)).toString();

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <DeptDashboard
        dept={dept.key}
        cards={cards}
        rows={rows}
        kind={kind}
        today={today}
        scope={describeOrderListFilter(filter)}
        query={query}
      />
    </div>
  );
}
