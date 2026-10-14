import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listUsersPage } from "@/lib/users";
import { listOrderListOptions } from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { UsersAccessView } from "@/components/risansi/users-access-view";

export const metadata: Metadata = {
  title: "Users & Access | Risansi",
};

export const dynamic = "force-dynamic";

export default async function UserAccessControlPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    redirect("/risansi/dashboard");
  }

  const { page, q, status } = await searchParams;
  // The rep names on orders — what a Rep user is linked to.
  const [result, options] = await Promise.all([
    listUsersPage({
      page: parsePage(page),
      status: status ?? "all",
      search: parseQuery(q),
    }),
    listOrderListOptions(),
  ]);

  return (
    <UsersAccessView
      result={result}
      currentEmail={currentUser.email}
      platformAdminEmail={process.env.ADMIN_EMAIL ?? ""}
      repNames={options.reps}
    />
  );
}
