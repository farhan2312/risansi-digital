import axios from "axios";

// Same-origin Next.js route handlers under /api — no CORS needed, and the
// browser attaches the httpOnly auth cookie automatically. withCredentials
// is a no-op for same-origin requests but keeps this correct if
// NEXT_PUBLIC_API_BASE_URL is ever pointed at a different origin.
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "/api",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

export default apiClient;
