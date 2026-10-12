"use client";

import type { ReactNode } from "react";

import AuthGuard from "@/components/auth/AuthGuard";
import DashboardLayout from "@/layouts/DashboardLayout";
import { AuthProvider } from "@/contexts/AuthContext";

export default function DashboardGroupLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGuard>
        <DashboardLayout>{children}</DashboardLayout>
      </AuthGuard>
    </AuthProvider>
  );
}
