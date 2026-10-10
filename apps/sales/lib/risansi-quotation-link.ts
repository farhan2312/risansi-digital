// One reading of opportunities.quotation_link, shared by every screen and export
// that shows it.
//
// The column has accumulated four different meanings over the life of the app,
// and until now each screen guessed at them separately:
//
//   236  an in-app path, /api/risansi/opportunities/<id>/quotation — a real
//        uploaded PDF, the only shape the app still creates.
//   679  one or more external SharePoint urls, typed in before uploads existed.
//        39 of those hold TWO urls separated by blank lines, because someone
//        pasted a second quotation into the same box; 5 also carry a document
//        name alongside the url.
//    10  a document name with no url at all — 'For Panpat.pdf',
//        'Risansi_Spare_Quotation_SHRI MALAPRABHA SSK_Dt09-06-2026'. A record
//        that a quotation exists somewhere, not an address.
//   886  null.
//
// Two of those shapes were actively broken in the UI. A bare name went into
// href={...} unchanged, and a browser resolves that relative to the current
// page — so 'For Panpat.pdf' on /risansi/clients/393 navigated to
// /risansi/clients/For%20Panpat.pdf and 404'd. A two-url value went into href
// whole, blank lines and all, so the second quotation was unreachable and the
// first was wrapped in a url the browser had to guess at.
//
// Nothing here discards anything. The stored text is left exactly as it is and
// read more carefully instead, which is what turns those 39 second links back
// into something a rep can click.
//
// The legacy set is CLOSED. createOpportunity and updateOpportunity no longer
// read quotation_link from the request, so the only writer left is
// syncQuotationLink, which writes a path it builds itself. That is what makes
// the assumptions below safe rather than lucky: every external url this parser
// will ever see is one of the 689 already in the table, and all of them were
// checked — none contains an internal space, none ends in punctuation, and every
// one round-trips through new URL(). A parser facing arbitrary future input
// would need to be stricter than this one is.

/** Matches a url up to the first whitespace or angle/quote delimiter. */
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

export type QuotationLinkKind =
  | 'none'          // nothing recorded
  | 'upload'        // a document attached in the app
  | 'legacy-link'   // one or more external urls from before uploads existed
  | 'legacy-name';  // a document name on record, with no address to open

export interface QuotationLink {
  kind: QuotationLinkKind;
  /** In-app path for an uploaded document. Null for every other kind. */
  appPath: string | null;
  /** Every external url found, de-duplicated, in the order they were written. */
  urls: string[];
  /** Descriptive text sitting alongside the urls, or the whole value when that is all there is. */
  label: string;
}

const EMPTY: QuotationLink = { kind: 'none', appPath: null, urls: [], label: '' };

/**
 * Read a stored quotation_link into its parts.
 *
 * Trailing punctuation is trimmed off a url because a link pasted at the end of
 * a sentence keeps the full stop, and a SharePoint url ending in '.' 404s.
 */
export function parseQuotationLink(stored: string | null | undefined): QuotationLink {
  const v = (stored ?? '').trim();
  if (!v) return EMPTY;

  // An in-app path is unambiguous and cannot contain anything else — but the
  // SECOND character decides whether it is in-app at all. '//evil.com/x' is a
  // protocol-relative url, and a browser normalises a backslash to a forward
  // slash for http(s), so '/\evil.com/x' resolves off-site in exactly the same
  // way. Either would put an outside address in an href that every reader
  // believes points inside the portal.
  //
  // Nothing can write those shapes today: syncQuotationLink is the only writer
  // left and it builds the path itself. The check lives here anyway, because
  // this function is what decides whether a value is safe to put in an href, and
  // that decision should not rest on the good behaviour of its callers.
  if (v.startsWith('/') && v[1] !== '/' && v[1] !== '\\') {
    return { kind: 'upload', appPath: v, urls: [], label: '' };
  }

  const found = v.match(URL_RE) ?? [];
  const urls = [...new Set(found.map(u => u.replace(/[.,;:)\]}]+$/, '')))];

  // Whatever is left once the urls are lifted out is the human's own note.
  const label = v.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();

  if (urls.length) return { kind: 'legacy-link', appPath: null, urls, label };
  return { kind: 'legacy-name', appPath: null, urls: [], label };
}

