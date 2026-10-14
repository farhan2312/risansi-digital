import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canCreateOrders } from "@/lib/roles";
import { OrderForm } from "@/components/risansi/order-form";

export const metadata: Metadata = {
  title: "New order | Risansi",
};

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const user = await getCurrentUser();
  if (!user || !canCreateOrders(user.role)) redirect("/risansi/orders");
  // Order Making creates SOs from its own page, with its own form.
  if ((user.role === "order_making" || user.role === "order_making_so")) redirect("/risansi/departments/order-making");

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <Link
        href="/risansi/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          New order
        </h1>
        <p className="text-sm text-muted">
          Enter the core order details. Department sections are filled in later.
        </p>
      </div>

      <OrderForm />
    </div>
  );
}
