import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ChatbotShell } from "@/components/chatbot/chatbot-shell";
import type { ChatbotBuilderNode } from "@/lib/chatbot/types";

export default async function ChatbotEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  });
  if (!profile?.account_id) redirect("/login");

  const chatbot = await prisma.flow.findFirst({
    where: { id, account_id: profile.account_id, flow_type: "chatbot" },
  });
  if (!chatbot) notFound();

  const dbNodes = await prisma.flowNode.findMany({
    where: { flow_id: id },
    orderBy: { created_at: "asc" },
  });

  const nodes: ChatbotBuilderNode[] = dbNodes.map((n) => ({
    id: n.id,
    node_key: n.node_key,
    node_type: n.node_type as ChatbotBuilderNode["node_type"],
    config: (n.config as Record<string, unknown>) ?? {},
    position_x: n.position_x ?? 0,
    position_y: n.position_y ?? 0,
  }));

  return (
    <ChatbotShell
      chatbotId={id}
      initialName={chatbot.name}
      initialStatus={chatbot.status}
      initialNodes={nodes}
      initialEntryNodeKey={chatbot.entry_node_id ?? "start"}
    />
  );
}
