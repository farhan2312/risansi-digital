"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "./ProjectsPage.css";
import CreateProjectModal from "../../components/projects/CreateProjectModal";
import CopyTagModal, { type CopyDestination } from "../../components/projects/CopyTagModal";
import EnquiryDocumentModal from "../../components/reports/EnquiryDocumentModal";
import QuotationStepModal from "../../components/projects/QuotationStepModal";
import EditProjectModal from "../../components/projects/EditProjectModal";
import AssignEnquiryModal from "../../components/projects/AssignEnquiryModal";
import EnquiryFilterBar from "../../components/projects/EnquiryFilterBar";
import AssigneeKpis from "../../components/projects/AssigneeKpis";
import { hasEnquiryFilters, type EnquiryFilters } from "../../lib/enquiry-filters";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { ASSIGNABLE_ROLES, canManageEnquiries, canWorkOn, isRepRole, orderSubtypeLabel, orderTypeLabel, worksOnAnyEnquiry } from "../../lib/roles";
import RepPicker from "../../components/projects/RepPicker";
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
  type CreateProjectInput,
  type ProjectRecord,
  type UpdateProjectInput,
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

// Enquiry row columns: chevron | enquiry no. / date | order type | client /
// code | reps / zone | industry / market | status | assigned to | actions.
// Tailwind only sees whole class strings, so each variant is written out: the
// User-Master's Actions column is wider (Edit and Delete as well).
const ROW_GRID_MANAGER =
  "grid grid-cols-[28px_minmax(140px,1fr)_minmax(64px,0.5fr)_minmax(170px,1.8fr)_minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(96px,0.8fr)_minmax(140px,1fr)_222px] 2xl:grid-cols-[28px_minmax(140px,1fr)_minmax(64px,0.5fr)_minmax(170px,1.8fr)_minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(96px,0.8fr)_minmax(140px,1fr)_478px]";
const ROW_GRID_WORKER =
  "grid grid-cols-[28px_minmax(140px,1fr)_minmax(64px,0.5fr)_minmax(170px,1.8fr)_minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(96px,0.8fr)_minmax(140px,1fr)_190px] 2xl:grid-cols-[28px_minmax(140px,1fr)_minmax(64px,0.5fr)_minmax(170px,1.8fr)_minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(96px,0.8fr)_minmax(140px,1fr)_400px]";

