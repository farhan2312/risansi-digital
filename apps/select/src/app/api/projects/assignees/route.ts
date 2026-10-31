import { error, json } from "@/lib/api";
import { AuthError, requireEnquiryManager } from "@/lib/auth";
import { listAssignees } from "@/lib/enquiry-access";

export const dynamic = "force-dynamic";

/** GET - who an enquiry can be assigned to (active workers and the master,
 *  plus the caller). For the Create Enquiry form and Reassign. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await requireEnquiryManager(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  return json((await listAssignees(claims.sub)).map((a) => ({ ...a, is_me: a.id === claims.sub })));
}
