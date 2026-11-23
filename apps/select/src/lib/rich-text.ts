// Bold and highlight in the documents (user, 2026-11-23): any text on the Technical,
// Commercial, Techno-Commercial and spare quotation documents can carry **bold** and
// ==highlight== marks - put in with the B / Highlight buttons on Edit rows
// (components/reports/RichTextButtons), or typed. The printed document (HTML / PDF)
// shows them as bold and highlighted text; Excel shows bold runs bold, a highlighted run
// bold too (Excel can't highlight part of a cell) and a cell highlighted whole filled
// yellow. The stored text keeps the marks. Client-safe.

export const BOLD_MARK = "**";
export const HIGHLIGHT_MARK = "==";

/** The printed highlight colour (CSS) and Excel's fill for a cell highlighted whole. */
export const HIGHLIGHT_CSS = "mark { background: #fff59d; color: inherit; padding: 0 1px; }";
export const HIGHLIGHT_FILL = "FFF59D";

// A marked run stays inside its cell: it never spans a <td> / <th> / <tr> tag.
const CELL_EDGE = String.raw`<\/?(?:td|th|tr)\b`;
const runRe = (mark: string) => {
  const m = mark.replace(/[*=]/g, (c) => `\\${c}`);
  return new RegExp(`${m}((?:(?!${m}|${CELL_EDGE}).)+?)${m}`, "gs");
};
const BOLD_RE = runRe(BOLD_MARK);
const HIGHLIGHT_RE = runRe(HIGHLIGHT_MARK);

/** Rows / cells of a document's (escaped) HTML with the marks made <mark> and <b>. */
export function richHtml(html: string): string {
  return html.replace(HIGHLIGHT_RE, "<mark>$1</mark>").replace(BOLD_RE, "<b>$1</b>");
}

/** Whether a text carries any mark pair. */
export const hasRichMarks = (s: string): boolean => {
  BOLD_RE.lastIndex = 0;
  HIGHLIGHT_RE.lastIndex = 0;
  const yes = BOLD_RE.test(s) || HIGHLIGHT_RE.test(s);
  BOLD_RE.lastIndex = 0;
  HIGHLIGHT_RE.lastIndex = 0;
  return yes;
};

export type RichRun = { text: string; bold: boolean; highlight: boolean };

/** A text split into runs by its marks (nested marks combine). */
export function richRuns(s: string, bold = false, highlight = false): RichRun[] {
  const out: RichRun[] = [];
  let rest = s;
  while (rest) {
    const b = /\*\*(.+?)\*\*/s.exec(rest);
    const h = /==(.+?)==/s.exec(rest);
    const first = b && (!h || b.index <= h.index) ? { m: b, bold: true } : h ? { m: h, bold: false } : null;
    if (!first) {
      out.push({ text: rest, bold, highlight });
      break;
    }
    if (first.m.index > 0) out.push({ text: rest.slice(0, first.m.index), bold, highlight });
    out.push(...richRuns(first.m[1], bold || first.bold, highlight || !first.bold));
    rest = rest.slice(first.m.index + first.m[0].length);
  }
  return out.filter((r) => r.text !== "");
}

/** The text without its marks. */
export const plainText = (s: string): string => richRuns(s).map((r) => r.text).join("");
