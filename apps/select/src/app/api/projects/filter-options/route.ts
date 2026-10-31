import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { enquiryFilterOptions } from "@/lib/enquiry-filters-server";

export const dynamic = "force-dynamic";

/** GET - the values offered in the Enquiries / Dashboard filter dropdowns:
 *  primary reps, secondary reps, zones, market types and industries found on
 *  the enquiries. Any signed-in user. */
export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  return json(await enquiryFilterOptions());
}
