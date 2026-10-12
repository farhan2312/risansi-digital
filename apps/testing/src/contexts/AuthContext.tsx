"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getCurrentSession, type AuthUser } from "@/services/authService";

interface AuthContextValue {
  user: AuthUser | null;
  /** True only while the very first /auth/me check is in flight -- AuthGuard
   * renders nothing during this window. A later refresh() (e.g. after
   * changing password) updates `user` without flipping this back on, so the
   * app doesn't blank out again once it's already showing. */
  isLoading: boolean;
  isAdmin: boolean;
  isCentralAdmin: boolean;
  isSource: boolean;
  /** Admin or Central Admin -- who can Assign Retest and browse the Action
   * Registry (see CLAUDE.md's role table). */
  canAssignRetest: boolean;
  refresh: () => Promise<AuthUser | null>;
  /** Clears the in-memory user immediately (e.g. right before navigating
   * away after logout) -- doesn't touch the cookie itself, that's the
   * server's job via POST /auth/logout. */
  clear: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Holds the logged-in user's info in memory only -- deliberately not
 * localStorage or any other browser storage. The real credential is an
 * httpOnly cookie this app can never read; GET /auth/me verifies it
 * server-side, and this provider is the one place that result is fetched
 * and cached (in React state, gone on refresh/tab close) for the rest of
 * the app to read via useAuth(). AuthGuard consumes `user`/`isLoading` to
 * decide whether to render or redirect -- this provider itself makes no
 * routing decisions.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    try {
      const fresh = await getCurrentSession();
      setUser(fresh);
      return fresh;
    } catch {
      setUser(null);
      return null;
    } finally {
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clear = useCallback(() => setUser(null), []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAdmin: user?.role === "admin",
    isCentralAdmin: user?.role === "central-admin",
    isSource: user?.role === "source",
    canAssignRetest: user?.role === "admin" || user?.role === "central-admin",
    refresh,
    clear,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
