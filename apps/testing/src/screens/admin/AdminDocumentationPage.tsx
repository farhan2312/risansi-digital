"use client";

import AdminPageHeader from "@/components/ui/AdminPageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { ADMIN_DOCS } from "@/lib/adminDocs";

const AdminDocumentationPage = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (user?.role !== "admin") {
    return <p className="p-10 text-sm font-medium text-neg">Only an admin can view the documentation.</p>;
  }

  return (
    <div className="tw-reset mx-auto flex max-w-[1100px] flex-col gap-6 p-10">
      <AdminPageHeader
        title="Documentation"
        subtitle="Functional and technical documentation for the Pump Testing Portal · visible to admins only"
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {ADMIN_DOCS.map((doc) => (
          <section key={doc.slug} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
                  <path d="M14 3v5h5M9 13h6M9 17h6" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 className="m-0 text-lg font-bold text-text-h">{doc.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">{doc.description}</p>
              </div>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2.5">
              <a
                href={`/api/admin-docs/${doc.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-hover"
              >
                Open PDF
              </a>
              <a
                href={`/api/admin-docs/${doc.slug}?download=1`}
                className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-text transition hover:bg-surface-hover"
              >
                Download
              </a>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default AdminDocumentationPage;
