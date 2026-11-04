"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, CheckCheck, ExternalLink, Loader2, MessagesSquare, Search, X } from "lucide-react";
import { ALL_ROLES, departmentHrefForRole, isCentral, isRep, roleLabel } from "@/lib/roles";
import type { ChatSummary, SoHit } from "@/lib/order-messages";
import {
  allChatsAction,
  chatSoDetailsAction,
  markAllChatsReadAction,
  searchSosForChatAction,
  type ChatSoDetails,
} from "@/app/risansi/orders/thread-actions";
import { OrderThread } from "./order-thread";
import { stamp } from "./discussion-bell";

type Filter = "all" | "unread" | "waiting";
type OpenChat = { orderId: string; soLabel: string; peer?: string };

/** How long a chat has waited: 45m, 5h, 3d. */
function waited(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

const count = (n: number) => (n > 99 ? "99+" : n);

/**
 * All chats, from the sidebar, over whichever page this is: on the left every
 * SO conversation the user is in, latest first and grouped by SO; on the right
 * the one picked, with where its SO stands. Searching also finds SOs with no
 * chat yet, to start one on. A page at a time, the next loading as the list is
 * scrolled to its end.
 */
export function AllChatsPanel({
  role,
  liveUnread,
  onClose,
}: {
  role: string;
  /** The unread count from the top bar's poll: a change means the list is out of date. */
  liveUnread: number;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // The search as sent, a moment after typing stops.
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [hits, setHits] = useState<SoHit[]>([]);
  const [chat, setChat] = useState<OpenChat | null>(null);
  const [marking, setMarking] = useState(false);
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
        unreadOnly: filter === "unread",
        waitingOnly: filter === "waiting",
      });
      if (id !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setChats((prev) => (more ? [...(prev ?? []), ...res.chats] : res.chats));
        setHasMore(res.hasMore);
        setUnread(res.unread);
        setWaiting(res.waiting);
        setError(null);
      } else setError(res.error);
    },
    [search, filter, chats]
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  // The first page, and again when the search or filter changes or a message moves the count.
  useEffect(() => {
    loadRef.current(false);
  }, [search, filter, liveUnread]);

  // The SOs a search finds, chat or not.
  useEffect(() => {
    if (search.length < 2) return;
    let live = true;
    searchSosForChatAction(search).then((res) => {
      if (live) setHits(res.ok ? res.sos : []);
    });
    return () => {
      live = false;
    };
  }, [search]);

  // The next page as the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) loadRef.current(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, chats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The viewer's own team (a Rep Manager shares the Reps' side).
  const ownPeer = isCentral(role) ? "central_visibility" : role === "rep_manager" ? "rep" : role;
  const peerName = (p: string) => (p === ownPeer ? `${roleLabel(p)} (own team)` : roleLabel(p));

  // Grouped by SO, in the order their latest message came.
  // (A page can end mid-SO: the next page's lines join its group.)
  const groups = useMemo(() => {
    const out = new Map<string, ChatSummary[]>();
    for (const c of chats ?? []) out.set(c.order_id, [...(out.get(c.order_id) ?? []), c]);
    return [...out.values()];
  }, [chats]);
  // SOs found that the list above does not already show.
  const newSos = search.length < 2 ? [] : hits.filter((h) => !groups.some((g) => g[0].order_id === h.order_id));

  function pick(c: ChatSummary, soLabel: string) {
    setChat({ orderId: c.order_id, soLabel, peer: c.peer });
    // Opening it reads it; the count catches up by itself.
    setChats((prev) => prev?.map((x) => (x === c ? { ...x, unread: 0 } : x)) ?? prev);
  }

  async function markAll() {
    if (marking || !window.confirm(`Mark all ${unread} unread messages as read?`)) return;
    setMarking(true);
    const res = await markAllChatsReadAction();
    setMarking(false);
    if (!res.ok) setError(res.error);
    else load(false);
  }

  const tab = (value: Filter, label: string, n: number) => (
    <button
      type="button"
      onClick={() => setFilter((f) => (f === value ? "all" : value))}
      aria-pressed={filter === value}
      className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border px-2 text-xs font-medium transition-colors ${
        filter === value
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-input-border text-foreground hover:bg-background"
      }`}
    >
      {label}
      {n > 0 && <span className="font-semibold text-muted">{count(n)}</span>}
    </button>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All chats"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-full max-w-6xl overflow-hidden rounded-t-2xl bg-surface text-left shadow-xl sm:rounded-2xl"
      >
        {/* The list. On a phone, one side at a time. */}
        <div className={`${chat ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-card-border md:w-[23rem] md:shrink-0 md:border-r`}>
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
              <MessagesSquare className="h-4 w-4 text-primary" />
              All chats
            </h2>
            <span className="flex items-center gap-1">
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground md:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          </div>
          <div className="space-y-2 border-b border-card-border px-4 pb-2.5">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search SO, EC, client, message…"
                className="h-9 w-full rounded-lg border border-input-border bg-surface pl-8 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {tab("unread", "Unread", unread)}
              {tab("waiting", "Waiting on me", waiting)}
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAll}
                  disabled={marking}
                  className="ml-auto inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-1.5 text-xs font-medium text-primary transition-colors hover:bg-background disabled:opacity-50"
                >
                  {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {newSos.length > 0 && (
              <div className="border-b border-card-border px-4 py-2.5">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Start a chat on</p>
                {newSos.map((h) => {
                  const soLabel = h.so_no || `#${h.sl_no}`;
                  return (
                    <button
                      key={h.order_id}
                      type="button"
                      onClick={() => setChat({ orderId: h.order_id, soLabel })}
                      className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background ${
                        chat?.orderId === h.order_id ? "bg-primary/10" : ""
                      }`}
                    >
                      <span className="block text-sm font-semibold text-foreground">{soLabel}</span>
                      {h.client_name && <span className="block truncate text-xs text-muted">{h.client_name}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {error ? (
              <p className="px-4 py-8 text-center text-sm text-danger">{error}</p>
            ) : chats === null ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Loading…</p>
            ) : groups.length === 0 ? (
              newSos.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  {search || filter !== "all"
                    ? filter === "waiting" && !search
                      ? "Nothing is waiting on you."
                      : "No chats match."
                    : "No chats yet. Search an SO to start one."}
                </p>
              )
            ) : (
              groups.map((g) => {
                const head = g[0];
                const soLabel = head.so_no || `#${head.sl_no}`;
                return (
                  <div key={head.order_id} className="border-b border-card-border px-4 py-2.5 last:border-b-0">
                    <p className="mb-1 flex items-baseline gap-2 text-sm">
                      <span className="shrink-0 font-semibold text-foreground">{soLabel}</span>
                      {head.client_name && <span className="min-w-0 truncate text-xs text-muted">{head.client_name}</span>}
                    </p>
                    <div className="space-y-0.5">
                      {g.map((c) => {
                        const on = chat?.orderId === c.order_id && chat.peer === c.peer;
                        return (
                          <button
                            key={c.peer}
                            type="button"
                            onClick={() => pick(c, soLabel)}
                            className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background ${
                              on ? "bg-primary/10" : c.unread ? "bg-primary/5" : ""
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{peerName(c.peer)}</span>
                              {c.waiting && (
                                <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800" title="The last message is from them">
                                  Waiting {waited(c.last_at)}
                                </span>
                              )}
                              <span className="shrink-0 text-[11px] text-muted">{stamp(c.last_at)}</span>
                              {c.unread > 0 && (
                                <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                                  {c.unread}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted">
                              <span className="font-medium text-foreground">{c.last_author}:</span> {c.last_body}
                            </span>
                          </button>
                        );
                      })}
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

        {/* The chat. */}
        <div className={`${chat ? "flex" : "hidden md:flex"} relative min-w-0 flex-1 flex-col`}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2.5 top-2.5 z-10 rounded-lg p-1 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          {/* On a phone, the way back to the list. */}
          <div className="border-b border-card-border px-4 py-2.5 md:hidden">
            <button type="button" onClick={() => setChat(null)} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              <ArrowLeft className="h-3.5 w-3.5" />
              All chats
            </button>
          </div>
          {chat ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SoDetails key={chat.orderId} orderId={chat.orderId} soLabel={chat.soLabel} role={role} onNavigate={onClose} />
              {!chat.peer && <p className="px-5 pt-3 text-xs text-muted">Pick who to talk to below, then type your message.</p>}
              <OrderThread
                key={`${chat.orderId}:${chat.peer ?? ""}`}
                orderId={chat.orderId}
                role={role}
                soLabel={chat.soLabel}
                initialPeer={chat.peer}
                className="rounded-none border-0 shadow-none"
                onSent={() => load(false)}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
              Pick a chat, or search an SO to start one.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Where the chat's SO stands, so nobody has to leave the chat to check. */
function SoDetails({ orderId, soLabel, role, onNavigate }: { orderId: string; soLabel: string; role: string; onNavigate: () => void }) {
  const [so, setSo] = useState<ChatSoDetails | null>(null);
  useEffect(() => {
    let live = true;
    chatSoDetailsAction(orderId).then((res) => {
      if (live && res.ok) setSo(res.so);
    });
    return () => {
      live = false;
    };
  }, [orderId]);

  // Central and Reps open the SO; a department finds it in its own queue.
  const dept = departmentHrefForRole(role);
  const href = isCentral(role) || isRep(role) ? `/risansi/orders/${orderId}` : dept ? `${dept}?focus=${orderId}` : null;
  const statusTone =
    so?.status === "Active"
      ? "bg-emerald-50 text-emerald-700"
      : so?.status === "Closed"
        ? "bg-slate-100 text-slate-700"
        : "bg-amber-50 text-amber-700";

  return (
    <div className="border-b border-card-border bg-background/50 py-3 pl-5 pr-5 md:pr-10">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-display text-sm font-semibold text-foreground">{soLabel}</span>
        {so && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>{so.status}</span>}
        {href && (
          <Link href={href} onClick={onNavigate} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Open SO
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      {so ? (
        <>
          <p className="mt-0.5 text-xs text-muted">{[so.client_name, so.reps && `Rep: ${so.reps}`, so.order_type].filter(Boolean).join(" · ")}</p>
          {so.depts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {so.depts.map((d) => (
                <span
                  key={d.name}
                  className={`rounded-md px-1.5 py-0.5 text-[11px] ${d.done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
                >
                  <span className="font-semibold">{d.name}:</span> {d.label}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="mt-1 text-xs text-muted">Loading…</p>
      )}
    </div>
  );
}
