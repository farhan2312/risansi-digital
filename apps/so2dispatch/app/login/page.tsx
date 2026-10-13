import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";
import { BrandPanel } from "@/components/auth/brand-panel";
import { LoginForm } from "@/components/login/login-form";

export const metadata: Metadata = {
  title: "Sign in | SO to Dispatch",
};

// Session state is per-request, so this page can't be statically cached.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string }>;
}) {
  // Already signed in? Skip the form and go straight to the app.
  if (await isAuthenticated()) redirect("/risansi/dashboard");

  const { requested } = await searchParams;
  const notice =
    requested === "1"
      ? "Request submitted — your access is now pending admin approval."
      : undefined;

  return (
    // lg:h-screen + per-panel scrolling keeps the desktop layout inside the
    // viewport — the page itself never scrolls, and a short viewport scrolls
    // the form panel rather than pushing the whole page down.
    <main className="flex min-h-screen w-full bg-background lg:h-screen lg:overflow-hidden">
      {/* LEFT: brand panel */}
      <BrandPanel />

      {/* RIGHT: form panel — a floating rounded card that overlaps the brand
          panel slightly on large screens (matches the sign-in mockup). */}
      <section className="relative z-10 flex flex-1 basis-[40%] items-center justify-center overflow-y-auto bg-card px-6 py-10 sm:px-10 lg:-ml-8 lg:rounded-l-[32px] lg:py-8 lg:shadow-[-24px_0_60px_-30px_rgba(10,42,94,0.45)]">
        <LoginForm notice={notice} />
      </section>
    </main>
  );
}
