import { redirect } from "next/navigation";
import { HUB_SIGN_UP_URL } from "@/lib/hub";

// Retired (Phase 5, step 7): accounts are made, and access asked for, at
// Risansi Digital. Old links to this page land there.
export default function SignupPage() {
  redirect(HUB_SIGN_UP_URL);
}
