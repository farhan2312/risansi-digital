import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { listConversations } from "@/lib/chat";
import { MessagesView } from "@/components/risansi/messages-view";
import { PageHeading } from "@/components/risansi/page-heading";

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
      <PageHeading
        icon={<MessageSquare />}
        title="Messages"
        description={<>{central ? "Search for a department user and start a conversation." : "Message Central Visibility about your orders."}</>}
      />

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
