"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type { Conversation, ConversationStatus } from "@/types"
import { Search, X, MessageSquare, ChevronDown } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#25D366">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <defs>
        <radialGradient id="ig-cl" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-cl)" />
      <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="2" fill="none" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
    </svg>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#1877F2">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
    </svg>
  )
}

type ChannelFilter = "all" | "whatsapp" | "instagram" | "facebook"

const CHANNEL_OPTIONS: { value: ChannelFilter; label: string; icon: React.ReactNode }[] = [
  { value: "all",       label: "All",       icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { value: "whatsapp",  label: "WhatsApp",  icon: <WhatsAppIcon className="h-3.5 w-3.5" /> },
  { value: "instagram", label: "Instagram", icon: <InstagramIcon className="h-3.5 w-3.5" /> },
  { value: "facebook",  label: "Messenger", icon: <FacebookIcon className="h-3.5 w-3.5" /> },
]

function ChannelBadge({ channel }: { channel?: string }) {
  if (!channel || channel === "whatsapp") {
    return (
      <span className="absolute -bottom-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-white">
        <WhatsAppIcon className="h-3 w-3" />
      </span>
    )
  }
  if (channel === "instagram") {
    return (
      <span className="absolute -bottom-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-white">
        <InstagramIcon className="h-3 w-3" />
      </span>
    )
  }
  if (channel === "facebook") {
    return (
      <span className="absolute -bottom-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-white">
        <FacebookIcon className="h-3 w-3" />
      </span>
    )
  }
  return null
}

interface Props {
  activeConversationId: string | null
  onSelect: (conv: Conversation) => void
  conversations: Conversation[]
  onConversationsLoaded: (convs: Conversation[]) => void
  resyncToken?: number
}

type Filter = ConversationStatus | "all"

const FILTERS: { label: string; value: Filter }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
]

const STATUS_DOT: Record<ConversationStatus, string> = {
  open:    "bg-emerald-400",
  pending: "bg-amber-400",
  closed:  "bg-slate-300",
}

const STATUS_RING: Record<ConversationStatus, string> = {
  open:    "ring-emerald-200",
  pending: "ring-amber-200",
  closed:  "ring-slate-200",
}

function relTime(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: false })
      .replace("about ", "").replace(" minutes", "m").replace(" minute", "m")
      .replace(" hours", "h").replace(" hour", "h")
      .replace(" days", "d").replace(" day", "d")
      .replace("less than a m", "now")
  } catch { return "" }
}

function initials(name?: string | null, phone?: string | null) {
  if (name) return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
  if (phone) return phone.slice(-2)
  return "?"
}

const AVATAR_COLORS = [
  "from-indigo-400 to-indigo-600",
  "from-violet-400 to-violet-600",
  "from-emerald-400 to-emerald-600",
  "from-sky-400 to-sky-600",
  "from-rose-400 to-rose-600",
  "from-amber-400 to-amber-600",
]
function avatarGradient(id: string) {
  const s = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return AVATAR_COLORS[s % AVATAR_COLORS.length]
}

