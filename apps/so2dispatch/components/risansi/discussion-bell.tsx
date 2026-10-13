"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, MessagesSquare } from "lucide-react";
import { departmentHrefForRole, isCentral, roleLabel } from "@/lib/roles";
import type { InboxEntry } from "@/lib/order-messages";
import { discussionInboxAction } from "@/app/risansi/orders/thread-actions";

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * Discussion inbox in the top bar, next to Report a Bug. SO discussions stay
 * out of the notifications bell — this icon is their only feed.
 */
export function DiscussionBell({
  role,
  initialUnread,
}: {
  role: string;
  initialUnread: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const wrapRef = useRef<HTMLDivElement>(null);

  /**
   * Long-poll the unread total so the badge moves without a reload. The token
   * is the count itself — the only thing this icon renders — so the request
   * comes back the moment it changes in either direction.
   */
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let since = String(initialUnread);

    async function loop() {
      while (!stopped) {
        try {
          const res = await fetch(
            `/api/orders/discussion/poll?since=${encodeURIComponent(since)}`,
            { signal: controller.signal, cache: "no-store" }
          );
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
          const data: { since: string | null; unread: number } = await res.json();
          if (stopped) return;
          since = String(data.since ?? "0");
          setUnread(data.unread);
        } catch {
          if (stopped) return;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
    loop();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [initialUnread]);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    const res = await discussionInboxAction();
    setLoading(false);
    if (res.ok) {
      setEntries(res.entries);
      setUnread(res.entries.length);
    } else {
      setEntries([]);
    }
  }

  // Central opens the order summary; a department user goes to their own
  // workspace, which opens that SO's thread on arrival.
  function go(entry: InboxEntry) {
    setOpen(false);
    if (isCentral(role)) {
      router.push(`/risansi/orders/${entry.order_id}`);
      return;
    }
    const href = departmentHrefForRole(role);
    if (href) router.push(`${href}?thread=${entry.order_id}`);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={
          unread > 0 ? `Discussions — ${unread} unread` : "Discussions"
        }
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-surface text-foreground transition-colors hover:bg-background"
      >
        <MessagesSquare className="h-4 w-4 text-primary" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-card-border bg-surface shadow-lg">
          <div className="border-b border-card-border px-4 py-2.5">
            <p className="font-display text-sm font-semibold text-foreground">
              Discussions
            </p>
            <p className="text-[11px] text-muted">
              Unread messages on your orders.
            </p>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : !entries || entries.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Nothing unread.</p>
            ) : (
              entries.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => go(e)}
                  className="block w-full border-b border-card-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-background"
                >
                  <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">
                      SO {e.so_no || `#${e.sl_no}`}
                    </span>
                    {e.kind === "delay" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        Delay
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {stamp(e.created_at)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground">
                    {e.body}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {e.author_name} · {roleLabel(e.author_role)}
                    {isCentral(role) ? ` · ${roleLabel(e.dept_role)} lane` : ""}
                    {/* A message addressed to you came from another
                        department's lane — say which. */}
                    {e.to_role ? ` · asked of ${roleLabel(e.to_role)}` : ""}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
