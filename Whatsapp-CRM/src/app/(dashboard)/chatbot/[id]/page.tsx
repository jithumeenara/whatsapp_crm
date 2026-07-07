"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { ChatbotShell } from "@/components/chatbot/chatbot-shell"
import type { ChatbotBuilderNode } from "@/lib/chatbot/types"

interface Chatbot {
  id: string; name: string; status: string; channel?: string
  entry_node_id?: string | null
  trigger_config?: { no_reply_delay_enabled?: boolean; no_reply_delay_minutes?: number; no_reply_message?: string } | null
}

export default function ChatbotDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [chatbot, setChatbot] = useState<Chatbot | null>(null)
  const [nodes, setNodes] = useState<ChatbotBuilderNode[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/chatbot/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setChatbot(d.chatbot)
        setNodes(d.nodes ?? [])
      })
      .catch(() => toast.error("Failed to load chatbot"))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-[#F4F6FA]">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
    </div>
  )

  if (!chatbot) return (
    <div className="flex flex-col items-center justify-center h-full bg-[#F4F6FA]">
      <AlertCircle className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-[14px] text-slate-400">Chatbot not found</p>
      <button onClick={() => router.push("/chatbot")} className="mt-3 text-[13px] text-indigo-600 hover:underline">Back</button>
    </div>
  )

  const triggerCfg = chatbot.trigger_config ?? {}

  return (
    <ChatbotShell
      chatbotId={chatbot.id}
      initialName={chatbot.name}
      initialStatus={chatbot.status}
      initialNodes={nodes}
      initialEntryNodeKey={chatbot.entry_node_id ?? ""}
      initialNoReplyEnabled={triggerCfg.no_reply_delay_enabled ?? false}
      initialNoReplyMinutes={triggerCfg.no_reply_delay_minutes ?? 30}
      initialNoReplyMessage={triggerCfg.no_reply_message ?? ""}
      channel={chatbot.channel ?? "whatsapp"}
    />
  )
}
