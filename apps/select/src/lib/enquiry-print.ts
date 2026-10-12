/**
 * Opens the browser's own print dialog for a standalone HTML document (the
 * enquiry's Technical Data Sheet, lib/tech-doc.ts).
 *
 * Why a hidden iframe rather than window.open: popup blockers routinely kill
 * `window.open` prints, and printing the live page would drag in the app's
 * chrome and modal styling. An iframe on the same origin is never blocked and
 * gives us a clean document we fully control.
 *
 * The document deliberately does NOT set `@page { size: … }` — the user picks
 * page size, orientation, page range and "Save as PDF" in the dialog.
 */

/** Renders `html` into an off-screen iframe and opens the print dialog.
 *  Resolves once the dialog has been dismissed (or immediately on browsers
 *  that don't block on print). */
export function printHtml(html: string): Promise<void> {
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
