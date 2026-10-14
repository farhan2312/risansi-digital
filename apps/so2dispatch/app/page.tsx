import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";

// Session state is per-request, so this page can't be statically cached.
export const dynamic = "force-dynamic";

/** Root entry: straight into the app when signed in, otherwise to sign-in. */
export default async function Home() {
  redirect((await isAuthenticated()) ? "/risansi/dashboard" : "/login");
}
