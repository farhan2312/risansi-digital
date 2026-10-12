import { redirect } from "next/navigation";

// Access Requests was merged into Users & Access -- keep the old URL working
// for anyone with it bookmarked.
export default function AccessRequestsPage() {
  redirect("/admin/users");
}
