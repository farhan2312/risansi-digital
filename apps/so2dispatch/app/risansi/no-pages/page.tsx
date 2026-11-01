import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eye } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { isView360 } from "@/lib/roles";
import { homeFor } from "@/lib/view-pages";

export const metadata: Metadata = {
  title: "360° View | Risansi",
};

export const dynamic = "force-dynamic";

/** A 360° View account with no pages picked yet: where every page sends them. */
export default async function NoPagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isView360(user.role)) redirect("/risansi/dashboard");
  // Pages picked since: the first of them.
  const home = homeFor(user);
  if (home !== "/risansi/no-pages") redirect(home);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Eye className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-display text-xl font-bold text-foreground">No pages yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your 360° View account has no pages picked. Ask Admin to choose the pages you should see on Users &amp; Access.
        </p>
      </div>
    </div>
  );
}
