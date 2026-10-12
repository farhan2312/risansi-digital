"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import "./ProjectsPage.css";
import CreateProjectModal from "../../components/projects/CreateProjectModal";
import CopyTagModal, { type CopyDestination } from "../../components/projects/CopyTagModal";
import EnquiryDocumentModal from "../../components/reports/EnquiryDocumentModal";
import EditProjectModal from "../../components/projects/EditProjectModal";
import EmptyState from "../../components/ui/EmptyState";
import ConfirmModal from "../../components/ui/ConfirmModal";
import Pagination from "../../components/ui/Pagination";
import PageHeader from "../../components/ui/PageHeader";
import StatusPill, { lifecycleStyle } from "../../components/ui/StatusPill";
import DateRangeFilter, { useDateRange } from "../../components/ui/DateRangeFilter";
import { Segmented } from "../admin/audit/auditUi";
import {
  createProject,
  deleteProject,
  listProjects,
  listProjectsPage,
  updateProject,
  type ProjectRecord,
} from "../../services/projectService";
import {
  copyTag,
  createTag,
  deleteTag,
  listTags,
  renameTag,
  type TagRecord,
} from "../../services/tagsService";

// Cross-page hand-off replacing react-router's location.state: the selected
// project is stashed in sessionStorage for PumpSelectionPage to read on load.
export const SELECTED_PROJECT_KEY = "selectedProject";

// Enquiries per page. The server caps anything larger; this is the value the
// Enquiries table asks for.
const PAGE_SIZE = 20;

