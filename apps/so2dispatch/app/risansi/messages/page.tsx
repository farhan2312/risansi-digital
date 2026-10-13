import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { listConversations } from "@/lib/chat";
import { MessagesView } from "@/components/risansi/messages-view";

export const metadata: Metadata = {
  title: "Messages | Risansi",
};

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const central = isCentral(user.role);
  const conversations = await listConversations(user.id, user.role);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <MessageSquare className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Messages
          </h1>
          <p className="text-sm text-muted">
            {central
              ? "Search for a department user and start a conversation."
              : "Message Central Visibility about your orders."}
          </p>
        </div>
      </div>

      <MessagesView
        initialConversations={conversations}
        canSearch={central}
        searchHint={
          central ? "Search department users…" : "Search Central Visibility…"
        }
      />
    </div>
  );
}
