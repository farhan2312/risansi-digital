/** Who may delete a requisition -- shared by the DELETE API route and the button on the detail page,
 * so the UI never offers something the server will refuse. Admins only: deletion is permanent, and
 * every other role can still close out a requisition through its status instead. */
export const canDeleteRequisition = (role: string | undefined): boolean => role === "admin";