const ProjectsPage = () => {
  const router = useRouter();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<ProjectRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-project tag state. Tags load lazily on first expansion so the projects
  // list itself stays a single round-trip; once loaded, they're cached in this
  // map for the life of the page. `expanded` tracks which rows are currently
  // open. `pending` covers "loading tags" and "processing an add/rename/
  // delete" so we can gray the row while the request is in flight.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tagsByProject, setTagsByProject] = useState<Record<string, TagRecord[]>>({});
  const [tagsLoadingFor, setTagsLoadingFor] = useState<Set<string>>(new Set());
  const [tagsErrorFor, setTagsErrorFor] = useState<Record<string, string>>({});
  const [addingTagFor, setAddingTagFor] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [renamingTagId, setRenamingTagId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDeleteTag, setConfirmingDeleteTag] = useState<TagRecord | null>(null);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  // Copy flow. `copyingFrom` opens the dialog (optionally pre-selecting a tag
  // when started from a tag row). `pendingCopyTagId` survives the hand-off to
  // the Create Enquiry form: the tag is copied into whatever that form makes.
  const [copyingFrom, setCopyingFrom] = useState<{
    project: ProjectRecord;
    tagId?: string;
  } | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [pendingCopyTagId, setPendingCopyTagId] = useState<string | null>(null);
  const [copyingTagId, setCopyingTagId] = useState<string | null>(null);
  // The copy dialog offers EVERY enquiry as a destination, not just the page
  // on screen, so it loads the full list on open rather than reusing the
  // paged one. Cached for the life of the page after the first open.
  const [allProjects, setAllProjects] = useState<ProjectRecord[] | null>(null);
  // Technical Quotation for a whole enquiry - the same document the Reports
  // page shows, reachable from here too.
  const [viewingDocFor, setViewingDocFor] = useState<ProjectRecord | null>(null);

  // Filters — client name matches project.name (the "Client Name" column;
  // that's what the Create/Edit forms actually call this field), enquiry
  // code matches project.project_code. Independent, case-insensitive
  // substring matches, combined with AND.
  const [clientNameFilter, setClientNameFilter] = useState("");
  const [enquiryCodeFilter, setEnquiryCodeFilter] = useState("");

  // Server-side pagination. The filters above are applied server-side too:
  // the client only ever holds one page, so filtering here would search 20
  // rows rather than the whole table.
  const [page, setPage] = useState(1);
  // Created-date filter: a quick range, or explicit From/To days (which win).
  const dates = useDateRange("all");
  const dateWindow = dates.window;
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 1 });
  // "All enquiries" / "Created by me" — filtered on the server.
  const [scope, setScope] = useState<"all" | "mine">("all");
  // Typing is debounced so a filter keystroke doesn't fire a request each.
  const [debouncedFilters, setDebouncedFilters] = useState({ clientName: "", enquiryCode: "" });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters((current) => {
        const next = { clientName: clientNameFilter, enquiryCode: enquiryCodeFilter };
        if (current.clientName === next.clientName && current.enquiryCode === next.enquiryCode) {
          // Same text as last time (e.g. typed and undone) — keep the existing
          // object so the fetch below isn't re-triggered by a new identity.
          return current;
        }
        // Reset the page in the SAME commit as the filter change: a narrowed
        // filter can leave the current page past the end of the results, and
        // doing this in a follow-up effect would fire a wasted request for the
        // old page number first.
        setPage(1);
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [clientNameFilter, enquiryCodeFilter]);

  const loadProjects = useCallback(() => {
    setIsLoading(true);
    setError(null);
    listProjectsPage({
      page,
      pageSize: PAGE_SIZE,
      clientName: debouncedFilters.clientName,
      enquiryCode: debouncedFilters.enquiryCode,
      from: dateWindow.from,
      to: dateWindow.to,
      mine: scope === "mine",
    })
      .then((res) => {
        setProjects(res.items);
        setPageInfo({ total: res.total, totalPages: res.totalPages });
        // Deleting the last row on the last page can strand us past the end;
        // step back rather than showing an empty table.
        if (res.items.length === 0 && res.page > 1 && res.total > 0) {
          setPage(res.totalPages);
        }
      })
      .catch(() => setError("Couldn't load enquiries."))
      .finally(() => setIsLoading(false));
  }, [page, debouncedFilters, dateWindow, scope]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Copy dialog's destination list: every enquiry, fetched once on first open.
  // Falls back to the current page if the fetch fails, which is still usable.
  useEffect(() => {
    if (!copyingFrom || allProjects !== null) return;
    let cancelled = false;
    listProjects()
      .then((rows) => {
        if (!cancelled) setAllProjects(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [copyingFrom, allProjects]);

  const handleCreateProject = async (input: {
    projectCode: string;
    name: string;
    clientCode: string;
    industry: string;
    enquiryDate: string;
  }): Promise<string | null> => {
    setIsCreating(true);
    try {
      // createdBy is derived server-side from the session cookie, not sent
      // by the client.
      const created = await createProject(input);
      setIsModalOpen(false);
      // Newest-first ordering puts it at the top of page 1; re-fetching keeps
      // the page size and the total honest rather than growing this page.
      if (page === 1) loadProjects();
      else setPage(1);
      // Came here from "copy into a new enquiry": land the copy, then drop
      // the empty Default tag the create flow auto-adds, so the new enquiry
      // holds just the copied selection.
      if (pendingCopyTagId) {
        const tagId = pendingCopyTagId;
        setPendingCopyTagId(null);
        try {
          await copyTag(tagId, { targetProjectId: created.id });
          const rows = await listTags(created.id);
          const stray = rows.find((t) => t.name === "Default" && !t.liquid);
          if (stray && rows.length > 1) {
            await deleteTag(stray.id).catch(() => {});
          }
          await refreshTags(created.id);
          setExpanded((prev) => new Set(prev).add(created.id));
        } catch {
          setTagsErrorFor((e) => ({
            ...e,
            [created.id]: "Enquiry created, but the tag copy failed.",
          }));
        }
      }
      return null;
    } catch (err) {
      // Surface the API's specific message (e.g. duplicate Enquiry no.) so the
      // modal can show it inline instead of a generic failure.
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Couldn't create the project. Please try again.";
      return msg;
    } finally {
      setIsCreating(false);
    }
  };

  // Open the wizard scoped to a specific tag. If no tag is passed (legacy
  // "Open project" button) the server resolves to the project's Default tag
  // via the projectId fallback - safe for enquiries that only have one tag.
  const openProject = (project: ProjectRecord, tag?: TagRecord) => {
    sessionStorage.setItem(
      SELECTED_PROJECT_KEY,
      JSON.stringify({
        id: project.id,
        code: project.project_code,
        name: project.name,
        customer: project.customer_name,
        status: project.status,
        tagId: tag?.id,
        tagName: tag?.name,
      })
    );
    router.push("/pump-selection");
  };

  // Toggle a project's nested tag list. First expansion also triggers a
  // one-time tag fetch (cached in tagsByProject afterwards) so opening the
  // same project again is instant. Deliberately doesn't refetch on re-expand -
  // the create/rename/delete handlers keep the cache in sync themselves.
  const toggleExpanded = (projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        if (!tagsByProject[projectId] && !tagsLoadingFor.has(projectId)) {
          setTagsLoadingFor((l) => new Set(l).add(projectId));
          setTagsErrorFor((e) => {
            const { [projectId]: _drop, ...rest } = e;
            return rest;
          });
          listTags(projectId)
            .then((tags) => setTagsByProject((m) => ({ ...m, [projectId]: tags })))
            .catch(() => setTagsErrorFor((e) => ({ ...e, [projectId]: "Couldn't load tags." })))
            .finally(() =>
              setTagsLoadingFor((l) => {
                const n = new Set(l);
                n.delete(projectId);
                return n;
              }),
            );
        }
      }
      return next;
    });
  };

  const startAddTag = (projectId: string) => {
    setAddingTagFor(projectId);
    setNewTagName("");
  };
  const cancelAddTag = () => {
    setAddingTagFor(null);
    setNewTagName("");
  };
  const handleAddTag = async (projectId: string) => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const created = await createTag(projectId, name);
      setTagsByProject((m) => ({ ...m, [projectId]: [...(m[projectId] ?? []), created] }));
      setAddingTagFor(null);
      setNewTagName("");
    } catch {
      setTagsErrorFor((e) => ({ ...e, [projectId]: "Couldn't add the tag." }));
    }
  };

  const startRenameTag = (tag: TagRecord) => {
    setRenamingTagId(tag.id);
    setRenameValue(tag.name);
  };
  const cancelRenameTag = () => {
    setRenamingTagId(null);
    setRenameValue("");
  };
  const handleRenameTag = async (tag: TagRecord) => {
    const name = renameValue.trim();
    if (!name || name === tag.name) {
      cancelRenameTag();
      return;
    }
    try {
      const updated = await renameTag(tag.id, name);
      setTagsByProject((m) => ({
        ...m,
        [tag.project_id]: (m[tag.project_id] ?? []).map((t) =>
          t.id === tag.id ? { ...t, name: updated.name } : t,
        ),
      }));
    } catch {
      setTagsErrorFor((e) => ({ ...e, [tag.project_id]: "Couldn't rename the tag." }));
    } finally {
      cancelRenameTag();
    }
  };

  const handleDeleteTag = async () => {
    const target = confirmingDeleteTag;
    if (!target) return;
    setDeletingTagId(target.id);
    try {
      await deleteTag(target.id);
      setTagsByProject((m) => ({
        ...m,
        [target.project_id]: (m[target.project_id] ?? []).filter((t) => t.id !== target.id),
      }));
      setConfirmingDeleteTag(null);
    } catch (err) {
      // Surface the server's specific reason (e.g. "last tag on enquiry")
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Couldn't delete the tag.";
      setTagsErrorFor((e) => ({ ...e, [target.project_id]: msg }));
      setConfirmingDeleteTag(null);
    } finally {
      setDeletingTagId(null);
    }
  };


  // Refresh one enquiry's tag list from the server — used after a copy lands,
  // since the new tag may belong to a different enquiry than the one open.
  const refreshTags = async (projectId: string) => {
    try {
      const rows = await listTags(projectId);
      setTagsByProject((m) => ({ ...m, [projectId]: rows }));
    } catch {
      // Non-fatal: the list refreshes on the next expand.
    }
  };

  /** Open the enquiry's Technical Data Sheet (the modal loads its own data). */
  const openDocument = (project: ProjectRecord) => setViewingDocFor(project);

  /** Copy straight into the same enquiry — the per-tag copy button. */
  const handleCopyTagHere = async (tag: TagRecord) => {
    setCopyingTagId(tag.id);
    setTagsErrorFor((e) => ({ ...e, [tag.project_id]: "" }));
    try {
      await copyTag(tag.id);
      await refreshTags(tag.project_id);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Couldn't copy the tag.";
      setTagsErrorFor((e) => ({ ...e, [tag.project_id]: msg }));
    } finally {
      setCopyingTagId(null);
    }
  };

  /** Confirm from the copy dialog. "New enquiry" doesn't copy yet — it parks
   *  the tag id and opens the Create Enquiry form, which finishes the job. */
  const handleCopyConfirm = async (tagId: string, destination: CopyDestination) => {
    if (destination.kind === "new") {
      setPendingCopyTagId(tagId);
      setCopyingFrom(null);
      setCopyError(null);
      setIsModalOpen(true);
      return;
    }
    setCopyBusy(true);
    setCopyError(null);
    try {
      const targetProjectId =
        destination.kind === "existing" ? destination.projectId : undefined;
      const created = await copyTag(tagId, { targetProjectId });
      setCopyingFrom(null);
      await refreshTags(created.project_id);
      // Make the destination visible so the new tag isn't copied into a
      // collapsed row the user never sees.
      setExpanded((prev) => new Set(prev).add(created.project_id));
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Couldn't copy the tag.";
      setCopyError(msg);
    } finally {
      setCopyBusy(false);
    }
  };

  const handleEditSave = async (input: {
    name: string;
    clientCode: string;
    industry: string;
    enquiryDate: string;
    status: string;
  }) => {
    if (!editing) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateProject(editing.id, input);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditing(null);
    } catch {
      setError("Couldn't save the project changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // `projects` is already the filtered page the server returned — the filter
  // is no longer applied here. Kept under the old name so the table below is
  // unchanged.
  const filteredProjects = projects;

  const hasFilter = clientNameFilter !== "" || enquiryCodeFilter !== "" || dates.active;

  const handleDelete = async () => {
    if (!confirmingDelete) return;
    const target = confirmingDelete;
    setDeletingId(target.id);
    setError(null);
    try {
      await deleteProject(target.id);
      setConfirmingDelete(null);
      // Re-fetch so the row is backfilled from the next page and the total
      // drops; loadProjects also steps back if this emptied the last page.
      loadProjects();
    } catch {
      setError("Couldn't delete the project. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  // Tailwind building blocks for the list (modals keep their own styles).
  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-fg-2 transition-colors hover:border-[color-mix(in_srgb,var(--brand-blue)_35%,transparent)] hover:bg-paper hover:text-accent disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:h-[14px] [&_svg]:w-[14px] [&_svg]:shrink-0";
  // Commercial stands apart from the technical actions: filled amber-yellow
  // with dark text (fixed colours, readable in light and dark themes).
  const btnCommercial =
    "inline-flex items-center gap-1.5 rounded-lg border border-[#f59e0b] bg-[#fbbf24] px-2.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-[#422006] shadow-[0_1px_2px_rgba(180,83,9,0.18)] transition-colors hover:border-[#d97706] hover:bg-[#f59e0b] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:h-[14px] [&_svg]:w-[14px] [&_svg]:shrink-0";
  const btnDanger =
    "inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-neg transition-colors hover:border-[color-mix(in_srgb,var(--neg)_35%,transparent)] hover:bg-[var(--neg-soft)] hover:text-neg disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:h-[14px] [&_svg]:w-[14px] [&_svg]:shrink-0";
  const btnPrimary =
    "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgba(10,61,143,0.15)] transition hover:-translate-y-px hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--brand-blue)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-[14px] [&_svg]:w-[14px]";
  const input =
    "w-full rounded-lg border border-line bg-paper py-2 pr-3 pl-9 text-[13px] text-fg outline-none transition placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft";

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      <PageHeader
        icon={<FolderGlyph />}
        title="Enquiries"
        subtitle="Create, open and manage PCP pump-selection enquiries · expand an enquiry to work on its tags"
        actions={
          <button type="button" className={`${btnPrimary} px-4 py-2 text-[13px]`} onClick={() => setIsModalOpen(true)}>
            <PlusIcon /> New Enquiry
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            value={scope}
            onChange={(v) => {
              setScope(v);
              setPage(1);
            }}
            loading={isLoading}
            options={[
              { key: "all", label: "All enquiries" },
              { key: "mine", label: "Created by me" },
            ]}
          />
          <label className="relative w-full sm:w-[240px] xl:w-[220px]">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3">
              <SearchGlyph />
            </span>
            <input
              id="filter-client-name"
              type="search"
              aria-label="Client name"
              className={input}
              placeholder="Search by client name…"
              value={clientNameFilter}
              onChange={(e) => setClientNameFilter(e.target.value)}
            />
          </label>
          <label className="relative w-full sm:w-[210px] xl:w-[190px]">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3">
              <HashGlyph />
            </span>
            <input
              id="filter-enquiry-code"
              type="search"
              aria-label="Enquiry no."
              className={input}
              placeholder="Search by enquiry no.…"
              value={enquiryCodeFilter}
              onChange={(e) => setEnquiryCodeFilter(e.target.value)}
            />
          </label>
          <DateRangeFilter
            state={dates}
            onChange={() => setPage(1)}
            fromLabel="Created from"
            toLabel="Created to"
            showClear={false}
          />
          {hasFilter && (
            <button
              type="button"
              className="rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft"
              onClick={() => {
                setClientNameFilter("");
                setEnquiryCodeFilter("");
                dates.reset();
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
          {!isLoading && !error && (
            <span className="ml-auto text-[12.5px] text-fg-3">
              <b className="font-mono text-fg">{pageInfo.total}</b> enquir{pageInfo.total === 1 ? "y" : "ies"}
              {hasFilter ? " match" : ""}
            </span>
          )}
        </div>
      </PageHeader>

      {error && (
        <div
          className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--neg-soft)] px-4 py-3 text-[13px] font-medium text-neg [&_svg]:h-4 [&_svg]:w-4"
          role="alert"
        >
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-xl border border-line bg-paper" />
          ))}
        </div>
      )}

      {!isLoading && !error && !hasFilter && projects.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon="folder"
            title={scope === "mine" ? "You haven't created any enquiries yet" : "No enquiries yet"}
            description={
              scope === "mine"
                ? "Enquiries you create show here. Switch to All enquiries to see everyone's."
                : "Create your first enquiry to start scoping a PCP pump selection — capacity, head, media, and drive details all get saved per enquiry."
            }
            action={
              <button type="button" className={btnPrimary} onClick={() => setIsModalOpen(true)}>
                <PlusIcon /> Create your first enquiry
              </button>
            }
          />
        </div>
      )}

      {!isLoading && !error && hasFilter && filteredProjects.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon="folder"
            title="No enquiries match this filter"
            description="Try a different client name, enquiry no. or date range, or clear the filters above."
          />
        </div>
      )}

      {!isLoading && !error && filteredProjects.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-paper shadow-[0_1px_2px_rgba(10,22,40,0.04),0_8px_24px_rgba(10,22,40,0.04)]">
          <div className="overflow-x-auto">
          <div className="min-w-[940px] 2xl:min-w-[1060px]">
          <div className={`border-b border-line bg-elev px-4 py-2.5 grid grid-cols-[28px_minmax(170px,2.2fr)_minmax(90px,0.8fr)_minmax(72px,0.7fr)_minmax(110px,1fr)_minmax(86px,0.7fr)_minmax(96px,0.8fr)_186px] 2xl:grid-cols-[28px_minmax(170px,2.2fr)_minmax(90px,0.8fr)_minmax(72px,0.7fr)_minmax(110px,1fr)_minmax(86px,0.7fr)_minmax(96px,0.8fr)_370px] items-center gap-x-3 [&>*]:min-w-0`}>
            <span />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Enquiry</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Client Code</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Industry</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Created By</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Created</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Status</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Actions</span>
          </div>
          <ul className="divide-y divide-line">
            {filteredProjects.map((project) => {
              const isOpen = expanded.has(project.id);
              const tags = tagsByProject[project.id];
              const isLoadingTags = tagsLoadingFor.has(project.id);
              const tagError = tagsErrorFor[project.id];
              const doneCount = tags?.filter((t) => (t.status ?? "").toLowerCase() === "completed").length ?? 0;
              return (
                <li key={project.id} className={isOpen ? "bg-[color-mix(in_srgb,var(--accent-soft)_45%,transparent)]" : ""}>
                  {/* Enquiry row: columns on wide screens, stacked below lg */}
                  <div className={`group px-4 py-3 transition-colors hover:bg-elev grid grid-cols-[28px_minmax(170px,2.2fr)_minmax(90px,0.8fr)_minmax(72px,0.7fr)_minmax(110px,1fr)_minmax(86px,0.7fr)_minmax(96px,0.8fr)_186px] 2xl:grid-cols-[28px_minmax(170px,2.2fr)_minmax(90px,0.8fr)_minmax(72px,0.7fr)_minmax(110px,1fr)_minmax(86px,0.7fr)_minmax(96px,0.8fr)_370px] items-center gap-x-3 [&>*]:min-w-0`}>
                    <button
                        type="button"
                        onClick={() => toggleExpanded(project.id)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Hide tags" : "Show tags"}
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                          isOpen
                            ? "rotate-90 border-transparent bg-accent text-white"
                            : "border-line bg-paper text-fg-3 hover:border-accent hover:text-accent"
                        }`}
                      >
                        <ChevronIcon />
                      </button>

                    <button
                      type="button"
                      onClick={() => toggleExpanded(project.id)}
                      className="min-w-0 flex-1 text-left"
                      title={isOpen ? "Hide tags" : "Show tags"}
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono text-[12.5px] font-bold text-title">{project.project_code}</span>
                        {project.enquiry_date && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold whitespace-nowrap text-accent"
                            title="Enquiry date"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-[11px] w-[11px]">
                              <rect x="3.5" y="5" width="17" height="15" rx="2" />
                              <path d="M3.5 10h17M8 3v4M16 3v4" />
                            </svg>
                            {new Date(`${project.enquiry_date}T00:00:00`).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[13.5px] font-semibold text-fg group-hover:text-accent">
                        {project.name || "—"}
                      </span>
                    </button>

                    <span className="min-w-0">
                      {project.client_code ? (
                        <span className="inline-block max-w-full truncate rounded-md bg-elev px-1.5 py-0.5 font-mono text-[11.5px] text-fg-2">
                          {project.client_code}
                        </span>
                      ) : (
                        <span className="text-fg-4">—</span>
                      )}
                    </span>

                    <span className="min-w-0 truncate text-[12.5px] text-fg-2">{project.industry || <span className="text-fg-4">—</span>}</span>

                    <span className="flex min-w-0 items-center gap-2">
                      {project.created_by_name ? (
                        <>
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-cyan)] text-[9.5px] font-bold text-white">
                            {project.created_by_name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((p) => p[0]?.toUpperCase())
                              .join("")}
                          </span>
                          <span className="truncate text-[12.5px] text-fg-2">{project.created_by_name}</span>
                        </>
                      ) : (
                        <span className="text-fg-4">—</span>
                      )}
                    </span>

                    <span className="truncate text-[12.5px] whitespace-nowrap text-fg-2" title="Date the enquiry was created in the portal">
                      {project.created_at
                        ? new Date(project.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </span>

                    <span className="flex flex-col items-start gap-1">
                      <StatusPill status={project.status} />
                      {tags && (
                        <span className="text-[11px] text-fg-3">
                          {doneCount}/{tags.length} tag{tags.length === 1 ? "" : "s"} done
                        </span>
                      )}
                    </span>

                    <div className="flex flex-nowrap items-center justify-start gap-0.5">
                      <button
                        type="button"
                        className={btn}
                        onClick={() => openDocument(project)}
                        title="View this enquiry's Technical Data Sheet"
                      >
                        <DocumentIcon />
                        <span className="hidden 2xl:inline">Technical</span>
                      </button>
                      <button
                        type="button"
                        className={btnCommercial}
                        onClick={() => router.push(`/commercial?projectId=${project.id}`)}
                        title="Commercial Summary: P&A and BOI prices for every tag"
                        aria-label={`Commercial Summary for ${project.project_code}`}
                      >
                        <RupeeIcon />
                        <span className="hidden 2xl:inline">Commercial</span>
                      </button>
                      <button
                        type="button"
                        className={btn}
                        onClick={() => {
                          setCopyError(null);
                          setCopyingFrom({ project });
                          if (!tagsByProject[project.id]) {
                            listTags(project.id)
                              .then((rows) => setTagsByProject((m) => ({ ...m, [project.id]: rows })))
                              .catch(() => {});
                          }
                        }}
                        title="Copy a tag from this enquiry"
                        aria-label={`Copy a tag from ${project.project_code}`}
                      >
                        <CopyIcon />
                        <span className="hidden 2xl:inline">Copy</span>
                      </button>
                      <button
                        type="button"
                        className={btn}
                        onClick={() => setEditing(project)}
                        aria-label={`Edit enquiry ${project.project_code}`}
                        title="Edit enquiry"
                      >
                        <EditIcon />
                        <span className="hidden 2xl:inline">Edit</span>
                      </button>
                      <button
                        type="button"
                        className={btnDanger}
                        disabled={deletingId === project.id}
                        onClick={() => setConfirmingDelete(project)}
                        aria-label={`Delete enquiry ${project.project_code}`}
                        title="Delete enquiry"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  {/* Tags */}
                  {isOpen && (
                    <div className="pr-4 pb-4 pl-[60px]">
                      <div className="rounded-xl border border-line bg-paper">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                          <div>
                            <div className="text-[12.5px] font-semibold text-fg">Tags on this enquiry</div>
                            <div className="text-[11px] text-fg-3">
                              Each tag is its own pump-selection run · click a tag name to rename it
                            </div>
                          </div>
                          {addingTagFor !== project.id && (
                            <button type="button" className={btn} onClick={() => startAddTag(project.id)}>
                              <PlusIcon /> Add tag
                            </button>
                          )}
                        </div>

                        {isLoadingTags && (
                          <div className="space-y-2 p-3">
                            {[0, 1].map((i) => (
                              <div key={i} className="h-10 animate-pulse rounded-lg bg-elev" />
                            ))}
                          </div>
                        )}
                        {tagError && <div className="px-3.5 py-3 text-[12.5px] font-medium text-neg">{tagError}</div>}
                        {!isLoadingTags && tags && tags.length === 0 && (
                          <div className="px-3.5 py-4 text-[12.5px] text-fg-3">No tags yet — add one.</div>
                        )}

                        {!isLoadingTags && tags && tags.length > 0 && (
                          <ul className="divide-y divide-line">
                            {tags.map((tag) => {
                              const isRenaming = renamingTagId === tag.id;
                              return (
                                <li key={tag.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5 hover:bg-elev">
                                  <span
                                    className="h-8 w-1 shrink-0 rounded-full"
                                    style={{ background: lifecycleStyle(tag.status).color }}
                                    aria-hidden
                                  />
                                  <div className="min-w-[180px] flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {isRenaming ? (
                                        <input
                                          type="text"
                                          className="rounded-md border border-accent bg-paper px-2 py-1 text-[13px] text-fg outline-none ring-2 ring-accent-soft"
                                          value={renameValue}
                                          autoFocus
                                          onChange={(e) => setRenameValue(e.target.value)}
                                          onBlur={() => handleRenameTag(tag)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") handleRenameTag(tag);
                                            if (e.key === "Escape") cancelRenameTag();
                                          }}
                                        />
                                      ) : (
                                        <button
                                          type="button"
                                          className="rounded px-0.5 text-[13px] font-semibold text-fg underline decoration-dotted decoration-fg-4 underline-offset-4 hover:text-accent hover:decoration-accent"
                                          onClick={() => startRenameTag(tag)}
                                          title="Click to rename"
                                        >
                                          {tag.name}
                                        </button>
                                      )}
                                      <StatusPill status={tag.status} />
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-fg-3">
                                      <span>
                                        Liquid: <span className="text-fg-2">{tag.liquid || "—"}</span>
                                      </span>
                                      <span>
                                        Pump type: <span className="text-fg-2">{tag.pump_type || "—"}</span>
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-0.5">
                                    <button type="button" className={btnPrimary} onClick={() => openProject(project, tag)}>
                                      <OpenIcon /> Open
                                    </button>
                                    <button
                                      type="button"
                                      className={btn}
                                      onClick={() => handleCopyTagHere(tag)}
                                      disabled={copyingTagId === tag.id}
                                      title="Duplicate this tag with all its pump-selection details"
                                      aria-label={`Copy tag ${tag.name}`}
                                    >
                                      <CopyIcon />
                                      {copyingTagId === tag.id ? "Copying…" : "Copy"}
                                    </button>
                                    <button
                                      type="button"
                                      className={btnDanger}
                                      onClick={() => setConfirmingDeleteTag(tag)}
                                      disabled={deletingTagId === tag.id || (tags?.length ?? 0) <= 1}
                                      title={(tags?.length ?? 0) <= 1 ? "Can't delete the last tag on an enquiry" : "Delete tag"}
                                      aria-label={`Delete tag ${tag.name}`}
                                    >
                                      <TrashIcon />
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        {addingTagFor === project.id && (
                          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
                            <input
                              type="text"
                              className="min-w-[220px] flex-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
                              placeholder="Tag name (e.g. Pump 1, Site A)"
                              value={newTagName}
                              autoFocus
                              maxLength={100}
                              onChange={(e) => setNewTagName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleAddTag(project.id);
                                if (e.key === "Escape") cancelAddTag();
                              }}
                            />
                            <button
                              type="button"
                              className={btnPrimary}
                              onClick={() => handleAddTag(project.id)}
                              disabled={!newTagName.trim()}
                            >
                              Add
                            </button>
                            <button type="button" className={btn} onClick={cancelAddTag}>
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </div>
          </div>

          {/* Server-side: totalItems is the count across the WHOLE filtered
              table, not the length of this page. */}
          <div className="border-t border-line bg-[color-mix(in_srgb,var(--bg-elev)_45%,var(--bg-paper))]">
            <Pagination
              page={page}
              totalItems={pageInfo.total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              itemLabel="enquiries"
            />
          </div>
        </div>
      )}

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => {
          if (isCreating) return;
          // Backing out of the create form abandons a queued copy too —
          // otherwise it would silently attach to the next enquiry created.
          setPendingCopyTagId(null);
          setIsModalOpen(false);
        }}
        onCreate={handleCreateProject}
      />

      {viewingDocFor && (
        <EnquiryDocumentModal
          source={{
            projectId: viewingDocFor.id,
            projectCode: viewingDocFor.project_code,
            projectName: viewingDocFor.name,
          }}
          onClose={() => setViewingDocFor(null)}
        />
      )}

      {copyingFrom && (
        <CopyTagModal
          sourceProject={copyingFrom.project}
          tags={tagsByProject[copyingFrom.project.id] ?? []}
          initialTagId={copyingFrom.tagId}
          projects={(allProjects ?? projects).filter(
            (p) => p.id !== copyingFrom.project.id,
          )}
          busy={copyBusy}
          error={copyError}
          onCancel={() => {
            if (copyBusy) return;
            setCopyingFrom(null);
            setCopyError(null);
          }}
          onConfirm={handleCopyConfirm}
        />
      )}

      <EditProjectModal
        isOpen={editing !== null}
        project={editing}
        isSaving={isSaving}
        onClose={() => !isSaving && setEditing(null)}
        onSave={handleEditSave}
      />

      <ConfirmModal
        open={confirmingDelete !== null}
        title="Delete this enquiry?"
        description={
          confirmingDelete ? (
            <>
              <strong>
                {confirmingDelete.name || confirmingDelete.project_code}
              </strong>{" "}
              and its saved pump-selection inputs will be permanently removed. This
              can&apos;t be undone.
            </>
          ) : null
        }
        confirmLabel={deletingId ? "Deleting…" : "Delete project"}
        cancelLabel="Cancel"
        tone="danger"
        busy={deletingId !== null}
        onConfirm={handleDelete}
        onClose={() => !deletingId && setConfirmingDelete(null)}
      />

      <ConfirmModal
        open={confirmingDeleteTag !== null}
        title="Delete this tag?"
        description={
          confirmingDeleteTag ? (
            <>
              Tag <strong>{confirmingDeleteTag.name}</strong> and its saved
              wizard inputs (media, MOC, drive, motor picks) will be permanently
              removed. This can&apos;t be undone.
            </>
          ) : null
        }
        confirmLabel={deletingTagId ? "Deleting…" : "Delete tag"}
        cancelLabel="Cancel"
        tone="danger"
        busy={deletingTagId !== null}
        onConfirm={handleDeleteTag}
        onClose={() => !deletingTagId && setConfirmingDeleteTag(null)}
      />
    </div>
  );
};

// --- Inline icons (self-contained, no external asset dependency) -----------
// The chevron ships as a right-arrow; the .projects-chevron.is-open class in
// ProjectsPage.css rotates it 90 deg down when the row is expanded.
const FolderGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
const SearchGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4-4" />
  </svg>
);
const HashGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

const OpenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M9 6h10v10M19 6 6 19"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M4 20h4L20 8l-4-4L4 16v4Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path d="m14 6 4 4" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Rupee sign — the Commercial Summary.
const RupeeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4h12M6 9h12M14.5 20 7 13h2.5a4.5 4.5 0 0 0 0-9" />
  </svg>
);

// A sheet with lines — the quotation document.
const DocumentIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path
      d="M14 3v5h5M9 13h6M9 17h4"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Two offset sheets — the conventional "duplicate" glyph.
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <rect
      x="9"
      y="9"
      width="11"
      height="11"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path
      d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 8v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="16" r="1" fill="currentColor" />
  </svg>
);

export default ProjectsPage;
