/**
 * Coarse device / OS / browser from a User-Agent string, for the Audit Log's
 * device breakdown and the device shown next to each sign-in.
 *
 * Deliberately simple pattern matching — no dependency, safe on the client
 * and the server. Order matters: Edge and the Claude desktop app also say
 * "Chrome", and Chrome also says "Safari".
 */
export interface DeviceInfo {
  device: "Desktop" | "Mobile" | "Tablet" | "Unknown";
  os: string;
  browser: string;
}

export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { device: "Unknown", os: "Unknown", browser: "Unknown" };

  const device: DeviceInfo["device"] =
    /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))
      ? "Tablet"
      : /Mobi|iPhone|iPod|Android/i.test(ua)
        ? "Mobile"
        : "Desktop";

  const os = /Windows/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Android/i.test(ua)
        ? "Android"
        : /CrOS/i.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/i.test(ua)
            ? "macOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Other";

  const browser = /Claude\//.test(ua)
    ? "Claude app"
    : /Edg(e|A|iOS)?\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /Firefox\/|FxiOS/.test(ua)
            ? "Firefox"
            : /Chrome\/|CriOS/.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "Other";

  return { device, os, browser };
}

/** "Chrome · Windows" — the short form shown in tables. */
export const deviceText = (ua: string | null | undefined): string => {
  if (!ua) return "—";
  const d = parseUserAgent(ua);
  return `${d.browser} · ${d.os}`;
};
