"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Alert } from "@/components/shadcn/field";
import type { AssignmentEntry } from "../../lib/assignment-history";
import { getAssignmentHistory, type ProjectRecord } from "../../services/projectService";

// Assignment history (user, 2026-11-25): who the enquiry went to, who moved it and why,
// newest first (lib/assignment-history.ts). In the Assign pop-up and on its own from the
// Assigned To column.

const fmtAt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const KIND_LABEL: Record<AssignmentEntry["kind"], string> = {
  created: "Created, assigned",
  assigned: "Assigned",
  reassigned: "Reassigned",
  "new version": "New version, assigned",
};

/** The list itself; loads once per enquiry. */
export function AssignmentHistoryList({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const [entries, setEntries] = useState<AssignmentEntry[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setErr("");
    getAssignmentHistory(projectId)
      .then((e) => !cancelled && setEntries(e))
      .catch(() => !cancelled && setErr("Couldn't load the assignment history."));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (err) return <Alert>{err}</Alert>;
  if (!entries) return <p className="text-[12.5px] text-muted-foreground">Loading history…</p>;
  if (entries.length === 0) return <p className="text-[12.5px] text-muted-foreground">No assignment recorded yet.</p>;
  return (
    <ol className={`flex flex-col divide-y divide-border overflow-y-auto rounded-md border border-border ${compact ? "max-h-[220px]" : ""}`}>
      {entries.map((e, i) => (
        <li key={i} className="flex flex-col gap-0.5 px-3 py-2 text-[12.5px]">
          <span className="flex flex-wrap items-center gap-x-1.5 text-foreground">
            <b className="font-semibold">{KIND_LABEL[e.kind]}</b>
            {e.from && (
              <>
                <span>{e.from}</span>
                <ArrowRight className="size-3 text-muted-foreground" aria-label="to" />
              </>
            )}
            {!e.from && <span className="text-muted-foreground">to</span>}
            <span className="font-medium">{e.to ?? "—"}</span>
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            {fmtAt(e.at)}
            {e.byName ? ` · by ${e.byName}` : ""}
          </span>
          {e.reason && (
            <span className="text-[12px] text-foreground/85">
              <span className="text-muted-foreground">{e.kind === "new version" ? "Client asked: " : "Why: "}</span>
              {e.reason}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The history on its own, from the Assigned To column. */
export default function AssignmentHistoryModal({ project, onClose }: { project: ProjectRecord; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-[560px]" onInteractOutside={() => onClose()}>
        <DialogHeader>
          <DialogTitle>Assignment history</DialogTitle>
          <DialogDescription className="truncate">
            <span className="font-mono">{project.project_code}</span>
            {project.name ? ` · ${project.name}` : ""} - now with <b>{project.assigned_to_name || "nobody"}</b>
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <AssignmentHistoryList projectId={project.id} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
