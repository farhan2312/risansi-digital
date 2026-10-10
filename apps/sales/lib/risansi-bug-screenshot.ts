import { NextResponse } from 'next/server';

export interface BugScreenshotBytes {
  file_name: string;
  mime: string;
  bytes: Buffer;
}

/**
 * Stream one bug screenshot back to the browser.
 *
 * Defence in depth: even though upload allows only raster images, never serve a
 * non-raster type inline (an SVG would execute script when opened top-level).
 * Anything unexpected is forced to a downloaded octet-stream. nosniff stops the
 * browser from re-interpreting the bytes as a different, executable type.
 *
 * Shared by the per-screenshot route and the legacy per-bug one so the two
 * cannot drift apart on the headers that make this safe.
 */
export function serveBugScreenshot(rec: BugScreenshotBytes) {
  const SAFE_RASTER = /^image\/(png|jpe?g|gif|webp|bmp)$/i;
  const safe = SAFE_RASTER.test(rec.mime || '');
  const contentType = safe ? rec.mime : 'application/octet-stream';
  const disposition = safe ? 'inline' : 'attachment';

  const body = new Uint8Array(rec.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${rec.file_name.replace(/["\r\n]/g, '')}"`,
      'Content-Length': String(body.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
