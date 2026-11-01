// One row of a drill-down list, shared by the three panels that draw them.
//
// It lives here, in a plain module, and NOT in either of the 'use server'
// files that produce it. That is not tidiness — it is the fix for a bug that
// took the whole landing dashboard down.
//
// A 'use server' module has every one of its exports turned into a server
// reference at build time. A type declared and exported in the same file is
// erased before that happens and costs nothing. A type IMPORTED from another
// module and then re-exported is not: the transform emits a reference to a
// binding that no longer exists, and the module throws
//
//     ReferenceError: DrillRow is not defined ... at module evaluation
//
// the first time anything calls an action in it. Every action in the file
// rejects, before a single line of its own code runs — so no amount of
// try/catch inside those actions can see it, and the only trace is a digest
// in the platform's log. See scripts/use-server-export-check.mjs, which now
// fails the build rather than letting this happen again.
export interface DrillRow {
  clientId: number;
  code: string;
  name: string;
  /** Rupees, or null for a count-only list. */
  value: number | null;
  /** A second line — stage, date, purpose. */
  detail?: string | null;

  // ── Added for every client list, whichever number was clicked ──
  /** The last visit, as 'DD Mon YYYY'. Null when there has never been one. */
  lastVisit?: string | null;
  /** What the rep wrote on that visit. */
  lastRemark?: string | null;
  /** Rupees still live: quoted, negotiating or on hold. */
  openPipelineInr?: number | null;
  /** Where this client's quotations stand — '2 Active · 1 Lost'. */
  quoteStatus?: string | null;
}