/** A record that predates uploads: an external url, or a name with no address. */
export function isLegacyQuotation(stored: string | null | undefined): boolean {
  const k = parseQuotationLink(stored).kind;
  return k === 'legacy-link' || k === 'legacy-name';
}

/**
 * The one address to open, if there is one.
 *
 * The first url for a legacy record, the in-app path for an upload, and null for
 * a name-only record — which is the case that used to produce a broken relative
 * href. Callers that can show more than one url should read `urls` instead.
 */
export function quotationHref(stored: string | null | undefined): string | null {
  const q = parseQuotationLink(stored);
  if (q.kind === 'upload') return q.appPath;
  if (q.kind === 'legacy-link') return q.urls[0] ?? null;
  return null;
}

/** How many separate addresses a legacy record carries. 0 for a name-only record. */
export function quotationLinkCount(stored: string | null | undefined): number {
  return parseQuotationLink(stored).urls.length;
}

/**
 * What kind of record this is, as a short stable value.
 *
 * A categorical column for the exports, so a pivot can separate quotations the
 * portal holds from quotations that live on someone's OneDrive. Deliberately a
 * closed vocabulary — no document names, no urls — because a Power BI slicer
 * built on this should have five entries, not nine hundred.
 *
 * `docCount` is the row count from opportunity_quotation_files and it decides
 * the answer whenever it is above zero. The stored link cannot: syncQuotationLink
 * will not overwrite a legacy url, so an opportunity that had a SharePoint link
 * and has since had its quotation uploaded still stores the SharePoint url.
 * Reading the string alone labels that row "Legacy link" while the PDF sits in
 * the portal — and as reps work through the 678, that becomes the common case
 * rather than the exception.
 */
export function quotationRecordLabel(
  stored: string | null | undefined, opts?: { docCount?: number },
): string {
  const docs = opts?.docCount ?? 0;
  const q = parseQuotationLink(stored);
  if (docs > 0) {
    const kept = q.kind === 'legacy-link' || q.kind === 'legacy-name';
    return kept ? 'Attached (legacy kept)' : 'Attached';
  }
  switch (q.kind) {
    case 'upload':      return 'Attached';
    case 'legacy-link': return q.urls.length > 1 ? `Legacy link (${q.urls.length})` : 'Legacy link';
    case 'legacy-name': return 'Name only';
    default:            return '';
  }
}

/**
 * Where a spreadsheet should send someone for this opportunity's quotation.
 *
 * The document the portal holds wins, and the legacy record is kept in the cell
 * text underneath rather than being dropped — the whole point being that neither
 * one disappears. Returns an absolute address, because a relative path is dead
 * the moment the sheet leaves the browser.
 */
export function quotationExportLink(
  stored: string | null | undefined,
  opts: { docCount?: number; oppId: number | string; origin: string },
): { text: string; href: string | null } {
  const origin = opts.origin.replace(/\/+$/, '');
  const q = parseQuotationLink(stored);
  const portal = `${origin}/api/risansi/opportunities/${opts.oppId}/quotation`;

  if ((opts.docCount ?? 0) > 0) {
    const legacy = q.kind === 'legacy-link' ? q.urls
      : q.kind === 'legacy-name' ? [`${q.label} (no file)`]
      : [];
    return { text: [portal, ...legacy].join('\n'), href: portal };
  }
  switch (q.kind) {
    case 'upload':      return { text: `${origin}${q.appPath}`, href: `${origin}${q.appPath}` };
    case 'legacy-link': return { text: q.urls.join('\n'), href: q.urls[0] ?? null };
    case 'legacy-name': return { text: `${q.label} (no file)`, href: null };
    default:            return { text: '', href: null };
  }
}

/**
 * The text for a spreadsheet cell: every url on its own line, so the 39
 * opportunities holding a second quotation do not export as though they held
 * one. A cell carries a single hyperlink, so the caller points that at
 * quotationHref() and lets the text carry the rest.
 *
 * `origin` makes an in-app upload path absolute; without it that path is dead
 * the moment the sheet leaves the browser.
 */
export function quotationCellText(
  stored: string | null | undefined, opts?: { origin?: string },
): string {
  const q = parseQuotationLink(stored);
  switch (q.kind) {
    case 'upload':      return `${(opts?.origin ?? '').replace(/\/+$/, '')}${q.appPath}`;
    case 'legacy-name': return `${q.label} (no file)`;
    case 'legacy-link': return q.urls.join('\n');
    default:            return '';
  }
}
