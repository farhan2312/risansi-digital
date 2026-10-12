import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  return json({ status: "ok" });
}
