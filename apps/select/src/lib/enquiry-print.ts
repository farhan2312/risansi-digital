/**
 * Opens the browser's own print dialog for a standalone HTML document (the
 * enquiry's Technical Data Sheet, lib/tech-doc.ts).
 *
 * Why a hidden iframe rather than window.open: popup blockers routinely kill
 * `window.open` prints, and printing the live page would drag in the app's
 * chrome and modal styling. An iframe on the same origin is never blocked and
 * gives us a clean document we fully control.
 *
 * The document itself sets no `@page { size: … }`. A page size picked beside
 * the Print button (A4 / A3, portrait or landscape) is added here; "" leaves
 * it to the dialog. The sheet then fills the page width.
 *
 * No page link / date / title on the printout (user, 2026-11-07): Chrome leaves out
 * its own header and footer (the page's URL, date and title) once the document
 * gives a page margin box any content, so an empty-looking one (a no-break space)
 * is added to every print.
 */

export type PrintPageSize = "" | "A4" | "A4 landscape" | "A3" | "A3 landscape";

/** Turns off the browser's own header and footer (URL, date, title). */
const NO_BROWSER_HEADER = `@page { @bottom-center { content: "\\00a0"; } }`;

/** The document with the chosen page size, and without the browser's header and footer. */
function withPageSize(html: string, size: PrintPageSize): string {
  const css = size
    ? `<style>@page { size: ${size}; } @media print { .sheet { max-width: none; } } ${NO_BROWSER_HEADER}</style>`
    : `<style>${NO_BROWSER_HEADER}</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${css}</head>`) : css + html;
}

/** Renders `html` into an off-screen iframe and opens the print dialog.
 *  Resolves once the dialog has been dismissed (or immediately on browsers
 *  that don't block on print). */
export function printHtml(html: string, pageSize: PrintPageSize = ""): Promise<void> {
  html = withPageSize(html, pageSize);
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    // Off-screen rather than display:none - a hidden frame prints blank in
    // some browsers.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;";
    document.body.appendChild(frame);

    const cleanup = () => {
      // Give the print job time to spool before tearing the frame down.
      setTimeout(() => {
        frame.remove();
        resolve();
      }, 500);
    };

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      // Let the logo (and layout) settle before the dialog opens.
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {
          // Printing unavailable (e.g. blocked) - fall through to cleanup so
          // the frame never leaks.
        }
        cleanup();
      }, 250);
    };

    const doc = frame.contentDocument;
    if (!doc) {
      cleanup();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  });
}
