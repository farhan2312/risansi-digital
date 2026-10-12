import axios from "axios";

// The backend is now this same Next.js app's route handlers, served under
// /api on the same origin — so the default base URL is just "/api". Override
// with NEXT_PUBLIC_API_BASE_URL to point at a different deployment.
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

/** Calls whose 401 means "wrong password", not "your session is gone" — the
 * screen making them shows the error itself. */
const CREDENTIAL_ENDPOINTS = ["/auth/login", "/auth/change-password", "/access-requests"];

// A 401 anywhere else means the session is over: it expired, or the account
// was deactivated, had its role changed or its password reset (middleware.ts
// ends the session in each case). Go back to the login page, which says why,
// instead of leaving the user on a screen whose every action now fails.
apiClient.interceptors.response.use(undefined, (err) => {
  if (typeof window !== "undefined" && err?.response?.status === 401) {
    const url = String(err.config?.url ?? "");
    const isCredentialCall = CREDENTIAL_ENDPOINTS.some((path) => url.endsWith(path));
    if (!isCredentialCall && window.location.pathname !== "/") {
      window.location.assign("/?session=ended");
    }
  }
  return Promise.reject(err);
});

export default apiClient;
