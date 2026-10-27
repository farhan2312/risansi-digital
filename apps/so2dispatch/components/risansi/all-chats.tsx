"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MessagesSquare, Search, X } from "lucide-react";
import { ALL_ROLES, isCentral, isCrm, roleLabel } from "@/lib/roles";
import type { ChatSummary } from "@/lib/order-messages";
import { allChatsAction } from "@/app/risansi/orders/thread-actions";
import { OrderThreadModal } from "./order-thread-modal";
import { stamp } from "./discussion-bell";

/** Where a page's Reminders row takes the All chats button into itself. */
export const ALL_CHATS_SLOT = "all-chats-slot";

/**
 * The All chats button above a list's filters: in the Reminders row when the
 * page has one, else on a row of its own at the right.
 */
export function AllChatsRow() {
  const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => setSlot(document.getElementById(ALL_CHATS_SLOT)), []);
  if (slot === undefined) return null;
  if (slot) return createPortal(<AllChatsButton />, slot);
  return (
    <div className="mb-2 flex justify-end">
      <AllChatsButton />
    </div>
  );
}

/**
 * "All chats", above a list's filters: every SO conversation the user is in,
 * latest first and grouped by SO, with what is unread. A page at a time, the
 * next loading as the list is scrolled to its end. A click opens that
 * conversation over the page.
 */
export function AllChatsButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // The search as sent, a moment after typing stops.
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [chat, setChat] = useState<{ orderId: string; soLabel: string; peer: string } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // Which request is current: a newer search or reload drops an older answer.
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  /** The first page afresh, or (more) the next one after what is loaded. */
  const load = useCallback(
    async (more = false) => {
      const id = more ? seq.current : ++seq.current;
      setLoading(true);
      const term = search.toLowerCase();
      const res = await allChatsAction({
        offset: more ? (chats?.length ?? 0) : 0,
        search,
        // Departments whose name the search matches.
        peerHits: term ? ALL_ROLES.filter((r) => roleLabel(r).toLowerCase().includes(term)) : [],
        unreadOnly,
      });
      if (id !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setRole(res.role);
        setChats((prev) => (more ? [...(prev ?? []), ...res.chats] : res.chats));
        setHasMore(res.hasMore);
        setUnread(res.unread);
        setError(null);
      } else setError(res.error);
    },
    [search, unreadOnly, chats]
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  // The first page — at once for the unread count on the button, and again
  // whenever the search or Unread only changes.
  useEffect(() => {
    loadRef.current(false);
  }, [search, unreadOnly]);

  // The next page as the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!open || !el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) loadRef.current(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [open, hasMore, loading, chats]);

  useEffect(() => {
    if (!open || chat) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, chat]);

  // The viewer's own team (a Rep Manager shares the Reps' side).
  const ownPeer = role ? (isCentral(role) ? "central_visibility" : role === "rep_manager" ? "rep" : role) : null;
  const peerName = (p: string) => (p === ownPeer ? `${roleLabel(p)} (own team)` : roleLabel(p));

  // Grouped by SO, in the order their latest message came.
  // (A page can end mid-SO: the next page's lines join its group.)
  const groups = useMemo(() => {
    const out = new Map<string, ChatSummary[]>();
    for (const c of chats ?? []) out.set(c.order_id, [...(out.get(c.order_id) ?? []), c]);
    return [...out.values()];
  }, [chats]);

  // CRM only reads: no chats.
  if (role && isCrm(role)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          load(false);
        }}
        className="relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border bg-surface px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-background"
      >
        <MessagesSquare className="h-4 w-4 text-primary" />
        All chats
        {unread > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="All chats"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-surface text-left shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-card-border px-5 py-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">All chats</h2>
                <p className="text-xs text-muted">Every SO conversation you are in, latest first.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-card-border px-5 py-2.5">
              <label className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search SO, client, department, message…"
                  className="h-9 w-full rounded-lg border border-input-border bg-surface pl-8 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </label>
              <button
                type="button"
                onClick={() => setUnreadOnly((v) => !v)}
                aria-pressed={unreadOnly}
                className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors ${
                  unreadOnly
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    : "border-input-border text-foreground hover:bg-background"
                }`}
              >
                Unread only{unread > 0 ? ` (${unread})` : ""}
              </button>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
            </div>

            <div className="min-h-[12rem] flex-1 overflow-y-auto">
              {error ? (
                <p className="px-5 py-8 text-center text-sm text-danger">{error}</p>
              ) : chats === null || (loading && !chats.length) ? (
                <p className="px-5 py-8 text-center text-sm text-muted">Loading…</p>
              ) : groups.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">
                  {search || unreadOnly ? "No chats match." : "No chats yet."}
                </p>
              ) : (
                groups.map((g) => {
                  const head = g[0];
                  const soLabel = head.so_no || `#${head.sl_no}`;
                  return (
                    <div key={head.order_id} className="border-b border-card-border px-5 py-3 last:border-b-0">
                      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-semibold text-foreground">{soLabel}</span>
                        {head.client_name && <span className="truncate text-xs text-muted">{head.client_name}</span>}
                      </p>
                      <div className="space-y-1">
                        {g.map((c) => (
                          <button
                            key={c.peer}
                            type="button"
                            onClick={() => setChat({ orderId: c.order_id, soLabel, peer: c.peer })}
                            className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-background ${
                              c.unread ? "bg-primary/5" : ""
                            }`}
                          >
                            <span className="w-40 shrink-0 text-xs font-semibold text-foreground">{peerName(c.peer)}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted">
                              <span className="font-medium text-foreground">{c.last_author}:</span> {c.last_body}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted">{stamp(c.last_at)}</span>
                            {c.unread > 0 && (
                              <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                                {c.unread}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
              {/* Reaching this loads the next page. */}
              {hasMore && !error && (
                <div ref={sentinel} className="flex justify-center py-3 text-xs text-muted">
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Loading more…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {chat && role && (
        <OrderThreadModal
          orderId={chat.orderId}
          role={role}
          soLabel={chat.soLabel}
          initialPeer={chat.peer}
          onClose={() => {
            setChat(null);
            // What was read there is read here too.
            load(false);
          }}
        />
      )}
    </>
  );
}
