"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";

interface AuthGuardProps {
  children: ReactNode;
  adminOnly?: boolean;
}

/**
 * Client-side route guard, replacing the old react-router ProtectedRoute /
 * AdminRoute. Reads AuthProvider's in-memory user (populated by a verified
 * GET /auth/me against the real httpOnly cookie -- see AuthContext.tsx) and
 * either redirects or reveals the protected content once that check
 * resolves. Renders nothing while loading or once a redirect has been
 * kicked off, so protected content is never shown to a logged-out user
 * even for a frame.
 */
const AuthGuard = ({ children, adminOnly = false }: AuthGuardProps) => {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const forbidden = adminOnly && user?.role !== "admin";

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (forbidden) {
      router.replace("/dashboard");
    }
  }, [isLoading, user, forbidden, router]);

  if (isLoading || !user || forbidden) return null;

  return <>{children}</>;
};

export default AuthGuard;
