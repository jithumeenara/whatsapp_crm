"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Bot, Plus, Pencil, Trash2, Zap, MessagesSquare,
  AlertTriangle, Loader2,
  Radio, Hash, Play, LayoutGrid, List, X, Download, Upload,
} from "lucide-react"
import { formatDistanceToNow, format } from "date-fns"
import { useRealtime } from "@/hooks/use-realtime"

interface Chatbot {
  id: string
  name: string
  trigger_type: string
  trigger_config: { keywords?: string[]; match_type?: string } | null
  is_active: boolean
  status: string
  execution_count: number
  created_at: string
  channel?: string // 'whatsapp' | 'instagram'
}

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const TRIGGER_LABELS: Record<string, string> = {
  keyword:       "Keyword Trigger",
  always:        "Always On",
  whatsapp_flow: "WhatsApp Flow",
  manual:        "Manual",
}
const TRIGGER_ICONS: Record<string, React.ReactNode> = {
  keyword:       <Hash className="h-3 w-3" />,
  always:        <Radio className="h-3 w-3" />,
  whatsapp_flow: <Play className="h-3 w-3" />,
  manual:        <Zap className="h-3 w-3" />,
}

function WhatsAppIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      {/* Green rounded square background */}
      <rect width="48" height="48" rx="10" fill="#25D366"/>
      {/* White speech bubble */}
      <path fill="white" d="M24 9C15.716 9 9 15.716 9 24c0 2.747.743 5.32 2.04 7.532L9 39l7.72-2.005A15 15 0 1 0 24 9z"/>
      {/* Green phone icon inside bubble */}
      <path fill="#25D366" d="M18.8 16.6c-.37-.83-.75-.85-1.1-.87-.28-.01-.6-.01-.92-.01-.32 0-.84.12-1.28.6-.44.48-1.68 1.64-1.68 4 0 2.36 1.72 4.64 1.96 4.96.24.32 3.32 5.32 8.2 7.24 1.14.5 2.03.8 2.72 1.02 1.14.36 2.18.31 3 .19.92-.14 2.84-1.16 3.24-2.28.4-1.12.4-2.08.28-2.28-.12-.2-.44-.32-.92-.56-.48-.24-2.84-1.4-3.28-1.56-.44-.16-.76-.24-1.08.24-.32.48-1.24 1.56-1.52 1.88-.28.32-.56.36-1.04.12-.48-.24-2.04-.76-3.88-2.4-1.44-1.28-2.4-2.86-2.68-3.34-.28-.48-.04-.74.2-.98.22-.22.48-.58.72-.86.24-.28.32-.48.48-.8.16-.32.08-.6-.04-.84-.12-.24-1.08-2.58-1.48-3.53z"/>
    </svg>
  )
}

function InstagramIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <defs>
        <radialGradient id="ig-chat" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-chat)" />
      <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="2" fill="none" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
    </svg>
  )
}

function ChannelBadge({ channel }: Readonly<{ channel?: string }>) {
  if (!channel || channel === "whatsapp") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold text-white border border-white/20">
        <WhatsAppIcon className="h-2.5 w-2.5" />
        WhatsApp
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold text-white border border-white/20">
      <InstagramIcon className="h-2.5 w-2.5" />
      Instagram
    </span>
  )
}

function getKeywords(bot: Chatbot): string[] {
  if (bot.trigger_type !== "keyword") return []
  return bot.trigger_config?.keywords?.filter(Boolean) ?? []
}

type ChannelFilter = "all" | "whatsapp" | "instagram"

