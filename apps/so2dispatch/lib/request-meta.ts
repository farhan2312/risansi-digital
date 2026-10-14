// Where a request came from: the client's address and what it was using.
// Recorded with every audit event (lib/audit.ts). Server-only.

import { isIP } from "node:net";
import { headers } from "next/headers";

export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
};

const EMPTY: RequestMeta = {
  ip: null,
  userAgent: null,
  device: null,
  browser: null,
  os: null,
};

/** Longest user agent kept; real ones are well under this. */
const UA_MAX = 512;

/**
 * One address as a proxy wrote it, without the decoration: Azure App Service
 * appends the client port ("203.0.113.7:51234"), IPv6 may come bracketed, and
 * an IPv4 client on a dual-stack socket reads "::ffff:203.0.113.7". Anything
 * that is still not an address afterwards is dropped rather than stored.
 */
export function cleanIp(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  const bracketed = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) s = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  if (s.toLowerCase().startsWith("::ffff:") && isIP(s.slice(7)) === 4) s = s.slice(7);
  return isIP(s) ? s : null;
}

/**
 * The client address. Behind the hosting proxy the socket's peer is the proxy
 * itself, so the address comes from the forwarding headers: the first entry of
 * X-Forwarded-For is the original client, the rest are proxies it passed.
 *
 * These headers are only as trustworthy as the proxy in front of the app — one
 * that appends to a client-supplied X-Forwarded-For lets a client choose its
 * first entry. Read the address as where a request claims to be from, which is
 * what an audit trail can honestly say.
 */
function clientIp(h: Headers): string | null {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = cleanIp(forwarded.split(",")[0]);
    if (first) return first;
  }
  for (const name of ["x-real-ip", "x-client-ip", "x-azure-clientip"]) {
    const ip = cleanIp(h.get(name));
    if (ip) return ip;
  }
  return null;
}

/** Desktop, Mobile or Tablet — or null when there is no user agent to read. */
export function deviceOf(ua: string): string | null {
  if (!ua) return null;
  if (/bot|crawler|spider|curl|wget|python-requests|node-fetch/i.test(ua)) return "Other";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return "Tablet";
  }
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "Mobile";
  return "Desktop";
}

/** The browser family. Order matters: Edge and Opera also claim to be Chrome. */
export function browserOf(ua: string): string | null {
  if (!ua) return null;
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return "Other";
}

/** The operating system family. iOS before macOS: iPhones say "like Mac OS X". */
export function osOf(ua: string): string | null {
  if (!ua) return null;
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

/** Everything the audit trail keeps about the request being served. */
export function metaFromHeaders(h: Headers): RequestMeta {
  const ua = (h.get("user-agent") ?? "").slice(0, UA_MAX);
  return {
    ip: clientIp(h),
    userAgent: ua || null,
    device: deviceOf(ua),
    browser: browserOf(ua),
    os: osOf(ua),
  };
}

/**
 * The current request's origin, or all nulls when there is no request — a
 * script or a background job has no client to record, and asking for headers
 * there throws.
 */
export async function currentRequestMeta(): Promise<RequestMeta> {
  try {
    return metaFromHeaders(await headers());
  } catch {
    return EMPTY;
  }
}