export function ConversationListV2({ activeConversationId, onSelect, conversations, onConversationsLoaded, resyncToken = 0 }: Props) {
  const [search, setSearch] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all")
  const [channelOpen, setChannelOpen] = useState(false)
  const channelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!channelOpen) return
    function handler(e: MouseEvent) {
      if (channelRef.current && !channelRef.current.contains(e.target as Node)) setChannelOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [channelOpen])
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef(onConversationsLoaded)
  useEffect(() => { loadedRef.current = onConversationsLoaded })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const r = await fetch("/api/conversations")
        if (cancelled || !r.ok) return
        const body = await r.json()
        if (cancelled) return
        loadedRef.current(Array.isArray(body) ? body : (body.conversations ?? []))
      } catch { } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [resyncToken])

  const filtered = useMemo(() => {
    let list = conversations
    if (filter !== "all") list = list.filter((c) => c.status === filter)
    if (channelFilter !== "all") list = list.filter((c) => (c.channel ?? "whatsapp") === channelFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((c) =>
        (c.contact?.name ?? "").toLowerCase().includes(q) ||
        (c.contact?.phone ?? "").toLowerCase().includes(q) ||
        (c.last_message_text ?? "").toLowerCase().includes(q)
      )
    }
    return list
  }, [conversations, filter, channelFilter, search])

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count ?? 0), 0)

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-100 px-4 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-bold text-slate-900">Inbox</h2>
            {totalUnread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Channel filter dropdown */}
            <div ref={channelRef} className="relative">
              <button
                type="button"
                onClick={() => setChannelOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-2.5 h-8 text-[12px] font-medium transition-all border",
                  channelFilter !== "all"
                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                    : "text-slate-500 border-slate-200 hover:bg-slate-50"
                )}
              >
                {CHANNEL_OPTIONS.find(o => o.value === channelFilter)?.icon}
                <span className="hidden sm:inline">
                  {CHANNEL_OPTIONS.find(o => o.value === channelFilter)?.label}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {channelOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                  {CHANNEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setChannelFilter(opt.value); setChannelOpen(false) }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-medium transition-colors",
                        channelFilter === opt.value
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {opt.icon}
                      {opt.label}
                      {channelFilter === opt.value && (
                        <span className="ml-auto text-indigo-500">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Search button */}
            <button type="button" onClick={() => { setSearchOpen((v) => !v); setSearch("") }}
              className={cn("flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                searchOpen ? "bg-indigo-50 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>
              {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Search */}
        {searchOpen && (
          <div className="mb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations…"
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-colors" />
            </div>
          </div>
        )}

        {/* Status tabs */}
        <div className="flex">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)}
              className={cn(
                "relative flex-1 py-2.5 text-[12px] font-semibold transition-colors border-b-2",
                filter === f.value
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300"
              )}>
              {f.label}
              {f.value !== "all" && (() => {
                const cnt = conversations.filter((c) => c.status === f.value && c.unread_count > 0).length
                return cnt > 0 ? (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-100 px-1 text-[9px] font-bold text-indigo-700">
                    {cnt}
                  </span>
                ) : null
              })()}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scroll-styled">
        {loading ? (
          <div className="space-y-px p-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl p-3 animate-pulse">
                <div className="h-11 w-11 rounded-2xl bg-slate-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-28 rounded-full bg-slate-100" />
                  <div className="h-3 w-40 rounded-full bg-slate-100" />
                </div>
                <div className="h-3 w-10 rounded-full bg-slate-100 shrink-0" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-3">
              <MessageSquare className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-[13px] font-semibold text-slate-700">
              {search ? "No results" : "No conversations yet"}
            </p>
            <p className="mt-1 text-[12px] text-slate-400">
              {search ? "Try a different search" : "Conversations will appear here"}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-px">
            {filtered.map((conv) => {
              const isActive = conv.id === activeConversationId
              const name = conv.contact?.name || conv.contact?.phone || "Unknown"
              const ini = initials(conv.contact?.name, conv.contact?.phone)
              const grad = avatarGradient(conv.contact?.id ?? conv.id)
              const hasUnread = (conv.unread_count ?? 0) > 0

              return (
                <button key={conv.id} type="button" onClick={() => onSelect(conv)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all group",
                    isActive
                      ? "bg-indigo-50 ring-1 ring-indigo-100"
                      : "hover:bg-slate-50"
                  )}>
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    {conv.contact?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={conv.contact.avatar_url} alt={name}
                        className={cn("h-11 w-11 rounded-2xl object-cover ring-2", STATUS_RING[conv.status])} />
                    ) : (
                      <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white text-[13px] font-bold ring-2", grad, STATUS_RING[conv.status])}>
                        {ini}
                      </div>
                    )}
                    {/* Status dot — right side */}
                    <span className={cn("absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white", STATUS_DOT[conv.status])} />
                    {/* Channel badge — bottom left */}
                    <ChannelBadge channel={conv.channel} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className={cn("text-[13px] truncate", hasUnread ? "font-bold text-slate-900" : "font-semibold text-slate-700")}>
                        {name}
                      </p>
                      <span className={cn("shrink-0 text-[11px]", hasUnread ? "font-semibold text-indigo-600" : "text-slate-400")}>
                        {conv.last_message_at ? relTime(conv.last_message_at) : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <p className={cn("text-[12px] truncate", hasUnread ? "text-slate-700 font-medium" : "text-slate-400")}>
                        {conv.last_message_text || "No messages yet"}
                      </p>
                      {hasUnread && (
                        <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                          {conv.unread_count > 99 ? "99+" : conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
