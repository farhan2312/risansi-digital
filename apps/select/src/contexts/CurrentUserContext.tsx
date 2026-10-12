"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import apiClient from "../services/apiClient";

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string;
  // "user": main app only. "admin": also gets the admin master pages, but
  // not access requests. "system_admin": full control, including access
  // requests. Assigned directly in the DB — no self-service promotion UI.
  role: "user" | "selection_head" | "pulley_owner" | "admin" | "system_admin";
}

interface CurrentUserContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserContextValue | undefined>(undefined);

/** Fetches the logged-in user from /api/auth/me — the session itself lives
 * in an httpOnly cookie the client can't read, so this call (backed by that
 * cookie) is the only source of truth for "who am I", replacing the old
 * localStorage-cached user object. */
export const CurrentUserProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get<CurrentUser>("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <CurrentUserContext.Provider value={{ user, loading, refresh }}>
      {children}
    </CurrentUserContext.Provider>
  );
};

export const useCurrentUser = () => {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    throw new Error("useCurrentUser must be used within a CurrentUserProvider");
  }
  return ctx;
};
