import Image from "next/image";
import logo from "@/assets/logo.png";
import { BrandPanel } from "@/components/auth/brand-panel";

/**
 * A full-page message pointing at Risansi Digital, in the sign-in page's
 * layout. Since the local login was retired (Phase 5, step 7) this is what
 * /login shows somebody signed in at the hub but refused here, and what
 * /set-password shows — links rather than redirects, so neither can loop.
 */
export function HubNotice({
  title,
  message,
  tone = "info",
  actions,
}: {
  title: string;
  message: string;
  tone?: "info" | "danger";
  actions: { label: string; href: string; primary?: boolean }[];
}) {
  return (
    <main className="flex min-h-screen w-full bg-background lg:h-screen lg:overflow-hidden">
      <BrandPanel />
      <section className="relative z-10 flex flex-1 basis-[40%] items-center justify-center overflow-y-auto bg-card px-6 py-10 sm:px-10 lg:-ml-8 lg:rounded-l-[32px] lg:py-8 lg:shadow-[-24px_0_60px_-30px_rgba(10,42,94,0.45)]">
        <div className="w-full max-w-[400px]">
          <div className="mb-4 flex justify-center">
            <Image src={logo} alt="Risansi" width={190} height={95} priority className="h-auto w-[150px]" />
          </div>
          <h1 className="mb-3 text-center font-display text-[24px] font-bold tracking-[-0.02em] text-foreground">
            {title}
          </h1>
          <div
            role={tone === "danger" ? "alert" : "status"}
            className={
              tone === "danger"
                ? "mb-6 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger"
                : "mb-6 rounded-xl border border-input-border bg-surface px-4 py-3 text-sm text-foreground"
            }
          >
            {message}
          </div>
          <div className="flex flex-col gap-3">
            {actions.map((a) => (
              <a
                key={a.href}
                href={a.href}
                className={
                  a.primary
                    ? "flex h-12 w-full items-center justify-center rounded-xl bg-primary font-display text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
                    : "flex h-12 w-full items-center justify-center rounded-xl border border-input-border font-display text-[15px] font-semibold text-foreground transition-colors hover:bg-surface"
                }
              >
                {a.label}
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
