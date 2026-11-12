import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { isOrderMakingAny } from "@/lib/roles";
import { getVersionsData } from "@/lib/order-versions";
import { VersionsBody } from "@/components/risansi/order-version-view";

export const metadata: Metadata = {
  title: "SO versions | Risansi",
};

export const dynamic = "force-dynamic";

/**
 * An SO's versions on a page of their own (the pop-up shows the same): each
 * frozen one read-only, with every department's data as it stood, and the
 * current one, where the departments work.
 */
export default async function OrderVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const asked = v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null;
  const data = await getVersionsData(id, asked, user);
  if (!data) notFound();
  const om = isOrderMakingAny(user.role);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <Link
        href={om ? "/risansi/departments/order-making" : `/risansi/orders/${id}`}
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {om ? "Order Making" : "Back to the SO"}
      </Link>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{data.soLabel} · Versions</h1>
        <p className="mt-1 text-sm text-muted">{data.client}</p>
      </div>
      <VersionsBody data={data} hrefFor={(n) => `/risansi/orders/${id}/versions?v=${n}`} />
    </div>
  );
}
