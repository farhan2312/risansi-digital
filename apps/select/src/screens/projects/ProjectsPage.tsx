"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CreateProjectModal from "../../components/projects/CreateProjectModal";
import CopyTagModal, { type CopyDestination } from "../../components/projects/CopyTagModal";
import CopySpareModal from "../../components/projects/CopySpareModal";
import EnquiryDocumentModal from "../../components/reports/EnquiryDocumentModal";
import QuotationStepModal from "../../components/projects/QuotationStepModal";
import EditProjectModal from "../../components/projects/EditProjectModal";
import AssignEnquiryModal from "../../components/projects/AssignEnquiryModal";
import ClearanceModal from "../../components/projects/ClearanceModal";
import { holdReasonText } from "../../lib/clearance";
import EnquiryVersionsModal from "../../components/projects/EnquiryVersionsModal";
import EnquiryFilterBar from "../../components/projects/EnquiryFilterBar";
import AssigneeKpis from "../../components/projects/AssigneeKpis";
import EnquiryReportPanel from "../../components/projects/EnquiryReportPanel";
import { hasEnquiryFilters, type EnquiryFilters, type EnquirySort, type EnquirySortKey } from "../../lib/enquiry-filters";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { ASSIGNABLE_ROLES, canManageEnquiries, canWorkOn, isRepRole, isViewOnlyRole, orderSubtypeLabel, orderTypeLabel, worksOnAnyEnquiry } from "../../lib/roles";
import RepPicker from "../../components/projects/RepPicker";
import EmptyState from "../../components/ui/EmptyState";
import EnquiryReviewModal from "../../components/projects/EnquiryReviewModal";
import Pagination from "../../components/ui/Pagination";
import { lifecycleStyle } from "../../components/ui/StatusPill";
import DateRangeFilter, { useDateRange } from "../../components/ui/DateRangeFilter";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  FileText,
  Hash,
  IndianRupee,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Search,
  Send,
  Tag,
  TicketCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
