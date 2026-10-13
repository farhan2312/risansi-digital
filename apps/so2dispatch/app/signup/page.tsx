import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";
import { BrandPanel } from "@/components/auth/brand-panel";
import { SignupForm } from "@/components/signup/signup-form";

export const metadata: Metadata = {
  title: "Request access | SO to Dispatch",
};

// Session state is per-request, so this page can't be statically cached.
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // Signed-in users have no reason to request access.
  if (await isAuthenticated()) redirect("/risansi/dashboard");

  return (
    // Same viewport-locked layout as /login — the signup form is taller, so
    // its panel scrolls internally on short screens.
    <main className="flex min-h-screen w-full bg-background lg:h-screen lg:overflow-hidden">
      {/* LEFT: brand panel */}
      <BrandPanel />

      {/* RIGHT: form panel — floating rounded card overlapping the brand
          panel on large screens (matches the sign-in mockup). */}
      <section className="relative z-10 flex flex-1 basis-[40%] items-center justify-center overflow-y-auto bg-card px-6 py-10 sm:px-10 lg:-ml-8 lg:rounded-l-[32px] lg:py-8 lg:shadow-[-24px_0_60px_-30px_rgba(10,42,94,0.45)]">
        <SignupForm />
      </section>
    </main>
  );
}
