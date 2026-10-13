import "server-only";
import type { PDFFont } from "pdf-lib";

// Text handling shared by the PDF reports. They draw with pdf-lib's standard
// fonts, which encode WinAnsi only — Latin-1 plus the common punctuation.

// Characters the audit trail really uses that WinAnsi lacks, spelled out so
// they read rather than turning into "?".
const SPELLED: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "₹": "Rs.",
  "✓": "v",
  "≥": ">=",
  "≤": "<=",
};

/**
 * Replace only the characters the standard font cannot encode. WinAnsi
 * covers Latin-1 plus the common punctuation (em dash, curly quotes), so a
 * blanket ASCII filter would mangle text the font renders perfectly well.
 */
export function sanitize(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text) {
    if (SPELLED[ch]) {
      out += SPELLED[ch];
      continue;
    }
    try {
      font.widthOfTextAtSize(ch, 9);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Greedy word wrap to a pixel width, so long text doesn't run off the page. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = sanitize(text, font).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // A single word longer than the column is split character by character.
    if (font.widthOfTextAtSize(word, size) > width) {
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > width) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    } else {
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
