"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, MessageSquare, Search, Send } from "lucide-react";
import { roleLabel } from "@/lib/roles";
import type { ChatContact, ChatConversation, ChatMessage } from "@/lib/chat";
import {
  listConversationsAction,
  openThreadAction,
  searchContactsAction,
  sendMessageAction,
} from "@/app/risansi/messages/actions";

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function MessagesView({
  initialConversations,
  canSearch,
  searchHint,
}: {
  initialConversations: ChatConversation[];
  // Central Visibility searches for department users; department users are
  // shown the (short) list of Central Visibility users instead.
  canSearch: boolean;
  searchHint: string;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [contacts, setContacts] = useState<ChatContact[] | null>(null);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<ChatContact | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  // Read inside the long-poll loop, which outlives any single render.
  const activeIdRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | undefined>(undefined);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, []);

  // Contact search (debounced). With no search term this also seeds the list
  // of people you can start a new conversation with.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const rows = await searchContactsAction(search);
      if (!cancelled) setContacts(rows);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  async function openThread(contact: ChatContact) {
    setActive(contact);
    activeIdRef.current = contact.id;
    setLoadingThread(true);
    setError(null);
    const res = await openThreadAction(contact.id);
    setLoadingThread(false);
    if (!res) {
      setError("You can't message this user.");
      return;
    }
    setMessages(res.messages);
    lastIdRef.current = res.messages.at(-1)?.id;
    setConversations(await listConversationsAction());
    requestAnimationFrame(scrollToBottom);
  }

  // Long-poll the open thread: each request is held server-side until a
  // message lands (or ~25s passes), then we immediately ask again.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let stopped = false;

    async function loop() {
      while (!stopped) {
        try {
          const params = new URLSearchParams({ with: active!.id });
          if (lastIdRef.current) params.set("after", lastIdRef.current);
          const res = await fetch(`/api/chat/poll?${params}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 4000));
            continue;
          }
          const data: { messages: ChatMessage[] } = await res.json();
          // Ignore a late response for a thread we've since navigated away from.
          if (stopped || activeIdRef.current !== active!.id) return;
          if (data.messages.length > 0) {
            setMessages((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              return [...prev, ...data.messages.filter((m) => !seen.has(m.id))];
            });
            lastIdRef.current = data.messages.at(-1)?.id;
            requestAnimationFrame(scrollToBottom);
            listConversationsAction().then(setConversations);
          }
        } catch {
          if (stopped) return;
          // Network blip — back off before retrying so we don't spin.
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }
    loop();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [active, scrollToBottom]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!active || body === "" || sending) return;
    setSending(true);
    setError(null);
    const res = await sendMessageAction(active.id, body);
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft("");
    setMessages((prev) =>
      prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
    );
    lastIdRef.current = res.message.id;
    requestAnimationFrame(scrollToBottom);
    setConversations(await listConversationsAction());
  }

  // Conversations first (most recent), then anyone else you can message.
  const conversationIds = new Set(conversations.map((c) => c.id));
  const newContacts = (contacts ?? []).filter((c) => !conversationIds.has(c.id));
  const filteredConversations = search.trim()
    ? conversations.filter((c) =>
        `${c.full_name} ${c.email} ${c.role}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      )
    : conversations;

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* left: people */}
      <aside
        className={`flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm sm:w-80 ${
          active ? "hidden sm:flex" : "flex"
        }`}
      >
        <div className="border-b border-card-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchHint}
              className="h-10 w-full rounded-lg border border-input-border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredConversations.length > 0 && (
            <ul className="divide-y divide-card-border">
              {filteredConversations.map((c) => (
                <li key={c.id}>
                  <PersonButton
                    name={c.full_name}
                    role={c.role}
                    preview={c.last_body}
                    at={c.last_at}
                    unread={c.unread}
                    activeNow={active?.id === c.id}
                    onClick={() =>
                      openThread({
                        id: c.id,
                        full_name: c.full_name,
                        email: c.email,
                        role: c.role,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          {newContacts.length > 0 && (
            <>
              <p className="border-y border-card-border bg-background/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {canSearch ? "Department users" : "Central Visibility"}
              </p>
              <ul className="divide-y divide-card-border">
                {newContacts.map((c) => (
                  <li key={c.id}>
                    <PersonButton
                      name={c.full_name}
                      role={c.role}
                      preview={null}
                      at={null}
                      unread={0}
                      activeNow={active?.id === c.id}
                      onClick={() => openThread(c)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

          {contacts !== null &&
            filteredConversations.length === 0 &&
            newContacts.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted">
                No people found.
              </p>
            )}
        </div>
      </aside>

      {/* right: thread */}
      <section
        className={`min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm ${
          active ? "flex" : "hidden sm:flex"
        }`}
      >
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Select someone to start messaging
            </p>
            <p className="text-sm text-muted">{searchHint}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-card-border px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setActive(null);
                  activeIdRef.current = null;
                }}
                className="text-sm text-primary sm:hidden"
              >
                Back
              </button>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initialsOf(active.full_name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {active.full_name}
                </p>
                <p className="truncate text-xs text-muted">
                  {roleLabel(active.role)}
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {loadingThread ? (
                <p className="text-center text-sm text-muted">Loading…</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No messages yet — say hello.
                </p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                        m.mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p
                        className={`mt-0.5 text-[10px] ${
                          m.mine ? "text-primary-foreground/70" : "text-muted"
                        }`}
                      >
                        {timeOf(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {error && (
              <p className="border-t border-danger-border bg-danger-bg px-4 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 border-t border-card-border p-3"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${active.full_name.split(" ")[0]}…`}
                className="h-10 min-w-0 flex-1 rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              <button
                type="submit"
                disabled={sending || draft.trim() === ""}
                aria-label="Send"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function PersonButton({
  name,
  role,
  preview,
  at,
  unread,
  activeNow,
  onClick,
}: {
  name: string;
  role: string;
  preview: string | null;
  at: string | null;
  unread: number;
  activeNow: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background ${
        activeNow ? "bg-background" : ""
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
        {initialsOf(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {at && (
            <span className="shrink-0 text-[10px] text-muted">{timeOf(at)}</span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted">
            {preview ?? roleLabel(role)}
          </span>
          {unread > 0 && (
            <span className="inline-flex min-w-4 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