export default function ChatbotV2() {
  const router = useRouter()
  const [chatbots, setChatbots] = useState<Chatbot[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [view, setView] = useState<"grid" | "table">("grid")
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all")
  const [showPlatformPicker, setShowPlatformPicker] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await fetch("/api/chatbot").then((r) => r.json())
      setChatbots(data?.chatbots ?? (Array.isArray(data) ? data : []))
    } catch { toast.error("Failed to load chatbots") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  useRealtime({
    channelName: "chatbot-page",
    onChatbotEvent: (event) => {
      setChatbots((prev) =>
        prev.map((b) => b.id === event.id ? { ...b, execution_count: event.execution_count } : b)
      )
    },
  })

  async function createNew(channel: "whatsapp" | "instagram") {
    setShowPlatformPicker(false)
    setCreating(true)
    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New Chatbot", channel }),
      })
      if (!res.ok) { toast.error("Failed to create chatbot"); return }
      const data = await res.json()
      const id = data?.chatbot?.id
      if (id) router.push(`/chatbot/${id}`)
      else { toast.error("No chatbot ID returned"); load() }
    } catch { toast.error("Failed to create chatbot") }
    finally { setCreating(false) }
  }

  async function del(id: string) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/flows/${id}`, { method: "DELETE" })
      if (!res.ok) { toast.error("Failed to delete"); return }
      toast.success("Chatbot deleted")
      setDeleteId(null)
      load()
    } catch { toast.error("Failed to delete") }
    finally { setDeleting(false) }
  }

  async function exportBot(bot: Chatbot) {
    try {
      const data = await fetch(`/api/chatbot/${bot.id}`).then((r) => r.json())
      const payload = {
        version: "1.0",
        exported_at: new Date().toISOString(),
        chatbot: {
          name: data.chatbot.name,
          description: data.chatbot.description ?? null,
          trigger_type: data.chatbot.trigger_type,
          trigger_config: data.chatbot.trigger_config,
          entry_node_id: data.chatbot.entry_node_id,
          status: data.chatbot.status,
          channel: data.chatbot.channel ?? "whatsapp",
        },
        nodes: (data.nodes ?? []).map((n: Record<string, unknown>) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
          position_x: n.position_x,
          position_y: n.position_y,
        })),
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `chatbot-${bot.name.replace(/\s+/g, "-").toLowerCase()}.json`
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success("Chatbot exported")
    } catch {
      toast.error("Export failed")
    }
  }

  async function importBot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setImporting(true)
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      if (!payload?.chatbot || !Array.isArray(payload.nodes)) {
        toast.error("Invalid chatbot JSON file")
        return
      }
      const { chatbot, nodes } = payload
      // Create blank chatbot
      const createRes = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: chatbot.name ?? "Imported Chatbot", channel: chatbot.channel ?? "whatsapp" }),
      })
      if (!createRes.ok) { toast.error("Failed to create chatbot"); return }
      const { chatbot: created } = await createRes.json()
      // Fill with imported data
      await fetch(`/api/chatbot/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: chatbot.name,
          description: chatbot.description,
          trigger_type: chatbot.trigger_type,
          trigger_config: chatbot.trigger_config,
          entry_node_id: chatbot.entry_node_id,
          status: "draft",
          nodes,
        }),
      })
      toast.success("Chatbot imported — opening editor")
      router.push(`/chatbot/${created.id}`)
    } catch {
      toast.error("Import failed — invalid file")
    } finally {
      setImporting(false)
    }
  }

  const isActive = (bot: Chatbot) => bot.status === "active" || bot.is_active

  const filtered = channelFilter === "all"
    ? chatbots
    : chatbots.filter((b) => (b.channel ?? "whatsapp") === channelFilter)

  let content: React.ReactNode
  if (loading) {
    if (view === "grid") {
      content = (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm animate-pulse">
              <div className="h-[64px] bg-indigo-50" />
              <div className="p-2.5 space-y-1.5">
                <div className="h-2 bg-slate-100 rounded w-3/4" />
                <div className="h-2 bg-slate-100 rounded w-1/2" />
                <div className="h-6 bg-slate-100 rounded mt-2" />
              </div>
            </div>
          ))}
        </div>
      )
    } else {
      content = <div className="rounded-xl border border-slate-200 bg-white shadow-sm animate-pulse h-48" />
    }
  } else if (filtered.length === 0) {
    content = (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 mb-4">
          <Bot className="h-8 w-8 text-indigo-400" />
        </div>
        <h2 className="text-[15px] font-bold text-slate-800">
          {channelFilter === "all" ? "No chatbots yet" : `No ${channelFilter} chatbots`}
        </h2>
        <p className="mt-1.5 text-[12px] text-slate-400 max-w-xs leading-relaxed">
          Build a visual chatbot flow that responds to your customers automatically.
        </p>
        <button
          type="button"
          onClick={() => setShowPlatformPicker(true)}
          disabled={creating}
          className="mt-5 flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create your first Chatbot
        </button>
      </div>
    )
  } else if (view === "grid") {
    content = (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {filtered.map((bot) => {
          const active = isActive(bot)
          const isIg = (bot.channel ?? "whatsapp") === "instagram"
          return (
            <div
              key={bot.id}
              className="group rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden"
            >
              <div className={cn(
                "px-3 py-2.5 relative",
                isIg
                  ? "bg-gradient-to-br from-[#833ab4] via-[#fd1d1d] to-[#fcb045]"
                  : "bg-gradient-to-br from-indigo-500 to-indigo-700"
              )}>
                <div className="absolute top-2 right-2">
                  <span className={cn(
                    "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                    active ? "bg-white/20 text-white" : "bg-black/20 text-white/75"
                  )}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-300 animate-pulse" : "bg-white/40")} />
                    {active ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/20">
                  <Bot className="h-3.5 w-3.5 text-white" />
                </div>
                <h3 className="mt-1.5 text-[12px] font-bold text-white truncate pr-12">{bot.name}</h3>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <p className="flex items-center gap-1 text-[10px] text-white/80">
                    {TRIGGER_ICONS[bot.trigger_type] ?? <Zap className="h-3 w-3" />}
                    {TRIGGER_LABELS[bot.trigger_type] ?? bot.trigger_type.replace(/_/g, " ")}
                  </p>
                  <ChannelBadge channel={bot.channel} />
                </div>
                {getKeywords(bot).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {getKeywords(bot).slice(0, 3).map((kw) => (
                      <span key={kw} className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold text-white/90 border border-white/20">
                        {kw}
                      </span>
                    ))}
                    {getKeywords(bot).length > 3 && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/60">
                        +{getKeywords(bot).length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
                <div className="px-2.5 py-2">
                  <p className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider">Runs</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-[16px] font-bold text-slate-900 leading-none">{bot.execution_count.toLocaleString()}</span>
                    <MessagesSquare className="h-2.5 w-2.5 text-slate-300" />
                  </div>
                </div>
                <div className="px-2.5 py-2">
                  <p className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider">Created</p>
                  <p className="text-[10px] font-semibold text-slate-700 mt-0.5 leading-none">
                    {bot.created_at ? format(new Date(bot.created_at), "d MMM yy") : "—"}
                  </p>
                  <p className="text-[9px] text-slate-400 mt-0.5">
                    {bot.created_at ? formatDistanceToNow(new Date(bot.created_at), { addSuffix: true }) : ""}
                  </p>
                </div>
              </div>
              <div className="px-2.5 py-1.5 bg-slate-50/60 border-b border-slate-100">
                <div className="flex items-end gap-0.5 h-3">
                  {[...Array(14)].map((_, i) => (
                    <div
                      key={i}
                      className={cn("flex-1 rounded-sm", isIg ? "bg-pink-100" : "bg-indigo-100")}
                      style={{ height: `${30 + Math.abs(Math.sin(i * 1.4 + bot.id.charCodeAt(0))) * 70}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-2">
                <Link
                  href={`/chatbot/${bot.id}`}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1 rounded-lg border py-1 text-[10px] font-semibold transition-colors",
                    isIg
                      ? "bg-pink-50 border-pink-100 text-pink-700 hover:bg-pink-100"
                      : "bg-indigo-50 border-indigo-100 text-indigo-700 hover:bg-indigo-100"
                  )}
                >
                  <Pencil className="h-2.5 w-2.5" />
                  Edit Flow
                </Link>
                <button
                  type="button"
                  onClick={() => exportBot(bot)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-indigo-50 hover:text-indigo-500 transition-colors"
                  title="Export JSON"
                >
                  <Download className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteId(bot.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setShowPlatformPicker(true)}
          disabled={creating}
          className="group flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white/60 p-4 text-center hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60 transition-all min-h-[160px]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 group-hover:bg-indigo-100 transition-colors">
            {creating ? <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin" /> : <Plus className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />}
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 group-hover:text-indigo-600 transition-colors">
              {creating ? "Creating…" : "New Chatbot"}
            </p>
            <p className="text-[10px] text-slate-300 mt-0.5">Click to create</p>
          </div>
        </button>
      </div>
    )
  } else {
    content = (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Bot Name</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Platform</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Trigger</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Runs</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((bot, idx) => {
              const active = isActive(bot)
              const isIg = (bot.channel ?? "whatsapp") === "instagram"
              return (
                <tr key={bot.id} className={cn(
                  "transition-colors group",
                  idx % 2 === 0 ? "bg-white hover:bg-indigo-50/50" : "bg-indigo-50/30 hover:bg-indigo-50/70"
                )}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", isIg ? "bg-pink-50" : "bg-indigo-50")}>
                        <Bot className={cn("h-3.5 w-3.5", isIg ? "text-pink-500" : "text-indigo-500")} />
                      </div>
                      <span className="text-[13px] font-semibold text-slate-800">{bot.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {isIg ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-pink-600">
                        <InstagramIcon className="h-3.5 w-3.5" /> Instagram
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600">
                        <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="flex items-center gap-1.5 text-[12px] text-slate-500">
                        {TRIGGER_ICONS[bot.trigger_type] ?? <Zap className="h-3 w-3" />}
                        {TRIGGER_LABELS[bot.trigger_type] ?? bot.trigger_type.replace(/_/g, " ")}
                      </span>
                      {getKeywords(bot).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {getKeywords(bot).slice(0, 5).map((kw) => (
                            <span key={kw} className="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                              {kw}
                            </span>
                          ))}
                          {getKeywords(bot).length > 5 && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">
                              +{getKeywords(bot).length - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-slate-400")} />
                      {active ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
                      <MessagesSquare className="h-3.5 w-3.5 text-slate-300" />
                      {bot.execution_count.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-[12px] text-slate-700 font-medium">
                        {bot.created_at ? format(new Date(bot.created_at), "d MMM yyyy") : "—"}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {bot.created_at ? formatDistanceToNow(new Date(bot.created_at), { addSuffix: true }) : ""}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/chatbot/${bot.id}`}
                        className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => exportBot(bot)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-indigo-50 hover:text-indigo-500 transition-colors"
                        title="Export JSON"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(bot.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <p className="text-[11px] text-slate-400">{filtered.length} chatbot{filtered.length !== 1 ? "s" : ""} total</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">

      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3.5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-sm">
              <Bot className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-slate-900 leading-tight">Chatbot</h1>
              <p className="text-[11px] text-slate-400 leading-tight">
                {loading ? "Loading…" : `${chatbots.length} bot${chatbots.length !== 1 ? "s" : ""} configured`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Channel filter */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
              {(["all", "whatsapp", "instagram"] as ChannelFilter[]).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannelFilter(ch)}
                  className={cn(
                    "flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold transition-all",
                    channelFilter === ch
                      ? "bg-white shadow-sm text-indigo-600"
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {ch === "all" && <span>All</span>}
                  {ch === "whatsapp" && <><WhatsAppIcon className="h-3 w-3" /><span>WhatsApp</span></>}
                  {ch === "instagram" && <><InstagramIcon className="h-3 w-3" /><span>Instagram</span></>}
                </button>
              ))}
            </div>

            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-all",
                  view === "grid" ? "bg-white shadow-sm text-indigo-600" : "text-slate-400 hover:text-slate-600"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setView("table")}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-all",
                  view === "table" ? "bg-white shadow-sm text-indigo-600" : "text-slate-400 hover:text-slate-600"
                )}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Hidden import file input */}
            <input
              ref={importRef}
              type="file"
              accept=".json"
              className="sr-only"
              onChange={importBot}
            />

            {/* Import button */}
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 transition-colors"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {importing ? "Importing…" : "Import"}
            </button>

            <button
              type="button"
              onClick={() => setShowPlatformPicker(true)}
              disabled={creating}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {creating ? "Creating…" : "New Chatbot"}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {content}
      </div>

      {/* Platform picker modal */}
      {showPlatformPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPlatformPicker(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400" />
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900">Choose Platform</h2>
                  <p className="text-[12px] text-slate-400 mt-0.5">Select the platform for this chatbot</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPlatformPicker(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* WhatsApp */}
                <button
                  type="button"
                  onClick={() => createNew("whatsapp")}
                  className="group flex flex-col items-center gap-3 rounded-xl border-2 border-slate-200 bg-white p-5 text-center hover:border-green-400 hover:bg-green-50/40 transition-all"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 group-hover:bg-green-100 transition-colors shadow-sm">
                    <WhatsAppIcon className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-slate-800">WhatsApp</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">Templates, lists,<br />buttons & flows</p>
                  </div>
                </button>

                {/* Instagram */}
                <button
                  type="button"
                  onClick={() => createNew("instagram")}
                  className="group flex flex-col items-center gap-3 rounded-xl border-2 border-slate-200 bg-white p-5 text-center hover:border-pink-400 hover:bg-pink-50/40 transition-all"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-50 group-hover:bg-pink-100 transition-colors shadow-sm">
                    <InstagramIcon className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-slate-800">Instagram</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">Text, images,<br />quick replies</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-rose-400 to-rose-600" />
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50">
                  <AlertTriangle className="h-4.5 w-4.5 text-rose-500" />
                </div>
                <div>
                  <h2 className="text-[14px] font-bold text-slate-900">Delete Chatbot?</h2>
                  <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">
                    This permanently deletes the chatbot and all its nodes. Cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteId(null)}
                  disabled={deleting}
                  className="flex-1 rounded-xl border border-slate-200 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => del(deleteId)}
                  disabled={deleting}
                  className="flex-1 rounded-xl bg-rose-600 py-2 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {deleting && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
