"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import UsersAccessPage from "@/screens/admin/UsersAccessPage";

export default function Page() {
  return (
    <AuthGuard systemAdminOnly>
      <UsersAccessPage />
    </AuthGuard>
  );
}
