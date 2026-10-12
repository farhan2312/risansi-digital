import apiClient from "./apiClient";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string;
  role: "user" | "selection_head" | "pulley_owner" | "admin" | "system_admin";
  /** True while the user still has an admin-issued password — they're routed
   * to /change-password until they set their own. */
  mustChangePassword?: boolean;
}

export interface LoginResult {
  user: AuthUser;
}

// "system_admin" is deliberately not offered here — the highest privilege
// tier is never self-requestable, only granted by an existing system admin
// (via the Users & Access page).
export type RequestableRole = "user" | "admin";

export const requestAccess = async (
  name: string,
  email: string,
  password: string,
  role: RequestableRole
) => {
  const { data } = await apiClient.post("/access-requests", {
    name,
    email,
    password,
    role,
  });
  return data;
};

export const login = async (
  email: string,
  password: string
): Promise<LoginResult> => {
  const { data } = await apiClient.post<LoginResult>("/auth/login", {
    email,
    password,
  });
  return data;
};

export const changePassword = async (
  currentPassword: string,
  newPassword: string
) => {
  // Auth is via the httpOnly session cookie, sent automatically on this
  // same-origin request — no Authorization header needed.
  const { data } = await apiClient.post("/auth/change-password", {
    currentPassword,
    newPassword,
  });
  return data;
};

export const logout = async () => {
  await apiClient.post("/auth/logout");
};
