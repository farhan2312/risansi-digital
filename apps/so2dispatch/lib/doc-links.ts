// SharePoint links kept in one text column, one on each line: a GAD issued to
// Planning, a QC document. An old single link is simply a list of one. Plain
// module: the forms, the tables and the server read the same rules.

/** The links in a stored or typed value, blanks dropped. */
export function splitLinks(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** A link a person can safely click: http or https, with no spaces. */
export function isWebLink(link: string): boolean {
  return /^https?:\/\/\S+$/i.test(link);
}
