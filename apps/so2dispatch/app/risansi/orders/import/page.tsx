import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canImportOrders } from "@/lib/roles";
import { OrderImport } from "@/components/risansi/order-import";

export const metadata: Metadata = {
  title: "Import orders | Risansi",
};

export const dynamic = "force-dynamic";

export default async function ImportOrdersPage() {
  const user = await getCurrentUser();
  if (!user || !canImportOrders(user.role)) redirect("/risansi/orders");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <Link
        href="/risansi/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Import orders
        </h1>
        <p className="text-sm text-muted">
          Upload the daily sheet to create one SO per row. Client details are
          filled in from the client directory using the client code.
        </p>
      </div>

      <OrderImport />
    </div>
  );
}
