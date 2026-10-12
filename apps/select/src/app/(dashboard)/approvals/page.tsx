"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import ApprovalsPage from "@/screens/approvals/ApprovalsPage";

export default function Page() {
  return (
    <AuthGuard approverOnly>
      <ApprovalsPage />
    </AuthGuard>
  );
}
