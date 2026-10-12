/** The documents offered on Admin > Documentation. The PDFs live in /private-docs (deliberately not in
 * /public, which would serve them to anyone) and are only ever sent by GET /api/admin-docs/[name], which
 * requires an admin. Adding a document = drop the PDF in /private-docs and add a row here. */
export interface AdminDoc {
  slug: string;
  title: string;
  description: string;
  file: string;
  /** Download name the browser saves it as. */
  downloadName: string;
}

export const ADMIN_DOCS: AdminDoc[] = [
  {
    slug: "functional",
    title: "Functional Documentation",
    description: "What the portal does and how each role uses it: roles, sign-in, every screen and feature, business rules and glossary.",
    file: "functional-documentation.pdf",
    downloadName: "Pump Testing Portal - Functional Documentation.pdf",
  },
  {
    slug: "technical",
    title: "Technical Documentation",
    description: "How it is built: architecture, environment, authentication, data model, API reference, business-logic modules, deployment and known risks.",
    file: "technical-documentation.pdf",
    downloadName: "Pump Testing Portal - Technical Documentation.pdf",
  },
];
