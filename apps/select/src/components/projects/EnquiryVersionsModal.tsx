"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Eye, FileText, IndianRupee, Tag, UserRound } from "lucide-react";

import { Badge } from "@/components/shadcn/badge";
import { Button, buttonVariants } from "@/components/shadcn/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Alert } from "@/components/shadcn/field";
import { listEnquiryVersions, type ProjectRecord } from "../../services/projectService";
import { listTags, type TagRecord } from "../../services/tagsService";

const fmtDay = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** A status as a soft badge, coloured by what it means (as on the Enquiries list). */
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

/** Every version of an enquiry, newest first. The older ones open view only;
 *  the latest is worked on from the Enquiries list. */
export default function EnquiryVersionsModal({
  project,
  showCommercial,
  onClose,
  onOpenTag,
  onOpenTechnical,
}: {
  project: ProjectRecord;
  /** A rep can't open the Commercial page. */
  showCommercial: boolean;
  onClose: () => void;
  onOpenTag: (version: ProjectRecord, tag: TagRecord) => void;
  onOpenTechnical: (version: ProjectRecord) => void;
}) {
  const [versions, setVersions] = useState<ProjectRecord[] | null>(null);
  const [error, setError] = useState("");
  const [tagsFor, setTagsFor] = useState<Record<string, TagRecord[] | "loading" | "error">>({});

  useEffect(() => {
    let cancelled = false;
    listEnquiryVersions(project.id)
      .then((v) => !cancelled && setVersions(v))
      .catch(() => !cancelled && setError("Couldn't load the versions."));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const toggleTags = (id: string) => {
    if (tagsFor[id]) {
      setTagsFor(({ [id]: _closed, ...rest }) => rest);
      return;
    }
    setTagsFor((m) => ({ ...m, [id]: "loading" }));
    listTags(id)
      .then((rows) => setTagsFor((m) => ({ ...m, [id]: rows })))
      .catch(() => setTagsFor((m) => ({ ...m, [id]: "error" })));
  };

  const meta = "inline-flex items-center gap-1.5 text-[12px] text-muted-foreground";
  const metaValue = "text-foreground";

  return (
    // Escape, the X or a click outside closes it (nothing here to lose).
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[85vh] max-w-[760px]" onInteractOutside={() => onClose()}>
        <DialogHeader>
          <DialogTitle>Enquiry versions</DialogTitle>
          <DialogDescription className="truncate font-mono">
            {project.project_code}
            {project.name ? ` · ${project.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="p-0">
          {error && <Alert className="m-4">{error}</Alert>}
          {!versions && !error && <p className="px-5 py-4 text-[12.5px] text-muted-foreground">Loading…</p>}
          <ul className="divide-y divide-border">
            {(versions ?? []).map((v) => {
              const tags = tagsFor[v.id];
              return (
                <li key={v.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Badge tone="primary" className="font-mono text-[11.5px] font-semibold">
                      {v.version_no === v.commercial_version_no ? `V${v.version_no}` : `T${v.version_no} · C${v.commercial_version_no}`}
                    </Badge>
                    {v.version_kind === "technical" && <Badge tone="neutral">Technical only</Badge>}
                    {v.is_latest && (
                      <Badge tone="success" dot>
                        Latest
                      </Badge>
                    )}
                    {v.order_type !== "spare" && (
                      <span className={meta}>
                        Technical <StatusBadge status={v.status} />
                      </span>
                    )}
                    <span className={meta}>
                      {v.order_type === "spare" ? "" : "Commercial "}
                      <StatusBadge status={v.commercial_status} />
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className={meta}>
                      <CalendarDays className="size-3" /> Enquiry date <span className={metaValue}>{fmtDay(v.enquiry_date)}</span>
                    </span>
                    {v.completed_on && v.order_type !== "spare" && (
                      <span className={meta}>
                        Technical completed <span className={metaValue}>{fmtDay(v.completed_on)}</span>
                      </span>
                    )}
                    {v.commercial_completed_on && (
                      <span className={meta}>
                        {v.order_type === "spare" ? "Completed" : "Commercial completed"} <span className={metaValue}>{fmtDay(v.commercial_completed_on)}</span>
                      </span>
                    )}
                    <span className={meta}>
                      <UserRound className="size-3" /> Assigned to <span className={metaValue}>{v.assigned_to_name || "nobody"}</span>
                    </span>
                  </div>
                  {v.revision_note && (
                    <p className="mt-2 rounded-md border-l-2 border-primary/30 bg-muted/50 px-3 py-1.5 text-[12.5px] whitespace-pre-wrap text-foreground/85">{v.revision_note}</p>
                  )}
                  {!v.is_latest && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {v.order_type !== "spare" && (
                        <>
                          <Button variant="outline" size="sm" aria-expanded={Boolean(tags)} onClick={() => toggleTags(v.id)}>
                            <Tag /> Tags
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => onOpenTechnical(v)}>
                            <FileText /> Technical
                          </Button>
                        </>
                      )}
                      {showCommercial && (
                        <Link href={`/commercial?projectId=${v.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          <IndianRupee /> {v.order_type === "spare" ? "Quotation" : "Commercial"}
                        </Link>
                      )}
                      <span className="ml-1 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                        <Eye className="size-3" /> View only
                      </span>
                    </div>
                  )}
                  {tags === "loading" && <p className="mt-2 text-[12px] text-muted-foreground">Loading tags…</p>}
                  {tags === "error" && <p className="mt-2 text-[12px] font-medium text-destructive">Couldn&apos;t load the tags.</p>}
                  {Array.isArray(tags) && (
                    <ul className="mt-2.5 divide-y divide-border overflow-hidden rounded-md border border-border">
                      {tags.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-muted/40">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{t.name}</span>
                          <StatusBadge status={t.status} />
                          <Button variant="outline" size="sm" onClick={() => onOpenTag(v, t)}>
                            <Eye /> View
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
