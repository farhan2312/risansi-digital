/**
 * Make a photograph small enough to actually reach the server.
 *
 * WHY THIS HAS TO EXIST
 *
 * The attachment route allows 20 MB, and 20 MB cannot arrive. Vercel caps a
 * serverless function's request body at 4.5 MB whatever the application says,
 * so a phone photo — routinely 8 to 15 MB — is refused by the platform before
 * any of our code runs. What the person sees is an upload that fails for no
 * stated reason, which is what happened on complaint 425.
 *
 * The complaint register is mostly photographs: the leak, the damaged part,
 * the nameplate. A 12 MP photo of a document carries far more detail than
 * anybody reads it at, so it is re-drawn smaller and re-encoded before it is
 * sent. A PDF or a workbook cannot be treated this way and is left alone —
 * the caller says so plainly instead.
 *
 * WHAT IT DOES NOT DO
 *
 * Touch the file when it is already small enough. Touch anything that is not
 * an image. Pretend to have worked: if the browser cannot decode the format
 * (HEIC is the one that bites, and iPhones produce it), the original is
 * returned and the upload fails honestly rather than silently sending
 * something corrupt.
 */

/** Comfortably under the 4.5 MB the platform will carry, with multipart overhead. */
export const UPLOAD_CEILING_BYTES = 4_000_000;

/** Long edge after shrinking. A4 at 200dpi is about 2340px, so text stays readable. */
const MAX_EDGE = 2400;

const QUALITIES = [0.82, 0.7, 0.6, 0.5];

export const isImage = (f: File): boolean => /^image\//i.test(f.type);

export const fmtBytes = (b: number): string =>
  b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;

/**
 * A smaller version of the same photograph, or the original where that is not
 * possible or not needed.
 *
 * Tries progressively harder rather than guessing a quality: one pass at 0.82
 * clears almost everything, and the rest are there for the 48 MP phones.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!isImage(file) || file.size <= UPLOAD_CEILING_BYTES) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC, or anything else this browser cannot decode. Leave it alone; the
    // caller will say the file is too big, which is true and actionable.
    return file;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // White underneath: a PNG screenshot with transparency becomes black
    // behind the text otherwise, which is how a readable document turns into
    // an unreadable one on the way to being smaller.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    for (const q of QUALITIES) {
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q));
      if (!blob) break;
      if (blob.size <= UPLOAD_CEILING_BYTES || q === QUALITIES[QUALITIES.length - 1]) {
        if (blob.size >= file.size) return file;    // nothing gained; keep the original
        return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
      }
    }
    return file;
  } finally {
    bitmap.close?.();
  }
}

/** `leak photo.HEIC` → `leak photo.jpg`. The name is what somebody looks for later. */
function jpegName(name: string): string {
  return /\.jpe?g$/i.test(name) ? name : `${name.replace(/\.[^.]+$/, '')}.jpg`;
}
