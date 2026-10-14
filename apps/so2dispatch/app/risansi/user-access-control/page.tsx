import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { HUB_URL } from "@/lib/hub";

export const metadata: Metadata = {
  title: "Users & Access | Risansi",
};

export const dynamic = "force-dynamic";

/**
 * Users & Access — now at Risansi Digital (Phase 5).
 *
 * This page added people, approved requests, changed roles, reset passwords,
 * deactivated and deleted. All of it happens once at Risansi Digital and
 * reaches every portal, as in Testing and Sales. The route and its menu entry
 * stay: somebody looking for user management looks where it has always been,
 * and a page saying where it went beats a missing menu item they would read
 * as a permissions problem.
 *
 * Which account is which rep on the orders is this portal's own and stays,
 * on Reps.
 */
export default async function UserAccessControlPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/risansi/dashboard");

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="max-w-2xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Users &amp; Access</h1>
        <p className="mt-3 leading-relaxed text-muted">
          Accounts moved to Risansi Digital. Adding somebody, approving a request, changing their role, resetting a
          password and switching an account off are all done there now, and reach every portal at once instead of
          only this one.
        </p>
        <p className="mt-3 leading-relaxed text-muted">
          Roles for SO to Dispatch are still this portal&rsquo;s own, chosen there from the same list as here. A new
          person&rsquo;s account here is made the first time they open SO to Dispatch.
        </p>
        <p className="mt-3 leading-relaxed text-muted">
          Which account is which rep on the orders has not moved. It stays on{" "}
          <Link href="/risansi/reps" className="font-medium text-primary hover:underline">
            Reps
          </Link>
          .
        </p>
        <a
          href={`${HUB_URL}/requests/people`}
          target="_blank"
          rel="noopener"
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-primary px-5 font-display text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Manage people at Risansi Digital
        </a>
        <p className="mt-6 text-sm leading-relaxed text-muted">
          You need approver access there. If you had it here and not there, ask an approver to add you.
        </p>
      </div>
    </div>
  );
}
