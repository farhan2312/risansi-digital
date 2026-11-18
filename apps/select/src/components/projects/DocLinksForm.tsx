"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import { docLinkKinds, sharepointLinkProblem, type DocLinkKind, type DocLinks } from "../../lib/doc-links";
import { saveDocLinks } from "../../services/projectService";

/** On Review: Client's own format (lib/doc-links.ts). Ticked, each document to send needs
 *  its SharePoint link (the file made by hand), and only those links are shared with
 *  Operation - not the generated documents. Turning it on or off, or changing a link,
 *  means the version is reviewed (and sent) again. */
export default function DocLinksForm({
  projectId,
  orderType,
  links,
  kinds,
  locked,
  wasReviewed,
  onSaved,
}: {
  projectId: string;
  orderType: string;
  /** null = off. */
  links: DocLinks | null;
  /** The documents to send (a pump's ticks; a spare's quotation). */
  kinds: DocLinkKind[];
  /** Sent to operation already: shown, not changed. */
  locked: boolean;
  /** Reviewed or sent already: a change undoes that, so say so. */
  wasReviewed: boolean;
  onSaved: (links: DocLinks | null, changed: boolean) => void;
}) {
  const on = links !== null;
  const shown = docLinkKinds(orderType).filter((k) => kinds.includes(k.key));
  const [draft, setDraft] = useState<DocLinks>(links ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setDraft(links ?? {}), [links]);

  const problems = shown
    .map(({ key, label }) => {
      const v = (draft[key] ?? "").trim();
      const p = v ? sharepointLinkProblem(v) : null;
      return p ? `The ${label} link ${p}.` : null;
    })
    .filter(Boolean);
  const dirty = on && shown.some(({ key }) => (draft[key] ?? "").trim() !== (links?.[key] ?? ""));

  const send = async (body: { clientFormat: boolean } & DocLinks) => {
    setBusy(true);
    setErr("");
    try {
      const r = await saveDocLinks(projectId, body);
      onSaved(r.links, r.changed);
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };
  const saveLinks = () => {
    const body: { clientFormat: boolean } & DocLinks = { clientFormat: true };
    for (const { key } of shown) body[key] = (draft[key] ?? "").trim();
    void send(body);
  };

  return (
    <section className={`shrink-0 rounded-md border px-4 py-3 ${on ? "border-primary/25 bg-primary/5" : "border-border bg-muted/30"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className={`flex items-center gap-2 text-[13px] font-semibold text-foreground ${locked || busy ? "" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            className="size-3.5 cursor-pointer accent-[var(--sc-primary)] disabled:cursor-default"
            checked={on}
            disabled={locked || busy}
            onChange={(e) => void send({ clientFormat: e.target.checked })}
          />
          <Link2 className="size-4 text-primary" aria-hidden />
          Client&apos;s own format required
        </label>
        <span className="text-[12px] text-muted-foreground">
          {on
            ? `Make ${orderType === "spare" ? "the quotation" : "each ticked document"} by hand, put it on SharePoint and paste its link. Only these links are shared with operation - the generated documents are not.`
            : "Tick when the client needs its own format: the documents then go to operation as SharePoint links, not as generated."}
        </span>
      </div>
      {on && (
        <>
          {shown.length === 0 ? (
            <p className="mt-2 text-[12px] text-warning">Tick the documents to send below.</p>
          ) : (
            <div className={`mt-2 grid gap-2 ${shown.length > 1 ? "md:grid-cols-3" : ""}`}>
              {shown.map(({ key, label }) => (
                <label key={key} className="flex min-w-0 flex-col gap-1">
                  <span className="text-[12px] font-medium text-foreground">
                    {label} <span className="text-destructive">*</span>
                  </span>
                  <input
                    type="url"
                    inputMode="url"
                    value={draft[key] ?? ""}
                    disabled={busy || locked}
                    placeholder="https://….sharepoint.com/…"
                    aria-invalid={!(links?.[key]) && !(draft[key] ?? "").trim() ? true : undefined}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-card px-2.5 font-mono text-[12px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50"
                  />
                </label>
              ))}
            </div>
          )}
          {!locked && shown.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={busy || !dirty || problems.length > 0} onClick={saveLinks}>
                {busy ? "Saving…" : "Save links"}
              </Button>
              {!err && !problems[0] && dirty && wasReviewed && (
                <span className="text-[12px] text-warning">Saving a change means this version is reviewed and sent to operation again.</span>
              )}
            </div>
          )}
        </>
      )}
      {(err || problems[0]) && <p className="mt-2 text-[12px] font-medium text-destructive">{err || problems[0]}</p>}
    </section>
  );
}
