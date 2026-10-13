import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BrandPanel } from "@/components/auth/brand-panel";
import { SetPasswordForm } from "@/components/set-password/set-password-form";

export const metadata: Metadata = {
  title: "Set a new password | SO to Dispatch",
};

// Session state is per-request, so this page can't be statically cached.
export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Nobody reaches this page unless they still owe a password change.
  if (!user.must_change_password) redirect("/risansi/dashboard");

  return (
    <main className="flex min-h-screen w-full bg-background lg:h-screen lg:overflow-hidden">
      <BrandPanel />
      <section className="relative z-10 flex flex-1 basis-[40%] items-center justify-center overflow-y-auto bg-card px-6 py-10 sm:px-10 lg:-ml-8 lg:rounded-l-[32px] lg:py-8 lg:shadow-[-24px_0_60px_-30px_rgba(10,42,94,0.45)]">
        <SetPasswordForm email={user.email} />
      </section>
    </main>
  );
}