// shadcn/ui (user, 2026-11-13: a more professional look, on branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Input, NativeSelect } from "@/components/shadcn/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import { ConfirmDialog } from "@/components/shadcn/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
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
import { copySpareQuote } from "../../services/spareQuoteService";
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
// code | reps / zone | industry / market | statuses | clearance | assigned to | actions.
// The table fits the page with no sideways scroll: from xl (1280px, less the 240px
// sidebar) the columns share the width and the actions sit in two rows of three,
// icons only until 2xl; below xl each enquiry stacks as a card.
const ROW_COLS =
  "grid-cols-2 gap-y-2 xl:grid-cols-[28px_minmax(110px,1fr)_minmax(52px,0.45fr)_minmax(120px,1.4fr)_minmax(90px,0.9fr)_minmax(78px,0.7fr)_minmax(140px,1fr)_minmax(78px,0.6fr)_minmax(110px,0.8fr)_128px] xl:gap-y-0 2xl:grid-cols-[28px_minmax(110px,1fr)_minmax(52px,0.45fr)_minmax(120px,1.4fr)_minmax(90px,0.9fr)_minmax(78px,0.7fr)_minmax(140px,1fr)_minmax(78px,0.6fr)_minmax(110px,0.8fr)_318px]";

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
  // Reps and CRM: view only (no review, copy or commercial versions; tags open as View).
  const viewOnly = isViewOnlyRole(user?.role);
  const [rep, setRep] = useState("");
  const [assigning, setAssigning] = useState<ProjectRecord | null>(null);
  // The clearance pop-up: Clear or Hold, and its history.
  const [clearanceFor, setClearanceFor] = useState<ProjectRecord | null>(null);
  // The pop-up listing an enquiry's versions.
  const [versionsFor, setVersionsFor] = useState<ProjectRecord | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<ProjectRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The Edit Enquiry form's last save error.
  const [editError, setEditError] = useState<string | null>(null);

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
  // Copying a spare's models and parts. `pendingSpareCopy` survives the hand-off to
  // the Create Enquiry form, like pendingCopyTagId.
  const [copyingSpare, setCopyingSpare] = useState<ProjectRecord | null>(null);
  const [pendingSpareCopy, setPendingSpareCopy] = useState<ProjectRecord | null>(null);
  const [spareCopied, setSpareCopied] = useState<string | null>(null);
  // The copy dialog offers EVERY enquiry as a destination, not just the page
  // on screen, so it loads the full list on open rather than reusing the
  // paged one. Cached for the life of the page after the first open.
  const [allProjects, setAllProjects] = useState<ProjectRecord[] | null>(null);
  // Technical Quotation for a whole enquiry - the same document the Reports
  // page shows, reachable from here too.
  const [viewingDocFor, setViewingDocFor] = useState<ProjectRecord | null>(null);
  const [reviewFor, setReviewFor] = useState<ProjectRecord | null>(null);
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
  // Column sorts, several at once, in the order they were clicked. A click adds a column
  // (dates newest first, names A to Z), the next reverses it, the next takes it off.
  const [sort, setSort] = useState<EnquirySort>([]);
  const toggleSort = (key: EnquirySortKey) => {
    const first = key === "date" ? "desc" : "asc";
    setSort((cur) => {
      const at = cur.find((s) => s.key === key);
      if (!at) return [...cur, { key, dir: first }];
      if (at.dir === first) return cur.map((s) => (s.key === key ? { key, dir: first === "asc" ? "desc" : "asc" } : s));
      return cur.filter((s) => s.key !== key);
    });
    setPage(1);
  };
  const sortHead = (key: EnquirySortKey, label: string) => {
    const i = sort.findIndex((s) => s.key === key);
    const on = i >= 0 ? sort[i] : null;
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        title={on ? `Sorted ${on.dir === "asc" ? (key === "date" ? "oldest first" : "A to Z") : key === "date" ? "newest first" : "Z to A"} - click to ${on.dir === (key === "date" ? "desc" : "asc") ? "reverse" : "remove"}` : `Sort by ${label}`}
        className={`inline-flex items-center gap-1 text-left text-[11px] font-medium tracking-wide uppercase hover:text-foreground ${on ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
        {on ? on.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-50" />}
        {on && sort.length > 1 && <span className="rounded-full bg-primary px-1 text-[9.5px] leading-[14px] tracking-normal text-primary-foreground">{i + 1}</span>}
      </button>
    );
  };
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
    if (user && !worksOnAnyEnquiry(user.role) && !isViewOnlyRole(user.role)) {
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
      sort,
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
  }, [page, debouncedFilters, dateWindow, dateField, scope, adv, scopeReady, rep, sort]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Copy dialog's destination list: every enquiry, fetched once on first open.
  // Falls back to the current page if the fetch fails, which is still usable.
  useEffect(() => {
    if ((!copyingFrom && !copyingSpare) || allProjects !== null) return;
    let cancelled = false;
    listProjects()
      .then((rows) => {
        if (!cancelled) setAllProjects(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [copyingFrom, copyingSpare, allProjects]);

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
      if (pendingSpareCopy) {
        const source = pendingSpareCopy;
        setPendingSpareCopy(null);
        await copySpareQuote(source.id, created.id)
          .then(() => setSpareCopied(`Copied the models and parts into ${created.project_code}.`))
          .catch((err) =>
            setError(
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "The enquiry was created, but its models and parts weren't copied.",
            ),
          );
      }
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

  const handleCopySpare = async (target: string | "new") => {
    const source = copyingSpare;
    if (!source) return;
    if (target === "new") {
      setPendingSpareCopy(source);
      setCopyingSpare(null);
      setIsModalOpen(true);
      return;
    }
    setCopyBusy(true);
    setCopyError(null);
    try {
      await copySpareQuote(source.id, target);
      const to = (allProjects ?? projects).find((p) => p.id === target);
      setSpareCopied(`Copied the models and parts into ${to?.project_code ?? "the enquiry"}.`);
      setCopyingSpare(null);
    } catch (err) {
      setCopyError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't copy.");
    } finally {
      setCopyBusy(false);
    }
  };

  const handleEditSave = async (input: UpdateProjectInput) => {
    if (!editing) return;
    setIsSaving(true);
    setEditError(null);
    try {
      await updateProject(editing.id, input);
      // Marking it Completed completes its tags.
      if (tagsByProject[editing.id]) refreshTags(editing.id);
      setEditing(null);
      // Re-read: the status shown is rolled up on the server, the PATCH reply has the raw row.
      loadProjects();
    } catch (err) {
      // Shown on the form, which stays open (e.g. the enquiry no. is already taken).
      setEditError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't save the enquiry changes. Please try again.");
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

  // Assigned to someone else: what every disabled action says.
  const notYours = (p: ProjectRecord, what = "work on it") => `Assigned to ${p.assigned_to_name || "someone else"} - only they can ${what}`;
  const headCls = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

  return (
    <div className="min-h-full bg-background">
    <div className="mx-auto max-w-[1600px] px-4 pt-6 pb-10 sm:px-6">
      {/* Page heading */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Pump Selection</div>
          <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight text-foreground">Enquiries</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Create, open and manage pump-selection enquiries. Expand an enquiry to work on its tags.</p>
        </div>
        {manager && (
          <Button size="lg" onClick={() => setIsModalOpen(true)}>
            <Plus /> New Enquiry
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {isRep ? (
            <RepPicker
              value={rep}
              onChange={(v) => {
                setRep(v);
                setPage(1);
              }}
            />
          ) : (
            <Tabs
              value={scope}
              onValueChange={(v) => {
                setScope(v === "mine" ? "mine" : "all");
                setPage(1);
              }}
            >
              <TabsList aria-label="Which enquiries">
                <TabsTrigger value="all">All enquiries</TabsTrigger>
                <TabsTrigger value="mine">Assigned to me</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="w-full sm:w-[200px]">
            <Input
              id="filter-client-name"
              type="search"
              aria-label="Client name"
              icon={<Search />}
              placeholder="Client name"
              value={clientNameFilter}
              onChange={(e) => setClientNameFilter(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-[170px]">
            <Input
              id="filter-enquiry-code"
              type="search"
              aria-label="Enquiry no."
              icon={<Hash />}
              placeholder="Enquiry no."
              value={enquiryCodeFilter}
              onChange={(e) => setEnquiryCodeFilter(e.target.value)}
            />
          </div>
          <NativeSelect
            aria-label="Date to filter on"
            value={dateField}
            onChange={(e) => {
              setDateField(e.target.value === "assigned" ? "assigned" : "enquiry");
              setPage(1);
            }}
          >
            <option value="enquiry">Enquiry date</option>
            <option value="assigned">Assigned date</option>
          </NativeSelect>
          <DateRangeFilter
            state={dates}
            onChange={() => setPage(1)}
            fromLabel={dateField === "assigned" ? "Assigned from" : "Enquiry date from"}
            toLabel={dateField === "assigned" ? "Assigned to" : "Enquiry date to"}
            showClear={false}
            compact
          />
          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setClientNameFilter("");
                setEnquiryCodeFilter("");
                dates.reset();
                setAdv({});
                setPage(1);
              }}
            >
              <X /> Clear filters
            </Button>
          )}
          {!isLoading && !error && (
            <span className="ml-auto text-[12.5px] text-muted-foreground">
              <b className="font-mono font-semibold text-foreground tabular-nums">{pageInfo.total}</b> enquir{pageInfo.total === 1 ? "y" : "ies"}
              {hasFilter ? " match" : ""}
            </span>
          )}
        </div>
        <div className="border-t border-border bg-muted/40 px-4 py-2.5">
          <EnquiryFilterBar
            value={adv}
            showClient={false}
            onChange={(next) => {
              setAdv(next);
              setPage(1);
            }}
          />
        </div>
      </Card>

      {/* User-Master / system admins: who has what (one card per person);
          a worker sees their own card. */}
      {manager ? (
        <AssigneeKpis />
      ) : (
        (ASSIGNABLE_ROLES as readonly string[]).includes(user?.role ?? "") && <AssigneeKpis own />
      )}

      {manager && (
        <EnquiryReportPanel
          stamp={projects}
          scope={scope === "mine" ? "Assigned to me" : hasFilter ? "As filtered" : "All enquiries"}
          query={{
            clientName: debouncedFilters.clientName,
            enquiryCode: debouncedFilters.enquiryCode,
            from: dateWindow.from,
            to: dateWindow.to,
            dateField,
            mine: scope === "mine",
            filters: adv,
            rep,
            sort,
          }}
        />
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/8 px-4 py-2.5 text-[13px] font-medium text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {spareCopied && (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-success/25 bg-success/8 px-4 py-2.5 text-[13px] font-medium text-success" role="status">
          <CircleCheck className="size-4 shrink-0" />
          {spareCopied}
        </p>
      )}

      {isLoading && (
        <Card className="mt-4 divide-y divide-border overflow-hidden">
          <div className="h-10 bg-muted/60" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <div className="h-3 w-28 animate-pulse rounded bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </Card>
      )}

      {!isLoading && !error && !hasFilter && projects.length === 0 && (
        <Card className="mt-4">
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
                <Button onClick={() => setIsModalOpen(true)}>
                  <Plus /> Create your first enquiry
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {!isLoading && !error && hasFilter && filteredProjects.length === 0 && (
        <Card className="mt-4">
          <EmptyState icon="folder" title="No enquiries match this filter" description="Try a different client name, enquiry no. or date range, or clear the filters above." />
        </Card>
      )}

      {!isLoading && !error && filteredProjects.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          {/* Column headings (wide screens; below xl each enquiry stacks as a card) */}
          <div className={`hidden border-b border-border bg-muted/60 px-4 py-2 xl:grid ${ROW_COLS} items-center gap-x-3 [&>*]:min-w-0`}>
            <span />
            <span>{sortHead("date", "Enquiry No. / Date")}</span>
            <span className={headCls}>Type</span>
            <span>{sortHead("client", "Client / Code")}</span>
            <span>{sortHead("rep", "Reps / Zone")}</span>
            <span className={headCls}>Industry / Market</span>
            <span className={headCls}>Status</span>
            <span className={headCls}>Clearance</span>
            <span>{sortHead("assignee", "Assigned To")}</span>
            <span className={`flex items-center justify-end gap-2 ${headCls}`}>
              {sort.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSort([]);
                    setPage(1);
                  }}
                  className="rounded px-1 tracking-normal text-primary normal-case hover:bg-primary/8"
                >
                  Clear sort
                </button>
              )}
              Actions
            </span>
          </div>
          <ul className="divide-y divide-border">
            {filteredProjects.map((project) => {
              const isOpen = expanded.has(project.id);
              const tags = tagsByProject[project.id];
              const isLoadingTags = tagsLoadingFor.has(project.id);
              const tagError = tagsErrorFor[project.id];
              const doneCount = tags?.filter((t) => (t.status ?? "").toLowerCase() === "completed").length ?? 0;
              const reps = [project.client_primary_rep, project.client_secondary_reps].filter(Boolean).join(", ");
              // A spare has no tags or technical step: only its Commercial page.
              const isSpare = project.order_type === "spare";
              const canWork = workable(project);
              const subtype = orderSubtypeLabel(project.order_subtype);
              const hold = project.clearance?.status === "Hold";
              // Review, copy, edit and delete live in the row's menu.
              const showReview = !viewOnly;
              const showCopy = !viewOnly;
              const hasMenu = showReview || showCopy || manager;
              return (
                <li key={project.id} className={isOpen ? "bg-primary/[0.025]" : ""}>
                  <div className={`group grid px-4 py-3 transition-colors hover:bg-muted/50 ${ROW_COLS} items-center gap-x-3 [&>*]:min-w-0`}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => toggleExpanded(project.id)}
                      disabled={isSpare}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? "Hide tags" : "Show tags"}
                      className={`${isSpare ? "invisible" : ""} ${isOpen ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
                    >
                      <ChevronRight className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </Button>

                    {/* Enquiry no. over the enquiry date */}
                    <span className="min-w-0">
                      <button
                        type="button"
                        onClick={() => !isSpare && toggleExpanded(project.id)}
                        className="block w-full min-w-0 text-left"
                        title={isSpare ? undefined : isOpen ? "Hide tags" : "Show tags"}
                      >
                        <span className="block font-mono text-[12.5px] font-semibold [overflow-wrap:anywhere] text-primary group-hover:underline group-hover:underline-offset-2">{project.project_code}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[11.5px] whitespace-nowrap text-muted-foreground" title={project.version_no > 0 ? "Revised enquiry date" : "Enquiry date"}>
                          <CalendarDays className="size-3 shrink-0" />
                          {project.enquiry_date ? shortDay(`${project.enquiry_date}T00:00:00`) : "—"}
                        </span>
                      </button>
                      {project.version_no > 0 && (
                        <button
                          type="button"
                          onClick={() => setVersionsFor(project)}
                          className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
                          aria-label={`Versions of enquiry ${project.project_code}`}
                        >
                          <Layers className="size-3" /> Versions
                        </button>
                      )}
                    </span>

                    <span className="min-w-0">
                      <Badge tone={isSpare ? "warning" : "primary"}>{orderTypeLabel(project.order_type)}</Badge>
                      {subtype && subtype !== orderTypeLabel(project.order_type) && <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">{subtype}</span>}
                    </span>

                    {/* Client name over the client code */}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground" title={project.name || undefined}>
                        {project.name || "—"}
                      </span>
                      {project.client_code ? (
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{project.client_code}</span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground/70 italic">No client code</span>
                      )}
                    </span>

                    {/* Reps (primary first, then secondary) over the zone */}
                    <span className="min-w-0">
                      <span className={`block truncate text-[12.5px] ${reps ? "text-foreground" : "text-muted-foreground"}`} title={reps || undefined}>
                        {reps || "—"}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        {project.client_zone || "—"}
                      </span>
                    </span>

                    {/* Industry over the market type */}
                    <span className="min-w-0">
                      <span className={`block truncate text-[12.5px] ${project.industry ? "text-foreground" : "text-muted-foreground"}`} title={project.industry || undefined}>
                        {project.industry || "—"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{project.client_market_type || "—"}</span>
                    </span>

                    <span className="flex flex-col items-start gap-1">
                      {!isSpare && <StatusLine label={`Technical V${project.version_no}`} status={project.status} on={project.completed_on} edited={project.technical_status_override !== null} />}
                      <StatusLine label={isSpare ? `V${project.commercial_version_no}` : `Commercial V${project.commercial_version_no}`} status={project.commercial_status} on={project.commercial_completed_on} edited={project.commercial_status_override !== null} />
                      {tags && (
                        <span className="text-[11px] text-muted-foreground">
                          {doneCount}/{tags.length} tag{tags.length === 1 ? "" : "s"} done
                        </span>
                      )}
                      {project.released_to_operation_at ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                          <Send className="size-3" /> Sent to operation {shortDay(project.released_to_operation_at)}
                        </span>
                      ) : (
                        project.reviewed_at && (
                          <>
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                              <CircleCheck className="size-3" /> Reviewed {shortDay(project.reviewed_at)}
                            </span>
                            {canWork && (
                              <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => setReviewFor(project)} title="Opens the reviewed versions, to send them to operation">
                                Send to operation
                              </Button>
                            )}
                          </>
                        )
                      )}
                    </span>

                    <span className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setClearanceFor(project)}
                        className="flex max-w-full flex-col items-start gap-1 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
                        title={project.clearance?.remarks || "Clear or Hold, and its history"}
                        aria-label={`Clearance of enquiry ${project.project_code}`}
                      >
                        {/* Clear until someone holds it. */}
                        <Badge tone={hold ? "warning" : "success"} dot className="cursor-pointer hover:brightness-95">
                          {project.clearance?.status ?? "Clear"}
                        </Badge>
                        {hold && <span className="line-clamp-2 text-[11px] text-muted-foreground">{holdReasonText(project.clearance!.group, project.clearance!.reason)}</span>}
                      </button>
                    </span>

                    {/* Who works it and since when; the User-Master assigns / reassigns here. */}
                    <span className="min-w-0" title={project.created_by_name ? `Created by ${project.created_by_name}` : undefined}>
                      {project.assigned_to_name ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary ring-1 ring-primary/15">
                            {project.assigned_to_name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((p) => p[0]?.toUpperCase())
                              .join("")}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-medium text-foreground">{project.assigned_to_name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{project.assigned_at ? `Assigned ${shortDay(project.assigned_at)}` : "Assigned"}</span>
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <UserRound className="size-3.5" /> Not assigned
                        </span>
                      )}
                      {manager && (
                        <Button
                          variant={project.assigned_to ? "link" : "outline"}
                          size="sm"
                          onClick={() => setAssigning(project)}
                          className={project.assigned_to ? "mt-0.5 h-6 px-0 text-[11.5px]" : "mt-1 h-6 px-2 text-[11.5px]"}
                          aria-label={`${project.assigned_to ? "Reassign" : "Assign"} enquiry ${project.project_code}`}
                        >
                          {project.assigned_to ? "Reassign" : "Assign"}
                        </Button>
                      )}
                    </span>

                    {/* Actions: the three steps, then a menu for the rest */}
                    <div className="col-span-2 flex flex-wrap items-center justify-start gap-1 xl:col-span-1 xl:flex-nowrap xl:justify-end">
                      {!isSpare && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="relative max-2xl:w-7 max-2xl:px-0"
                            onClick={() => setQuotationFor(project)}
                            disabled={!canWork}
                            title={
                              !canWork
                                ? notYours(project)
                                : project.quotation_count
                                  ? "Quotation generated — view it or change the quotation no. (ERP)"
                                  : "Generate the quotation (opens Technical and Commercial)"
                            }
                            aria-label={`Quotation for ${project.project_code}`}
                          >
                            <TicketCheck />
                            <span className="hidden 2xl:inline">Quotation</span>
                            {!project.quotation_count && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-card" aria-hidden="true" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="max-2xl:w-7 max-2xl:px-0"
                            onClick={() => openDocument(project)}
                            disabled={!project.quotation_count || !canWork}
                            title={
                              !canWork
                                ? notYours(project)
                                : project.quotation_count
                                  ? "View this enquiry's Technical Data Sheet"
                                  : "Generate the quotation first (Quotation button)"
                            }
                            aria-label={`Technical Data Sheet for ${project.project_code}`}
                          >
                            <FileText />
                            <span className="hidden 2xl:inline">Technical</span>
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-warning/40 bg-warning/10 text-warning hover:border-warning/60 hover:bg-warning/15 max-2xl:w-7 max-2xl:px-0"
                        onClick={() => router.push(`/commercial?projectId=${project.id}`)}
                        disabled={(!isSpare && !project.quotation_count) || !canWork}
                        title={
                          !canWork
                            ? notYours(project)
                            : isSpare
                              ? "Spare quotation: reference PO, models and parts"
                              : project.quotation_count
                                ? "Commercial Summary: P&A and BOI prices for every tag"
                                : "Generate the quotation first (Quotation button)"
                        }
                        aria-label={`${isSpare ? "Quotation" : "Commercial Summary"} for ${project.project_code}`}
                      >
                        <IndianRupee />
                        <span className="hidden 2xl:inline">{isSpare ? "Quotation" : "Commercial"}</span>
                      </Button>
                      {hasMenu && (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${project.project_code}`} title="More actions">
                              <Ellipsis />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{project.project_code}</DropdownMenuLabel>
                            {showReview && (
                              <DropdownMenuItem disabled={!canWork} onSelect={() => setReviewFor(project)} title={!canWork ? notYours(project, "review it") : undefined}>
                                <ClipboardCheck /> {isSpare ? "Review quotation" : "Review documents"}
                              </DropdownMenuItem>
                            )}
                            {showCopy && isSpare && (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setCopyError(null);
                                  setSpareCopied(null);
                                  setCopyingSpare(project);
                                }}
                              >
                                <Copy /> Copy models and parts
                              </DropdownMenuItem>
                            )}
                            {showCopy && !isSpare && (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setCopyError(null);
                                  setCopyingFrom({ project });
                                  if (!tagsByProject[project.id]) {
                                    listTags(project.id)
                                      .then((rows) => setTagsByProject((m) => ({ ...m, [project.id]: rows })))
                                      .catch(() => {});
                                  }
                                }}
                              >
                                <Copy /> Copy a tag
                              </DropdownMenuItem>
                            )}
                            {manager && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setEditError(null);
                                    setEditing(project);
                                  }}
                                >
                                  <Pencil /> Edit enquiry
                                </DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" disabled={deletingId === project.id} onSelect={() => setConfirmingDelete(project)}>
                                  <Trash2 /> Delete enquiry
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* Tags */}
                  {isOpen && !isSpare && (
                    <div className="pr-4 pb-4 pl-4 xl:pl-[56px]">
                      <div className="overflow-hidden rounded-md border border-border bg-card">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3.5 py-2">
                          <div>
                            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                              <Tag className="size-3.5 text-muted-foreground" /> Tags on this enquiry
                            </div>
                            <div className="text-[11.5px] text-muted-foreground">
                              {canWork
                                ? "Each tag is its own pump-selection run · click a tag name to rename it"
                                : `View only - assigned to ${project.assigned_to_name || "someone else"}. Copy a tag into an enquiry assigned to you.`}
                            </div>
                          </div>
                          {addingTagFor !== project.id && canWork && (
                            <Button variant="outline" size="sm" onClick={() => startAddTag(project.id)}>
                              <Plus /> Add tag
                            </Button>
                          )}
                        </div>

                        {isLoadingTags && (
                          <div className="space-y-2 p-3">
                            {[0, 1].map((i) => (
                              <div key={i} className="h-9 animate-pulse rounded bg-muted" />
                            ))}
                          </div>
                        )}
                        {tagError && <div className="px-3.5 py-3 text-[12.5px] font-medium text-destructive">{tagError}</div>}
                        {!isLoadingTags && tags && tags.length === 0 && <div className="px-3.5 py-4 text-[12.5px] text-muted-foreground">No tags yet — add one.</div>}

                        {!isLoadingTags && tags && tags.length > 0 && (
                          <ul className="divide-y divide-border">
                            {tags.map((tag) => {
                              const isRenaming = renamingTagId === tag.id;
                              return (
                                <li key={tag.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5 hover:bg-muted/40">
                                  <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: lifecycleStyle(tag.status).color }} aria-hidden />
                                  <div className="min-w-[180px] flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {isRenaming ? (
                                        <Input
                                          className="h-7 w-auto min-w-[200px]"
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
                                          className="rounded px-0.5 text-[13px] font-medium text-foreground decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:text-primary hover:underline"
                                          onClick={() => canWork && startRenameTag(tag)}
                                          title={canWork ? "Click to rename" : undefined}
                                        >
                                          {tag.name}
                                        </button>
                                      )}
                                      <StatusBadge status={tag.status} />
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap gap-x-4 text-[11.5px] text-muted-foreground">
                                      <span>
                                        Liquid <span className="text-foreground">{tag.liquid || "—"}</span>
                                      </span>
                                      <span>
                                        Pump type <span className="text-foreground">{tag.pump_type || "—"}</span>
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {canWork && (
                                      <Button size="sm" onClick={() => openProject(project, tag)}>
                                        <ExternalLink /> Open
                                      </Button>
                                    )}
                                    {viewOnly && (
                                      <Button size="sm" onClick={() => openProject(project, tag)} title="View this tag's pump selection (read-only)">
                                        <Eye /> View
                                      </Button>
                                    )}
                                    {!viewOnly && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          // Not yours: copy it into one of your enquiries instead.
                                          if (canWork) handleCopyTagHere(tag);
                                          else {
                                            setCopyError(null);
                                            setCopyingFrom({ project, tagId: tag.id });
                                          }
                                        }}
                                        disabled={copyingTagId === tag.id}
                                        title={canWork ? "Duplicate this tag with all its pump-selection details" : "Copy this tag into an enquiry assigned to you"}
                                        aria-label={`Copy tag ${tag.name}`}
                                      >
                                        <Copy />
                                        {copyingTagId === tag.id ? "Copying…" : "Copy"}
                                      </Button>
                                    )}
                                    {canWork && (
                                      <Button
                                        variant="ghost-destructive"
                                        size="icon-sm"
                                        onClick={() => setConfirmingDeleteTag(tag)}
                                        disabled={deletingTagId === tag.id || (tags?.length ?? 0) <= 1}
                                        title={(tags?.length ?? 0) <= 1 ? "Can't delete the last tag on an enquiry" : "Delete tag"}
                                        aria-label={`Delete tag ${tag.name}`}
                                      >
                                        <Trash2 />
                                      </Button>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        {addingTagFor === project.id && (
                          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2.5">
                            <div className="min-w-[220px] flex-1">
                              <Input
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
                            </div>
                            <Button onClick={() => handleAddTag(project.id)} disabled={!newTagName.trim()}>
                              Add
                            </Button>
                            <Button variant="outline" onClick={cancelAddTag}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Server-side: totalItems is the count across the WHOLE filtered
              table, not the length of this page. */}
          <div className="border-t border-border bg-muted/40">
            <Pagination page={page} totalItems={pageInfo.total} pageSize={PAGE_SIZE} onPageChange={setPage} itemLabel="enquiries" />
          </div>
        </Card>
      )}

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => {
          if (isCreating) return;
          // Backing out of the create form abandons a queued copy too —
          // otherwise it would silently attach to the next enquiry created.
          setPendingCopyTagId(null);
          setPendingSpareCopy(null);
          setIsModalOpen(false);
        }}
        onCreate={handleCreateProject}
        startAsSpare={pendingSpareCopy !== null}
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

      {reviewFor && (
        <EnquiryReviewModal
          project={reviewFor}
          onChanged={(patch) => {
            setProjects((prev) => prev.map((p) => (p.id === reviewFor.id ? { ...p, ...patch } : p)));
            setReviewFor((p) => (p ? { ...p, ...patch } : p));
          }}
          onClose={() => setReviewFor(null)}
        />
      )}

      {viewingDocFor && (
        <EnquiryDocumentModal
          source={{
            projectId: viewingDocFor.id,
            projectCode: viewingDocFor.project_code,
            projectName: viewingDocFor.name,
          }}
          readOnly={!viewingDocFor.is_latest}
          onClose={() => setViewingDocFor(null)}
        />
      )}

      {copyingFrom && (
        <CopyTagModal
          sourceProject={copyingFrom.project}
          tags={tagsByProject[copyingFrom.project.id] ?? []}
          initialTagId={copyingFrom.tagId}
          projects={(allProjects ?? projects).filter(
            (p) => p.id !== copyingFrom.project.id && workable(p) && p.order_type !== "spare",
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

      {clearanceFor && (
        <ClearanceModal
          project={clearanceFor}
          canEdit={workable(clearanceFor)}
          onClose={() => setClearanceFor(null)}
          onSaved={(now) => {
            const id = clearanceFor.id;
            setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, clearance: now } : p)));
            setClearanceFor((p) => (p ? { ...p, clearance: now } : p));
          }}
        />
      )}

      {versionsFor && (
        <EnquiryVersionsModal
          project={versionsFor}
          showCommercial={!viewOnly}
          onClose={() => setVersionsFor(null)}
          onOpenTag={openProject}
          onOpenTechnical={(v) => {
            setVersionsFor(null);
            setViewingDocFor(v);
          }}
        />
      )}

      {copyingSpare && (
        <CopySpareModal
          source={copyingSpare}
          targets={(allProjects ?? projects).filter((p) => p.id !== copyingSpare.id && p.order_type === "spare" && workable(p))}
          allowNew={manager}
          busy={copyBusy}
          error={copyError}
          onCancel={() => {
            setCopyingSpare(null);
            setCopyError(null);
          }}
          onConfirm={(target) => void handleCopySpare(target)}
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
        saveError={editError}
        onSave={handleEditSave}
        onVersionCreated={() => {
          setEditing(null);
          // The copy dialog's list held the version that is now view only.
          setAllProjects(null);
          // The new version is the newest enquiry: top of page 1.
          if (page === 1) loadProjects();
          else setPage(1);
        }}
      />

      <ConfirmDialog
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
              {confirmingDelete.version_no > 0 && (
                <> Only V{confirmingDelete.version_no} is deleted; V{confirmingDelete.version_no - 1} becomes the latest version again.</>
              )}
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

      <ConfirmDialog
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
    </div>
  );
};

/** A status as a soft badge, coloured by what it means. */
const STATUS_TONE: Record<string, "warning" | "info" | "success" | "neutral" | "danger" | "primary"> = {
  pending: "warning",
  "in progress": "info",
  completed: "success",
  "not quoted": "neutral",
  regret: "danger",
  "sent to client": "primary",
};
const StatusBadge = ({ status }: { status: string | null | undefined }) => (
  <Badge tone={STATUS_TONE[(status ?? "").trim().toLowerCase()] ?? "neutral"} dot>
    {status || "—"}
  </Badge>
);

/** One of the enquiry's statuses with its version and completion date. A spare has
 *  just the one status, so its label is only the version. */
const StatusLine = ({ label, status, on, edited }: { label: string; status: string | null | undefined; on: string | null; edited: boolean }) => (
  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5" title={`${label}: ${edited ? "status changed on the Edit form" : "status updates by itself"}`}>
    <span className={`${label.includes(" ") ? "w-[82px]" : ""} shrink-0 text-[11px] text-muted-foreground`}>{label}</span>
    <StatusBadge status={status} />
    {on && <span className={`${label.includes(" ") ? "pl-[88px]" : "w-full"} text-[11px] text-muted-foreground`}>on {shortDay(`${on}T00:00:00`)}</span>}
  </span>
);

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default ProjectsPage;