const ProjectsPage = () => {
  const router = useRouter();
  // User-Master / system admins create, edit, delete and (re)assign. Everyone
  // sees every enquiry, but a worker works only on the ones assigned to them;
  // copying a tag out of any enquiry is fine (lib/roles.ts).
  const { user, loading: userLoading } = useCurrentUser();
  const manager = canManageEnquiries(user?.role);
  const workable = (p: ProjectRecord) => canWorkOn(user, p);
  // Rep / Rep Manager: read-only, their own enquiries only (the API scopes the
  // list); a manager can narrow it to one rep.
  const isRep = isRepRole(user?.role);
  const [rep, setRep] = useState("");
  const [assigning, setAssigning] = useState<ProjectRecord | null>(null);
  const ROW_GRID = manager ? ROW_GRID_MANAGER : ROW_GRID_WORKER;

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
  // Quotation step (between Technical and Commercial) for one enquiry.
  const [quotationFor, setQuotationFor] = useState<ProjectRecord | null>(null);

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
  // Date filter: a quick range, or explicit From/To days (which win), on the
  // enquiry date (default) or the date the enquiry was assigned.
  const dates = useDateRange("all");
  const [dateField, setDateField] = useState<"enquiry" | "assigned">("enquiry");
  const dateWindow = dates.window;
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 1 });
  // "All enquiries" / "Assigned to me" — filtered on the server.
  const [scope, setScope] = useState<"all" | "mine">("all");
  // Reps / zone / market / industry / status (the same filters as the Dashboard).
  const [adv, setAdv] = useState<EnquiryFilters>({});
  // A worker opens on "Assigned to me" (they can still switch to All). Nothing
  // loads until the role is known - otherwise an "All" request fired first
  // could land after the "mine" one and show every enquiry under "Assigned to me".
  const scopeDefaulted = useRef(false);
  const [scopeReady, setScopeReady] = useState(false);
  useEffect(() => {
    if (scopeDefaulted.current) return;
    if (!user && userLoading) return;
    scopeDefaulted.current = true;
    // (A rep's list is already just their own; "Assigned to me" means nothing to them.)
    if (user && !worksOnAnyEnquiry(user.role) && !isRepRole(user.role)) {
      setScope("mine");
      setPage(1);
    }
    setScopeReady(true);
  }, [user, userLoading]);
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

  // Only the newest request may fill the table (a slow older one is dropped).
  const loadSeq = useRef(0);
  const loadProjects = useCallback(() => {
    if (!scopeReady) return;
    const seq = ++loadSeq.current;
    setIsLoading(true);
    setError(null);
    listProjectsPage({
      page,
      pageSize: PAGE_SIZE,
      clientName: debouncedFilters.clientName,
      enquiryCode: debouncedFilters.enquiryCode,
      from: dateWindow.from,
      to: dateWindow.to,
      dateField,
      mine: scope === "mine",
      filters: adv,
      rep,
    })
      .then((res) => {
        if (seq !== loadSeq.current) return;
        setProjects(res.items);
        setPageInfo({ total: res.total, totalPages: res.totalPages });
        // Deleting the last row on the last page can strand us past the end;
        // step back rather than showing an empty table.
        if (res.items.length === 0 && res.page > 1 && res.total > 0) {
          setPage(res.totalPages);
        }
      })
      .catch(() => seq === loadSeq.current && setError("Couldn't load enquiries."))
      .finally(() => seq === loadSeq.current && setIsLoading(false));
  }, [page, debouncedFilters, dateWindow, dateField, scope, adv, scopeReady, rep]);

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

  const handleCreateProject = async (input: CreateProjectInput): Promise<string | null> => {
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

  const handleEditSave = async (input: UpdateProjectInput) => {
    if (!editing) return;
    setIsSaving(true);
    setError(null);
    try {
      await updateProject(editing.id, input);
      setEditing(null);
      // Re-read: the status shown is rolled up on the server, the PATCH reply has the raw row.
      loadProjects();
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

  const hasFilter = clientNameFilter !== "" || enquiryCodeFilter !== "" || dates.active || hasEnquiryFilters(adv);

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
          manager ? (
            <button type="button" className={`${btnPrimary} px-4 py-2 text-[13px]`} onClick={() => setIsModalOpen(true)}>
              <PlusIcon /> New Enquiry
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2.5">
          {isRep ? (
            <RepPicker
              value={rep}
              onChange={(v) => {
                setRep(v);
                setPage(1);
              }}
            />
          ) : (
            <Segmented
              value={scope}
              onChange={(v) => {
                setScope(v);
                setPage(1);
              }}
              loading={isLoading}
              options={[
                { key: "all", label: "All enquiries" },
                { key: "mine", label: "Assigned to me" },
              ]}
            />
          )}
          <label className="relative w-full sm:w-[170px]">
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
          <label className="relative w-full sm:w-[150px]">
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
          <select
            aria-label="Date to filter on"
            value={dateField}
            onChange={(e) => {
              setDateField(e.target.value === "assigned" ? "assigned" : "enquiry");
              setPage(1);
            }}
            className="h-9 rounded-lg border border-line bg-paper px-2.5 text-[12.5px] font-semibold text-fg-2 outline-none transition hover:border-fg-3 focus:border-accent focus:ring-2 focus:ring-accent-soft"
          >
            <option value="enquiry">Enquiry date</option>
            <option value="assigned">Assigned date</option>
          </select>
          <DateRangeFilter
            state={dates}
            onChange={() => setPage(1)}
            fromLabel={dateField === "assigned" ? "Assigned from" : "Enquiry date from"}
            toLabel={dateField === "assigned" ? "Assigned to" : "Enquiry date to"}
            showClear={false}
            compact
          />
          {hasFilter && (
            <button
              type="button"
              className="rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft"
              onClick={() => {
                setClientNameFilter("");
                setEnquiryCodeFilter("");
                dates.reset();
                setAdv({});
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
        <div className="mt-2.5 border-t border-line pt-2.5">
          <EnquiryFilterBar
            value={adv}
            showClient={false}
            onChange={(next) => {
              setAdv(next);
              setPage(1);
            }}
          />
        </div>
      </PageHeader>

      {/* User-Master / system admins: who has what (one card per person);
          a worker sees their own card. */}
      {manager ? (
        <AssigneeKpis />
      ) : (
        (ASSIGNABLE_ROLES as readonly string[]).includes(user?.role ?? "") && <AssigneeKpis own />
      )}

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
            title={scope === "mine" ? "No enquiries assigned to you yet" : "No enquiries yet"}
            description={
              scope === "mine"
                ? "Enquiries assigned to you show here. Switch to All enquiries to see everyone's."
                : "Create your first enquiry to start scoping a PCP pump selection — capacity, head, media, and drive details all get saved per enquiry."
            }
            action={
              manager ? (
                <button type="button" className={btnPrimary} onClick={() => setIsModalOpen(true)}>
                  <PlusIcon /> Create your first enquiry
                </button>
              ) : undefined
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
          <div className={manager ? "min-w-[1120px] 2xl:min-w-[1360px]" : "min-w-[1080px] 2xl:min-w-[1260px]"}>
          <div className={`border-b border-line bg-elev px-4 py-2.5 ${ROW_GRID} items-center gap-x-3 [&>*]:min-w-0`}>
            <span />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Enquiry No. / Date</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Order Type</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Client / Code</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Reps / Zone</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Industry / Market</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Status</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Assigned To</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">Actions</span>
          </div>
          <ul className="divide-y divide-line">
            {filteredProjects.map((project) => {
              const isOpen = expanded.has(project.id);
              const tags = tagsByProject[project.id];
              const isLoadingTags = tagsLoadingFor.has(project.id);
              const tagError = tagsErrorFor[project.id];
              const doneCount = tags?.filter((t) => (t.status ?? "").toLowerCase() === "completed").length ?? 0;
              const reps = [project.client_primary_rep, project.client_secondary_reps].filter(Boolean).join(", ");
              return (
                <li key={project.id} className={isOpen ? "bg-[color-mix(in_srgb,var(--accent-soft)_45%,transparent)]" : ""}>
                  {/* Enquiry row: columns on wide screens, stacked below lg */}
                  <div className={`group px-4 py-3 transition-colors hover:bg-elev ${ROW_GRID} items-center gap-x-3 [&>*]:min-w-0`}>
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

                    {/* Enquiry no. over the enquiry date */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(project.id)}
                      className="min-w-0 text-left"
                      title={isOpen ? "Hide tags" : "Show tags"}
                    >
                      <span className="block truncate font-mono text-[12.5px] font-bold text-title group-hover:text-accent">{project.project_code}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11.5px] whitespace-nowrap text-fg-3" title="Enquiry date">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-[11px] w-[11px] shrink-0">
                          <rect x="3.5" y="5" width="17" height="15" rx="2" />
                          <path d="M3.5 10h17M8 3v4M16 3v4" />
                        </svg>
                        {project.enquiry_date ? new Date(`${project.enquiry_date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                      </span>
                    </button>

                    <span className="min-w-0">
                      <span
                        className={`inline-block rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${
                          project.order_type === "spare" ? "bg-[var(--warn-soft)] text-warn" : "bg-accent-soft text-accent"
                        }`}
                      >
                        {orderTypeLabel(project.order_type)}
                      </span>
                      {orderSubtypeLabel(project.order_subtype) && orderSubtypeLabel(project.order_subtype) !== orderTypeLabel(project.order_type) && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-fg-3">{orderSubtypeLabel(project.order_subtype)}</span>
                      )}
                    </span>

                    {/* Client name over the client code */}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-fg" title={project.name || undefined}>
                        {project.name || "—"}
                      </span>
                      {project.client_code ? (
                        <span className="mt-0.5 inline-block max-w-full truncate rounded-md bg-elev px-1.5 py-px font-mono text-[11px] text-fg-2">
                          {project.client_code}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-fg-4">No client code</span>
                      )}
                    </span>

                    {/* Reps (primary first, then secondary) over the zone */}
                    <span className="min-w-0">
                      <span className={`block truncate text-[12.5px] ${reps ? "text-fg-2" : "text-fg-4"}`} title={reps || undefined}>
                        {reps || "—"}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-fg-3">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[11px] w-[11px] shrink-0">
                          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
                          <circle cx="12" cy="10" r="2.3" />
                        </svg>
                        {project.client_zone || "—"}
                      </span>
                    </span>

                    {/* Industry over the market type */}
                    <span className="min-w-0">
                      <span className={`block truncate text-[12.5px] ${project.industry ? "text-fg-2" : "text-fg-4"}`} title={project.industry || undefined}>
                        {project.industry || "—"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-fg-3">{project.client_market_type || "—"}</span>
                    </span>

                    <span className="flex flex-col items-start gap-1">
                      <StatusPill status={project.status} />
                      {project.completed_on && (
                        <span className="text-[11px] text-fg-3">
                          on {new Date(`${project.completed_on}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      )}
                      {tags && (
                        <span className="text-[11px] text-fg-3">
                          {doneCount}/{tags.length} tag{tags.length === 1 ? "" : "s"} done
                        </span>
                      )}
                    </span>

                    {/* Who works it and since when; the User-Master assigns / reassigns here. */}
                    <span className="min-w-0" title={project.created_by_name ? `Created by ${project.created_by_name}` : undefined}>
                      {project.assigned_to_name ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-cyan)] text-[9.5px] font-bold text-white">
                            {project.assigned_to_name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((p) => p[0]?.toUpperCase())
                              .join("")}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-medium text-fg-2">{project.assigned_to_name}</span>
                            <span className="block truncate text-[10.5px] text-fg-4">
                              {project.assigned_at ? `Assigned ${new Date(project.assigned_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : "Assigned"}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span className="block text-[12px] text-fg-4">Not assigned</span>
                      )}
                      {manager && (
                        <button
                          type="button"
                          onClick={() => setAssigning(project)}
                          className={
                            project.assigned_to
                              ? "mt-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-accent transition hover:bg-accent-soft"
                              : "mt-1 inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11.5px] font-semibold text-white transition hover:opacity-90"
                          }
                          aria-label={`${project.assigned_to ? "Reassign" : "Assign"} enquiry ${project.project_code}`}
                        >
                          {project.assigned_to ? "Reassign" : "Assign"}
                        </button>
                      )}
                    </span>

                    <div className="flex flex-nowrap items-center justify-start gap-0.5">
                      <button
                        type="button"
                        className={`${btn} relative`}
                        onClick={() => setQuotationFor(project)}
                        disabled={!workable(project)}
                        title={
                          !workable(project)
                            ? `Assigned to ${project.assigned_to_name || "someone else"} - only they can work on it`
                            : project.quotation_count
                            ? "Quotation generated — view it or change the quotation no. (ERP)"
                            : "Generate the quotation (opens Technical and Commercial)"
                        }
                        aria-label={`Quotation for ${project.project_code}`}
                      >
                        <QuoteIcon />
                        <span className="hidden 2xl:inline">Quotation</span>
                        {!project.quotation_count && (
                          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--warn)]" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={btn}
                        onClick={() => openDocument(project)}
                        disabled={!project.quotation_count || !workable(project)}
                        title={
                          !workable(project)
                            ? `Assigned to ${project.assigned_to_name || "someone else"} - only they can work on it`
                            : project.quotation_count
                            ? "View this enquiry's Technical Data Sheet"
                            : "Generate the quotation first (Quotation button)"
                        }
                        aria-label={`Technical Data Sheet for ${project.project_code}`}
                      >
                        <DocumentIcon />
                        <span className="hidden 2xl:inline">Technical</span>
                      </button>
                      <button
                        type="button"
                        className={btnCommercial}
                        onClick={() => router.push(`/commercial?projectId=${project.id}`)}
                        disabled={!project.quotation_count || !workable(project)}
                        title={
                          !workable(project)
                            ? `Assigned to ${project.assigned_to_name || "someone else"} - only they can work on it`
                            : project.quotation_count
                            ? "Commercial Summary: P&A and BOI prices for every tag"
                            : "Generate the quotation first (Quotation button)"
                        }
                        aria-label={`Commercial Summary for ${project.project_code}`}
                      >
                        <RupeeIcon />
                        <span className="hidden 2xl:inline">Commercial</span>
                      </button>
                      {!isRep && (
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
                      )}
                      {manager && (
                        <>
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
                        </>
                      )}
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
                              {workable(project)
                                ? "Each tag is its own pump-selection run · click a tag name to rename it"
                                : `View only - assigned to ${project.assigned_to_name || "someone else"}. Copy a tag into an enquiry assigned to you.`}
                            </div>
                          </div>
                          {addingTagFor !== project.id && workable(project) && (
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
                                          onClick={() => workable(project) && startRenameTag(tag)}
                                          title={workable(project) ? "Click to rename" : undefined}
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
                                    {workable(project) && (
                                      <button type="button" className={btnPrimary} onClick={() => openProject(project, tag)}>
                                        <OpenIcon /> Open
                                      </button>
                                    )}
                                    {isRep && (
                                      <button
                                        type="button"
                                        className={btnPrimary}
                                        onClick={() => openProject(project, tag)}
                                        title="View this tag's pump selection (read-only)"
                                      >
                                        <OpenIcon /> View
                                      </button>
                                    )}
                                    {!isRep && (
                                    <button
                                      type="button"
                                      className={btn}
                                      onClick={() => {
                                        // Not yours: copy it into one of your enquiries instead.
                                        if (workable(project)) handleCopyTagHere(tag);
                                        else {
                                          setCopyError(null);
                                          setCopyingFrom({ project, tagId: tag.id });
                                        }
                                      }}
                                      disabled={copyingTagId === tag.id}
                                      title={
                                        workable(project)
                                          ? "Duplicate this tag with all its pump-selection details"
                                          : "Copy this tag into an enquiry assigned to you"
                                      }
                                      aria-label={`Copy tag ${tag.name}`}
                                    >
                                      <CopyIcon />
                                      {copyingTagId === tag.id ? "Copying…" : "Copy"}
                                    </button>
                                    )}
                                    {workable(project) && (
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
                                    )}
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

      {quotationFor && (
        <QuotationStepModal
          project={quotationFor}
          onClose={() => setQuotationFor(null)}
          onDone={(n) => {
            const id = quotationFor.id;
            setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, quotation_count: n } : p)));
          }}
          onOpenCommercial={() => router.push(`/commercial?projectId=${quotationFor.id}`)}
        />
      )}

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
            (p) => p.id !== copyingFrom.project.id && workable(p),
          )}
          allowSame={workable(copyingFrom.project)}
          busy={copyBusy}
          error={copyError}
          allowNew={manager}
          onCancel={() => {
            if (copyBusy) return;
            setCopyingFrom(null);
            setCopyError(null);
          }}
          onConfirm={handleCopyConfirm}
        />
      )}

      <AssignEnquiryModal
        project={assigning}
        onClose={() => setAssigning(null)}
        onAssigned={(id, assignedTo, assignedToName) => {
          setAssigning(null);
          setProjects((prev) =>
            prev.map((p) => (p.id === id ? { ...p, assigned_to: assignedTo, assigned_to_name: assignedToName, assigned_at: new Date().toISOString() } : p)),
          );
          // "Assigned to me" no longer holds it once it went to someone else.
          if (scope === "mine") loadProjects();
        }}
      />

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

// A tag with a tick — the Quotation step.
const QuoteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
    <path d="m8.5 11.5 2 2 4-4" />
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
