"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import AuditLogPage from "@/screens/admin/AuditLogPage";

export default function Page() {
  return (
    <AuthGuard systemAdminOnly>
      <AuditLogPage />
    </AuthGuard>
  );
}
