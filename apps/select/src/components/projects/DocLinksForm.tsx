"use client";

import { useState } from "react";
import { ChevronDown, Link2 } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import { docLinkKinds, sharepointLinkProblem, type DocLinks } from "../../lib/doc-links";
import { saveDocLinks } from "../../services/projectService";

/** On Review, optional: a SharePoint link per document, for a client who asked for its own
 *  format - the document made by hand is used instead of the generated one. Folded away
 *  until opened (open when there are links). Saving a change means the version is
 *  reviewed (and sent) again. */
export default function DocLinksForm({
  projectId,
  orderType,
  links,
  wasReviewed,
  onSaved,
}: {
  projectId: string;
  orderType: string;
  links: DocLinks;
  /** Reviewed or sent already: a change undoes that, so say so. */
  wasReviewed: boolean;
  onSaved: (links: DocLinks, changed: boolean) => void;
}) {
  const kinds = docLinkKinds(orderType);
  const [draft, setDraft] = useState<DocLinks>(links);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(Object.keys(links).length > 0);

  const problems = kinds
    .map(({ key, label }) => {
      const v = (draft[key] ?? "").trim();
      const p = v ? sharepointLinkProblem(v) : null;
      return p ? `The ${label} link ${p}.` : null;
    })
    .filter(Boolean);
  const dirty = kinds.some(({ key }) => (draft[key] ?? "").trim() !== (links[key] ?? ""));

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const body: DocLinks = {};
      for (const { key } of kinds) body[key] = (draft[key] ?? "").trim();
      const saved = await saveDocLinks(projectId, body);
      setDraft(saved);
      onSaved(saved, true);
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't save the links.");
    } finally {
      setBusy(false);
    }
  };

  const count = Object.keys(links).length;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md px-1 text-[12.5px] font-medium text-primary hover:underline"
      >
        <Link2 className="size-3.5" aria-hidden /> Client&apos;s own format? Add SharePoint links
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
    );
  }

  return (
    <section className="shrink-0 rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Link2 className="size-4 text-primary" aria-hidden />
        <h4 className="text-[13px] font-semibold text-foreground">SharePoint links {count > 0 ? `(${count})` : "(optional)"}</h4>
        <span className="text-[12px] text-muted-foreground">
          Only when the client asked for its own format: make the {orderType === "spare" ? "quotation" : "document"} by hand, put it on SharePoint and paste its link. A document with a link is used instead of the generated one; leave the rest empty.
        </span>
        {count === 0 && !dirty && (
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-[12px] text-muted-foreground hover:text-foreground">
            Hide
          </button>
        )}
      </div>
      <div className={`grid gap-2 ${kinds.length > 1 ? "md:grid-cols-3" : ""}`}>
        {kinds.map(({ key, label }) => (
          <label key={key} className="flex min-w-0 flex-col gap-1">
            <span className="text-[12px] font-medium text-foreground">{label}</span>
            <input
              type="url"
              inputMode="url"
              value={draft[key] ?? ""}
              disabled={busy}
              placeholder="https://….sharepoint.com/…"
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-card px-2.5 font-mono text-[12px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy || !dirty || problems.length > 0} onClick={() => void save()}>
          {busy ? "Saving…" : "Save links"}
        </Button>
        {(err || problems[0]) && <span className="text-[12px] font-medium text-destructive">{err || problems[0]}</span>}
        {!err && !problems[0] && dirty && wasReviewed && (
          <span className="text-[12px] text-warning">Saving a change means this version is reviewed and sent to operation again.</span>
        )}
      </div>
    </section>
  );
}
