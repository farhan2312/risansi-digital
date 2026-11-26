"use client";

import { useEffect, useState } from "react";
import { Link2, Plus, X } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import { MAX_LINKS_PER_DOC, docLinkKinds, sharepointLinkProblem, type DocLinkKind, type DocLinks } from "../../lib/doc-links";
import { saveDocLinks } from "../../services/projectService";

/** On Review: Client's own format (lib/doc-links.ts). Ticked, each document to send needs
 *  its SharePoint link (the file made by hand) - one or more (user, 2026-11-26) - and only
 *  those links are shared with Operation - not the generated documents. Turning it on or
 *  off, or changing a link, means the version is reviewed (and sent) again. */
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
  // Each document's inputs: its saved links, or one empty box.
  const toDraft = (l: DocLinks | null): DocLinks => Object.fromEntries(docLinkKinds(orderType).map(({ key }) => [key, l?.[key]?.length ? [...l[key]!] : [""]]));
  const [draft, setDraft] = useState<DocLinks>(() => toDraft(links));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(toDraft(links)), [links]);

  const filled = (key: DocLinkKind) => (draft[key] ?? []).map((u) => u.trim()).filter(Boolean);
  const problems = shown
    .flatMap(({ key, label }) => {
      const list = filled(key);
      return list.map((v, i) => {
        const p = sharepointLinkProblem(v);
        return p ? `The ${label} link${list.length > 1 ? ` ${i + 1}` : ""} ${p}.` : null;
      });
    })
    .filter(Boolean);
  const dirty = on && shown.some(({ key }) => filled(key).join("\n") !== (links?.[key] ?? []).join("\n"));

  const setLink = (key: DocLinkKind, i: number, v: string) => setDraft({ ...draft, [key]: (draft[key] ?? [""]).map((u, j) => (j === i ? v : u)) });
  const addLink = (key: DocLinkKind) => setDraft({ ...draft, [key]: [...(draft[key] ?? [""]), ""] });
  const removeLink = (key: DocLinkKind, i: number) => {
    const rest = (draft[key] ?? []).filter((_, j) => j !== i);
    setDraft({ ...draft, [key]: rest.length ? rest : [""] });
  };

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
    for (const { key } of shown) body[key] = filled(key);
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
            ? `Make ${orderType === "spare" ? "the quotation" : "each ticked document"} by hand, put it on SharePoint and paste its link (Add link for more than one file). Only these links are shared with operation - the generated documents are not.`
            : "Tick when the client needs its own format: the documents then go to operation as SharePoint links, not as generated."}
        </span>
      </div>
      {on && (
        <>
          {shown.length === 0 ? (
            <p className="mt-2 text-[12px] text-warning">Tick the documents to send below.</p>
          ) : (
            <div className={`mt-2 grid items-start gap-3 ${shown.length > 1 ? "md:grid-cols-3" : ""}`}>
              {shown.map(({ key, label }) => {
                const list = draft[key] ?? [""];
                return (
                  <fieldset key={key} className="flex min-w-0 flex-col gap-1.5">
                    <legend className="mb-1 text-[12px] font-medium text-foreground">
                      {label} <span className="text-destructive">*</span>
                      {list.length > 1 && <span className="ml-1 font-normal text-muted-foreground">({list.length} links)</span>}
                    </legend>
                    {list.map((url, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input
                          type="url"
                          inputMode="url"
                          value={url}
                          disabled={busy || locked}
                          placeholder="https://….sharepoint.com/…"
                          aria-label={`${label} link${list.length > 1 ? ` ${i + 1}` : ""}`}
                          aria-invalid={i === 0 && !links?.[key]?.length && filled(key).length === 0 ? true : undefined}
                          onChange={(e) => setLink(key, i, e.target.value)}
                          className="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 font-mono text-[12px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50"
                        />
                        {!locked && (list.length > 1 || url) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => removeLink(key, i)}
                            aria-label={`Remove ${label} link${list.length > 1 ? ` ${i + 1}` : ""}`}
                            title="Remove this link"
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!locked && list.length < MAX_LINKS_PER_DOC && (
                      <button
                        type="button"
                        disabled={busy || !list[list.length - 1]?.trim()}
                        onClick={() => addLink(key)}
                        className="inline-flex h-7 w-fit items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-primary hover:bg-primary/8 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Plus className="size-3.5" /> Add link
                      </button>
                    )}
                  </fieldset>
                );
              })}
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
