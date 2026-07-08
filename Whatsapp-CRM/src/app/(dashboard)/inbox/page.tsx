"use client"

import { Suspense, useState, useCallback, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import type { Conversation, Message, Contact, ConversationStatus } from "@/types"
import { useRealtime } from "@/hooks/use-realtime"
import { ConversationListV2 } from "@/components/inbox/conversation-list-v2"
import { MessageThread } from "@/components/inbox/message-thread"
import { ContactSidebarV2 } from "@/components/inbox/contact-sidebar-v2"
import { useMobileBar } from "@/components/layout-v2/dashboard-shell-v2"
import { WifiOff } from "lucide-react"

function InboxV2Content() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const deepLinkConvId = searchParams.get("c")

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeContact, setActiveContact] = useState<Contact | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(null)
  const [resyncToken, setResyncToken] = useState(0)
  // Mobile: show list or thread
  const [mobileView, setMobileView] = useState<"list" | "thread">("list")

  const { hide: hideBar, show: showBar } = useMobileBar()

  // Hide the shell's 48px mobile top bar when a thread is open (full-screen like WhatsApp)
  useEffect(() => {
    if (mobileView === "thread") { hideBar(); return () => showBar(); }
    showBar()
  }, [mobileView, hideBar, showBar])

  const autoSelectedForDeepLinkRef = useRef<string | null>(null)
  const hydratingConvIdsRef = useRef<Set<string>>(new Set())
  const knownConvIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const next = new Set<string>()
    for (const c of conversations) next.add(c.id)
    knownConvIdsRef.current = next
  }, [conversations])

  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return
    hydratingConvIdsRef.current.add(convId)
    try {
      const res = await fetch(`/api/conversations/${convId}`)
      if (!res.ok) return
      const fetched = (await res.json()) as Conversation
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id)
        if (existing) {
          return prev.map((c) =>
            c.id === fetched.id ? { ...c, contact: c.contact ?? fetched.contact } : c,
          )
        }
        return [fetched, ...prev]
      })
    } finally {
      hydratingConvIdsRef.current.delete(convId)
    }
  }, [])

  useEffect(() => {
    fetch("/api/whatsapp/config")
      .then((r) => r.ok ? r.json() : null)
      .then((b) => setWhatsappConnected(b?.connected === true))
      .catch(() => setWhatsappConnected(false))
  }, [])

  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new
      if (event.eventType === "INSERT") {
        if (activeConversation && newMsg.conversation_id === activeConversation.id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev
            return [...prev.filter((m) => !m.id.startsWith("temp-")), newMsg]
          })
        }
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? "",
                    last_message_at: newMsg.created_at,
                    unread_count: activeConversation?.id === newMsg.conversation_id ? 0 : c.unread_count + 1,
                  }
                : c,
            ),
          )
        } else {
          hydrateConversation(newMsg.conversation_id)
        }
      }
      if (event.eventType === "UPDATE") {
        setMessages((prev) => prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m)))
      }
    },
    [activeConversation, hydrateConversation],
  )

  const handleConversationEvent = useCallback(
    (event: { eventType: string; new: Conversation; old: Partial<Conversation> }) => {
      const conv = event.new
      if (event.eventType === "INSERT") {
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev
            return [conv, ...prev]
          })
          hydrateConversation(conv.id)
        }
      }
      if (event.eventType === "UPDATE") {
        if (knownConvIdsRef.current.has(conv.id)) {
          const isActive = activeConversation?.id === conv.id
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id ? { ...c, ...conv, unread_count: isActive ? 0 : conv.unread_count } : c,
            ),
          )
        } else {
          hydrateConversation(conv.id)
        }
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) => (prev ? { ...prev, ...conv } : prev))
        }
      }
    },
    [activeConversation, hydrateConversation],
  )

  const { isConnected } = useRealtime({
    channelName: "inbox-v2-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  })

  const wasConnectedRef = useRef(false)
  const initialConnectDoneRef = useRef(false)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      if (initialConnectDoneRef.current) setResyncToken((n) => n + 1)
      else initialConnectDoneRef.current = true
    }
    wasConnectedRef.current = isConnected
  }, [isConnected])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") setResyncToken((n) => n + 1)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  const handleManualRefresh = useCallback(() => setResyncToken((n) => n + 1), [])

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded)
      if (loaded.length === 0) return
      if (deepLinkConvId && autoSelectedForDeepLinkRef.current !== deepLinkConvId) {
        autoSelectedForDeepLinkRef.current = deepLinkConvId
        if (activeConversation?.id === deepLinkConvId) return
        const match = loaded.find((c) => c.id === deepLinkConvId)
        if (match) {
          setActiveConversation(match)
          setActiveContact(match.contact ?? null)
          setMessages([])
          setMobileView("thread")
          if (match.unread_count > 0) {
            setConversations((prev) =>
              prev.map((c) => (c.id === match.id ? { ...c, unread_count: 0 } : c)),
            )
          }
          return
        }
      }
      if (!activeConversation && !deepLinkConvId) {
        const first = loaded[0]
        setActiveConversation(first)
        setActiveContact(first.contact ?? null)
        setMessages([])
        autoSelectedForDeepLinkRef.current = first.id
        router.replace(`/inbox?c=${first.id}`, { scroll: false })
      }
    },
    [deepLinkConvId, activeConversation, router],
  )

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      if (activeConversation?.id === conv.id) return
      setActiveConversation(conv)
      setActiveContact(conv.contact ?? null)
      setMessages([])
      setMobileView("thread")
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id && c.unread_count > 0 ? { ...c, unread_count: 0 } : c)),
      )
      autoSelectedForDeepLinkRef.current = conv.id
      router.replace(`/inbox?c=${conv.id}`, { scroll: false })
    },
    [activeConversation?.id, router],
  )

  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null)
    setActiveContact(null)
    setMessages([])
    setMobileView("list")
    autoSelectedForDeepLinkRef.current = null
    router.replace("/inbox", { scroll: false })
  }, [router])

  const handleMessagesLoaded = useCallback((loaded: Message[]) => setMessages(loaded), [])
  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      return [...prev, msg]
    })
  }, [])
  const handleUpdateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
  }, [])
  const handleStatusChange = useCallback((conversationId: string, status: ConversationStatus) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, status } : c)))
    if (activeConversation?.id === conversationId) {
      setActiveConversation((prev) => (prev ? { ...prev, status } : prev))
    }
  }, [activeConversation])
  const handleAssignChange = useCallback((conversationId: string, assignedAgentId: string | null) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, assigned_agent_id: assignedAgentId ?? undefined } : c,
      ),
    )
    if (activeConversation?.id === conversationId) {
      setActiveConversation((prev) =>
        prev ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined } : prev,
      )
    }
  }, [activeConversation])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* WhatsApp disconnected banner */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2">
          <WifiOff className="h-3.5 w-3.5 text-amber-600" />
          <p className="text-[12px] text-amber-700 font-medium">
            WhatsAppÂ® is not connected.{" "}
            <a href="/settings?tab=whatsapp" className="underline">Connect in Settings</a>
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: conversation list — hidden on mobile when thread is open */}
        <div className={[
          "flex h-full flex-col border-r border-slate-200 bg-white shrink-0",
          "w-full lg:w-[320px]",
          mobileView === "thread" ? "hidden lg:flex" : "flex",
        ].join(" ")}>
          <ConversationListV2
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken}
          />
        </div>

        {/* Center: message thread — hidden on mobile when list is shown */}
        <div className={[
          "flex h-full min-w-0 flex-1",
          mobileView === "list" ? "hidden lg:flex" : "flex",
        ].join(" ")}>
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
          />
        </div>

        {/* Right: contact sidebar — only on xl screens */}
        <div className="hidden xl:block shrink-0">
          <ContactSidebarV2 contact={activeContact} channel={activeConversation?.channel ?? "whatsapp"} />
        </div>
      </div>
    </div>
  )
}

export default function InboxV2() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-[2.5px] border-indigo-600 border-t-transparent" />
      </div>
    }>
      <InboxV2Content />
    </Suspense>
  )
}
