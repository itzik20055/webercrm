import { ChatClient } from "./chat-client";
import { getLeadForChat } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const initialLead = sp.leadId ? await getLeadForChat(sp.leadId) : null;
  return (
    <ChatClient
      initialLead={initialLead}
      initialQuestion={sp.q ?? ""}
    />
  );
}
