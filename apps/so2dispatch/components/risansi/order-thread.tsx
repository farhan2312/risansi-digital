"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { isCentral, roleLabel } from "@/lib/roles";
import type {
  ConversationSummary,
  OrderMessage,
} from "@/lib/order-messages";
import {
  deleteMessageAction,
  editMessageAction,
  listConversationsAction,
  openThreadAction,
  postMessageAction,
} from "@/app/risansi/orders/thread-actions";
import { DelayLogsModal } from "./delay-logs-modal";

const MAX_MESSAGE_LENGTH = 2000;


function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Always date + time — a thread spans weeks, so a bare clock is ambiguous.
  // The year is dropped for the current year to keep the line short.
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

/**
 * One SO's discussion, as a list of conversations. A department talks to every
 * other department and to Central Visibility; Central talks to each
 * department. Each conversation is strictly between its two sides.
 *
 * The open panel long-polls, so a reply lands without a reload.
 *
 * An entry is either a plain note or one flagged as a delay. A delay is the
 * same message, marked and dated by when it was logged, so the reason for a
 * hold-up stays on the order.
 */
export function OrderThread({
  orderId,
  role,
  soLabel,
  initialPeer,
  className = "",
  collapsible = false,
  defaultOpen = true,
}: {
  orderId: string;
  role: string;
  soLabel?: string;
  /** Open on this conversation (All chats) rather than the one most worth reading. */
  initialPeer?: string;
  className?: string;
  // Adds the expand/collapse control to the header. The modal keeps it off
  // — there is nothing to collapse into there.
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const central = isCentral(role);
  // The viewer's own team (a Rep Manager shares the Reps' side).
  const ownPeer = central ? "central_visibility" : role === "rep_manager" ? "rep" : role;
  const peerName = (p: string) => (p === ownPeer ? `${roleLabel(p)} (own team)` : roleLabel(p));
  const [open, setOpen] = useState(collapsible ? defaultOpen : true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // The conversation on screen — who it is with. Everyone starts on the one
  // most worth reading, picked once the summaries arrive.
  const [peer, setPeer] = useState<string | null>(initialPeer ?? null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Newest message the poll has seen on this SO, and the conversation it is
  // watching — both refs so a delivery doesn't restart the loop.
  const sinceRef = useRef<string | null>(null);
  const peerRef = useRef<string | null>(null);

  // Composer — a note, or the same message flagged as a delay.
  const [mode, setMode] = useState<"note" | "delay">("note");
  const [showLogs, setShowLogs] = useState(false);
  const [body, setBody] = useState("");
  // Editing or deleting an entry: which one, its new text, and the one asking "Delete?".
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refreshConversations() {
    const res = await listConversationsAction(orderId);
    if (res.ok) setConversations(res.conversations);
  }

  // Open on the conversation worth reading first: one with unread, else the
  // most recently active, else the first in the list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listConversationsAction(orderId);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }
      setConversations(res.conversations);
      const best =
        res.conversations.find((c) => c.unread > 0) ??
        [...res.conversations]
          .filter((c) => c.last_at)
          .sort((a, b) => (a.last_at! < b.last_at! ? 1 : -1))[0] ??
        res.conversations[0];
      setPeer((prev) => prev ?? best?.peer ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, central]);

  // Switching conversation resets the poll cursor, or the new tab would look
  // up to date before anything has been fetched for it.
  useEffect(() => {
    peerRef.current = peer;
    sinceRef.current = null;
  }, [peer]);

  // Load the selected conversation — only once the panel is open.
  useEffect(() => {
    if (!peer || !open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await openThreadAction(orderId, peer);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        setMessages([]);
        return;
      }
      setError(null);
      setMessages(res.messages);
      // The conversation is read now — clear its badge without a round trip.
      setConversations((prev) =>
        prev.map((c) => (c.peer === peer ? { ...c, unread: 0 } : c))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, peer, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /**
   * Long-poll while the panel is open: each request is held server-side until
   * something lands on this SO — in any conversation, not just the one on
   * screen, so another tab's badge lights up too — then we ask again.
   *
   * The cursor lives in a ref rather than state: putting it in the dependency
   * list would tear down and restart the loop on every delivery.
   */
  useEffect(() => {
    if (!open || !peer) return;
    const controller = new AbortController();
    let stopped = false;

    async function loop() {
      while (!stopped) {
        try {
          const params = new URLSearchParams({ order: orderId, peer: peer! });
          if (sinceRef.current) params.set("since", sinceRef.current);
          const res = await fetch(`/api/orders/discussion/poll?${params}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
          const data: {
            since: string | null;
            changed: boolean;
            messages: OrderMessage[] | null;
            conversations: ConversationSummary[] | null;
          } = await res.json();
          // Ignore a late answer for a conversation we have since left.
          if (stopped || peerRef.current !== peer) return;
          sinceRef.current = data.since;
          if (data.changed) {
            if (data.messages) setMessages(data.messages);
            if (data.conversations) setConversations(data.conversations);
          }
        } catch {
          if (stopped) return;
          // Network blip — back off before retrying so we don't spin.
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
    loop();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [orderId, peer, open]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!peer || body.trim() === "" || sending) return;
    setSending(true);
    const res = await postMessageAction(orderId, peer, body, composing);
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setBody("");
    setMode("note");
    setMessages(res.messages);
    refreshConversations();
  }

  async function saveEdit(id: string) {
    if (!peer || busyId) return;
    setBusyId(id);
    const res = await editMessageAction(orderId, peer, id, editText);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setEditingId(null);
    setMessages(res.messages);
    refreshConversations();
  }

  async function remove(id: string) {
    if (!peer || busyId) return;
    setBusyId(id);
    const res = await deleteMessageAction(orderId, peer, id);
    setBusyId(null);
    setConfirmId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setMessages(res.messages);
    refreshConversations();
  }

  // Only your own entries may be edited or deleted.
  const canEditMsg = (m: OrderMessage) => m.mine;
  const canDeleteMsg = (m: OrderMessage) => m.mine;

  /** An entry's text — or, while it is being edited, the box to change it. */
  function messageBody(m: OrderMessage, tone: "mine" | "plain" | "delay") {
    if (editingId !== m.id) {
      return (
        <p className={`whitespace-pre-wrap break-words text-sm ${tone === "delay" ? "text-amber-950" : ""}`}>{m.body}</p>
      );
    }
    return (
      <div className="min-w-[16rem]">
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingId(null);
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEdit(m.id);
          }}
          rows={Math.min(6, Math.max(2, editText.split("\n").length))}
          maxLength={MAX_MESSAGE_LENGTH}
          autoFocus
          className="w-full resize-y rounded-lg border border-input-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setEditingId(null)}
            className="h-7 rounded-md border border-input-border bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => saveEdit(m.id)}
            disabled={busyId === m.id || editText.trim() === ""}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busyId === m.id && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    );
  }

  /** Edit and Delete under an entry (Delete asks first), and "edited" once changed. */
  function messageTools(m: OrderMessage, tone: "mine" | "plain" | "delay") {
    if (editingId === m.id) return null;
    const link =
      tone === "mine"
        ? "text-primary-foreground/80 hover:text-primary-foreground"
        : tone === "delay"
          ? "text-amber-800 hover:text-amber-950"
          : "text-muted-foreground hover:text-foreground";
    const edited = m.edited_at ? <span title={`Edited ${stamp(m.edited_at)}`}>· edited</span> : null;
    if (confirmId === m.id) {
      return (
        <span className="inline-flex items-center gap-1.5">
          {edited}
          <span className="font-semibold">Delete this?</span>
          <button type="button" onClick={() => remove(m.id)} disabled={busyId === m.id} className="font-semibold text-rose-600 hover:underline disabled:opacity-60">
            {busyId === m.id ? "Deleting…" : "Yes, delete"}
          </button>
          <button type="button" onClick={() => setConfirmId(null)} className={`hover:underline ${link}`}>
            No
          </button>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2">
        {edited}
        {canEditMsg(m) && (
          <button
            type="button"
            onClick={() => {
              setEditingId(m.id);
              setEditText(m.body);
              setConfirmId(null);
            }}
            aria-label="Edit message"
            className={`inline-flex items-center gap-0.5 ${link}`}
          >
            <Pencil className="h-2.5 w-2.5" /> Edit
          </button>
        )}
        {canDeleteMsg(m) && (
          <button
            type="button"
            onClick={() => {
              setConfirmId(m.id);
              setEditingId(null);
            }}
            aria-label="Delete message"
            className={`inline-flex items-center gap-0.5 ${link}`}
          >
            <Trash2 className="h-2.5 w-2.5" /> Delete
          </button>
        )}
      </span>
    );
  }

  const peerLabel = peer ? peerName(peer) : "";
  // Every conversation can carry a delay — with Central or department to
  // department — beside a plain note.
  const canLogDelay = !!peer;

  // A conversation that cannot carry a delay always sends a note, whatever the
  // toggle was last left on — derived, so switching tabs needs no reset and
  // there is no window where the two disagree.
  const composing = canLogDelay ? mode : "note";
  // Header summary, so a collapsed card still shows there is something here.
  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);
  const totalMessages = conversations.reduce((n, c) => n + c.total, 0);
  const Toggle = collapsible ? "button" : "div";

  const delayCount = messages.filter((m) => m.kind === "delay").length;

  return (
    <section
      className={`rounded-xl border border-card-border bg-surface shadow-sm ${className}`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-5 py-4 ${
          open ? "border-b border-card-border" : ""
        }`}
      >
        <Toggle
          className="flex items-center gap-2 text-left"
          {...(collapsible
            ? {
                type: "button" as const,
                onClick: () => setOpen((v) => !v),
                "aria-expanded": open,
              }
            : {})}
        >
          {collapsible &&
            (open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ))}
          <MessageSquare className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold text-foreground">
            Discussion
          </h2>
          {totalUnread > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
              {totalUnread}
            </span>
          )}
          {delayCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              {delayCount} delay
              {delayCount === 1 ? "" : "s"}
            </span>
          )}
          {!open && totalUnread === 0 && totalMessages > 0 && (
            <span className="text-xs text-muted">{totalMessages}</span>
          )}
        </Toggle>

        <div className="flex flex-wrap items-center gap-3">
          <p className="hidden text-xs text-muted lg:block">
            {peer === ownPeer
              ? "Visible to your own team only"
              : peerLabel
              ? `Visible to you and ${peerLabel} only`
              : "Pick who to talk to."}
          </p>
          {central && (
            <button
              type="button"
              onClick={() => setShowLogs(true)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              View delay logs
            </button>
          )}
        </div>
      </div>

      {showLogs && (
        <DelayLogsModal
          orderId={orderId}
          soLabel={soLabel}
          onClose={() => setShowLogs(false)}
        />
      )}

      {/* Every conversation this user can hold on the SO. A department sees
          the other departments and Central; Central sees each department. */}
      {open && conversations.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-card-border px-4 py-2.5">
          {conversations.map((c) => {
            const active = c.peer === peer;
            return (
              <button
                key={c.peer}
                type="button"
                onClick={() => setPeer(c.peer)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-card-border bg-background text-muted hover:text-foreground"
                }`}
              >
                {peerName(c.peer)}
                {c.unread > 0 ? (
                  <span
                    className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                      active
                        ? "bg-primary-foreground text-primary"
                        : "bg-rose-600 text-white"
                    }`}
                  >
                    {c.unread}
                  </span>
                ) : (
                  c.total > 0 && (
                    <span
                      className={`text-[10px] font-medium ${active ? "opacity-80" : "opacity-70"}`}
                    >
                      {c.total}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <>
          <div className="max-h-96 min-h-[10rem] space-y-3 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted">
                No messages yet
                {peerLabel ? ` with ${peerLabel}` : ""}. Post an
                update, or log a delay so the reason stays on this order.
              </p>
            ) : (
              messages.map((m) => {
                // --- delay: the same message, flagged and dated.
                if (m.kind === "delay") {
                  return (
                    <div
                      key={m.id}
                      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                          <AlertTriangle className="h-3 w-3" />
                          Delay
                        </span>
                        <span className="text-[11px] font-semibold text-amber-900">
                          {stamp(m.created_at)}
                        </span>
                      </div>
                      {messageBody(m, "delay")}
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-amber-800">
                        <span>
                          {m.author_name} · {roleLabel(m.author_role)}
                          {central && m.to_role
                            ? ` → ${roleLabel(m.to_role)}`
                            : ""}
                        </span>
                        {messageTools(m, "delay")}
                      </div>
                    </div>
                  );
                }
                // --- plain note: chat bubble.
                return (
                  <div
                    key={m.id}
                    className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                        m.mine
                          ? "bg-primary text-primary-foreground"
                          : "border border-card-border bg-background text-foreground"
                      }`}
                    >
                      {!m.mine && (
                        <div className="mb-0.5 text-[11px] font-semibold text-primary">
                          {m.author_name}
                          <span className="ml-1 font-normal text-muted-foreground">
                            {roleLabel(m.author_role)}
                          </span>
                        </div>
                      )}
                      {/* Inside a conversation the recipient is a given; it
                          is only worth saying in Central's view, where a
                          department's tab also carries its conversations with
                          other departments. */}
                      {central && m.to_role && (
                        <div
                          className={`mb-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            m.mine
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          <ArrowRight className="h-2.5 w-2.5" />
                          {roleLabel(m.dept_role)} → {roleLabel(m.to_role)}
                        </div>
                      )}
                      {messageBody(m, m.mine ? "mine" : "plain")}
                      <div
                        className={`mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] ${
                          m.mine
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        <span>{stamp(m.created_at)}</span>
                        {messageTools(m, m.mine ? "mine" : "plain")}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <p role="alert" className="px-5 pb-2 text-xs text-danger">
              {error}
            </p>
          )}

          <form
            onSubmit={send}
            className="space-y-2.5 border-t border-card-border px-5 py-4"
          >
            {/* Every conversation offers the delay flag. Not
                rendered rather than hidden by a class: `hidden` and
                `inline-flex` both set display, and which one wins depends on
                the order Tailwind emits them, not on the order written here. */}
            {canLogDelay && (
              <div className="inline-flex rounded-lg border border-card-border p-0.5">
                {(["note", "delay"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`h-7 rounded-md px-3 text-xs font-semibold transition-colors ${
                      mode === value
                        ? value === "delay"
                          ? "bg-amber-600 text-white"
                          : "bg-primary text-primary-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {value === "note" ? "Note" : "Log a delay"}
                  </button>
                ))}
              </div>
            )}


            <div className="flex items-end gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter makes a new line.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(e);
                  }
                }}
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                disabled={!peer || sending}
                placeholder={
                  composing === "delay"
                    ? "What exactly is holding it up?"
                    : peerLabel
                      ? `Message ${peerLabel}…`
                      : "Add an update…"
                }
                className="min-h-[2.75rem] flex-1 resize-y rounded-[10px] border border-input-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!peer || sending || body.trim() === ""}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  composing === "delay"
                    ? "bg-amber-600 text-white hover:bg-amber-700"
                    : "bg-primary text-primary-foreground hover:bg-primary-hover"
                }`}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : composing === "delay" ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {composing === "delay" ? "Log delay" : "Send"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
