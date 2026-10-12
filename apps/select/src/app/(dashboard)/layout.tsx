"use client";

import type { ReactNode } from "react";

import AuthGuard from "@/components/auth/AuthGuard";
import { CurrentUserProvider } from "@/contexts/CurrentUserContext";
import DashboardLayout from "@/layouts/DashboardLayout";

export default function DashboardGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <CurrentUserProvider>
      <AuthGuard>
        <DashboardLayout>{children}</DashboardLayout>
      </AuthGuard>
    </CurrentUserProvider>
  );
}
