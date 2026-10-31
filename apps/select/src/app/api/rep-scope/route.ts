import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { repContext } from "@/lib/rep-scope";

export const dynamic = "force-dynamic";

/** GET - for a Rep / Rep Manager: who they are in the sales portal and (Rep
 *  Manager) the reps under them, for the "Rep" picker. Null for other roles. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  try {
    return json(await repContext(claims));
  } catch (e) {
    console.error("rep-scope failed:", e instanceof Error ? e.message : e);
    return error("Couldn't read your team from the sales portal right now", 502);
  }
}
