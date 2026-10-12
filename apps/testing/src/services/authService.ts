import apiClient from "./apiClient";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string;
  role: "source" | "testing" | "central-admin" | "admin";
  must_change_password: boolean;
}

export interface LoginResult {
  user: AuthUser;
}

// Shares the `users` table with the sales portal — an account created here
// (or approved here) works in both apps, same credentials.
//
// The response no longer carries a `token` field -- POST /auth/login sets it
// directly as an httpOnly cookie, which JS can't read anyway. Every
// subsequent request just needs the browser's normal same-origin cookie
// behavior, no manual Authorization header.
export const login = async (email: string, password: string): Promise<LoginResult> => {
  const { data } = await apiClient.post<LoginResult>("/auth/login", { email, password });
  return data;
};

/** The only correct way to answer "am I logged in" -- verifies the real
 * httpOnly auth cookie server-side, since the client can't read or decode
 * it itself. Used by AuthGuard on every mount rather than trusting the
 * cached `authUser` in localStorage, which is just a display convenience
 * and can be cleared/edited independently of the actual session. */
export const getCurrentSession = async (): Promise<AuthUser> => {
  const { data } = await apiClient.get<AuthUser>("/auth/me");
  return data;
};

export const requestAccess = async (name: string, email: string, password: string, role: string) => {
  const { data } = await apiClient.post("/access-requests", { name, email, password, role });
  return data;
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  const { data } = await apiClient.post("/auth/change-password", { currentPassword, newPassword });
  return data;
};

/** Closes the audit-log session server-side and clears the auth cookie --
 * best-effort, sign-out proceeds client-side either way. */
export const logout = async (): Promise<void> => {
  try {
    await apiClient.post("/auth/logout", {});
  } catch {
    // Sign-out proceeds regardless -- this is just closing the audit trail.
  }
};
