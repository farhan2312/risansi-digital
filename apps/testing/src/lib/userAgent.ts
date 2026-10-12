/** Deliberately tiny User-Agent bucketing for the Audit Log's Devices /
 * Browsers / OS cards -- a handful of families is all those cards show, so
 * a full UA-parsing dependency would be overkill. Order matters: Edge and
 * Opera both also say "Chrome", and Chrome also says "Safari". */

export type DeviceKind = "Desktop" | "Mobile" | "Tablet" | "Unknown";

export interface ParsedUserAgent {
  device: DeviceKind;
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) return { device: "Unknown", browser: "Unknown", os: "Unknown" };

  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android/i.test(ua);

  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";

  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Other";

  return { device: tablet ? "Tablet" : mobile ? "Mobile" : "Desktop", browser, os };
}
