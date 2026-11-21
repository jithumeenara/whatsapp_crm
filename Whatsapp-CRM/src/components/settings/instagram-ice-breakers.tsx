"use client"

import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import { Sparkles, Plus, Trash2, Loader2, MessageCircleQuestion, Link as LinkIcon, Menu as MenuIcon, Hand } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"

interface IceBreaker { question: string; payload: string }
type MenuItem =
  | { title: string; payload: string }
  | { title: string; type: "web_url"; url: string }

type Channel = "instagram" | "facebook"

const MAX_ICE_BREAKERS = 4
const MAX_MENU_ITEMS = 3
const MAX_GREETING = 160

const CHANNEL = {
  instagram: { api: "/api/instagram/ice-breakers", name: "Instagram", accent: "text-[#D946A6] hover:text-[#b93a89]", button: "bg-[#D946A6] hover:bg-[#b93a89]", chip: "border-pink-100 bg-pink-50 text-[#b93a89]", icon: "bg-[#FFF0F8] text-[#D946A6]" },
  facebook: { api: "/api/facebook/messenger-profile", name: "Messenger", accent: "text-[#0866FF] hover:text-[#0653cc]", button: "bg-[#0866FF] hover:bg-[#0653cc]", chip: "border-blue-100 bg-blue-50 text-[#0653cc]", icon: "bg-blue-50 text-[#0866FF]" },
} as const

const inputCls = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"

function relativeTime(iso?: string | null) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Instagram ice breakers + menu. */
export function InstagramIceBreakers() {
  return <ChatStarters channel="instagram" />
}

/** Messenger greeting, Get Started, ice breakers + menu. */
export function MessengerProfileSettings() {
  return <ChatStarters channel="facebook" />
}

function ChatStarters({ channel }: { channel: Channel }) {
  const c = CHANNEL[channel]
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [iceBreakers, setIceBreakers] = useState<IceBreaker[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [greeting, setGreeting] = useState("")
  const [getStarted, setGetStarted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const r = await (await apiFetch(c.api)).json()
      setHasToken(Boolean(r.has_token))
      setIceBreakers(Array.isArray(r.ice_breakers) ? r.ice_breakers : [])
      setMenuItems(Array.isArray(r.persistent_menu) ? r.persistent_menu : [])
      setGreeting(typeof r.greeting === "string" ? r.greeting : "")
      setGetStarted(r.get_started === true)
      setSyncedAt(r.profile_synced_at ?? null)
    } catch (err) {
      console.error(`[${channel} chat starters] load failed:`, err)
      setLoadFailed(true)
      toast.error(errorText(err, "Could not load the chat starters."))
    } finally {
      setLoading(false)
    }
  }, [c.api, channel])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await apiFetch(c.api, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ice_breakers: iceBreakers, persistent_menu: menuItems, ...(channel === "facebook" ? { greeting, get_started: getStarted } : {}) }),
      })
      toast.success(`Saved to ${c.name}.`)
      await load()
    } catch (err) {
      console.error(`[${channel} chat starters] save failed:`, err)
      toast.error(errorText(err, `Could not save to ${c.name}.`))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400" role="status" aria-label="Loading">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.icon}`}>
          <Sparkles className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">Chat starters &amp; menu</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {channel === "facebook"
              ? "What Messenger shows before a customer types: a greeting, a Get Started button, starter questions and a menu."
              : "Starter questions and a menu Instagram shows when a customer opens your chat."}
          </p>
        </div>
      </div>

      {loadFailed ? (
        <div className="px-6 py-8 text-center text-[13px] text-slate-500">
          Could not load these settings.{" "}
          <button type="button" onClick={load} className={`font-semibold ${c.accent}`}>Try again</button>
        </div>
      ) : !hasToken ? (
        <div className="px-6 py-8 text-center text-[13px] text-slate-500">
          Connect {c.name} above first.
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {channel === "facebook" && (
            <div className="space-y-3">
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                  <Hand className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Greeting
                  <span className="text-[11px] font-normal text-slate-400">({greeting.length}/{MAX_GREETING})</span>
                </span>
                <textarea
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  maxLength={MAX_GREETING}
                  rows={2}
                  autoComplete="off"
                  placeholder="Hi! Ask us anything — we usually reply within an hour."
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                />
              </label>
              <label className="flex items-center gap-2 text-[13px] text-slate-700">
                <input
                  type="checkbox"
                  checked={getStarted || menuItems.length > 0}
                  disabled={menuItems.length > 0}
                  onChange={(e) => setGetStarted(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Show a Get Started button
                {menuItems.length > 0 && <span className="text-[11px] text-slate-400">(needed for the menu)</span>}
              </label>
            </div>
          )}

          {/* Ice breakers */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                <MessageCircleQuestion className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                Starter questions
                <span className="text-[11px] font-normal text-slate-400">({iceBreakers.length}/{MAX_ICE_BREAKERS})</span>
              </div>
              <button
                type="button"
                onClick={() => setIceBreakers((prev) => prev.length >= MAX_ICE_BREAKERS ? prev : [...prev, { question: "", payload: "" }])}
                disabled={iceBreakers.length >= MAX_ICE_BREAKERS}
                className={`flex items-center gap-1 text-[12px] font-semibold disabled:opacity-40 ${c.accent}`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {iceBreakers.length === 0 && (
                <p className="text-[12px] text-slate-400">None yet — add up to {MAX_ICE_BREAKERS} questions customers can tap.</p>
              )}
              {iceBreakers.map((ib, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input autoComplete="off"
                    aria-label={`Question ${i + 1}`}
                    value={ib.question}
                    onChange={(e) => setIceBreakers((prev) => prev.map((x, j) => j === i ? { ...x, question: e.target.value } : x))}
                    placeholder="What are your opening hours?"
                    maxLength={80}
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                  <input autoComplete="off" spellCheck={false}
                    aria-label={`Reply code for question ${i + 1}`}
                    value={ib.payload}
                    onChange={(e) => setIceBreakers((prev) => prev.map((x, j) => j === i ? { ...x, payload: e.target.value } : x))}
                    placeholder="OPENING_HOURS"
                    maxLength={200}
                    className={`${inputCls} w-40 bg-slate-50 font-mono text-[12px]`}
                  />
                  <button type="button" onClick={() => setIceBreakers((prev) => prev.filter((_, j) => j !== i))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500" aria-label={`Remove question ${i + 1}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            {iceBreakers.some((ib) => ib.question) && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Preview">
                {iceBreakers.filter((ib) => ib.question).map((ib, i) => (
                  <span key={i} className={`rounded-full border px-3 py-1.5 text-[12px] font-medium break-words ${c.chip}`}>
                    {ib.question}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Persistent menu */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                <MenuIcon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                Menu
                <span className="text-[11px] font-normal text-slate-400">({menuItems.length}/{MAX_MENU_ITEMS})</span>
              </div>
              <button
                type="button"
                onClick={() => setMenuItems((prev) => prev.length >= MAX_MENU_ITEMS ? prev : [...prev, { title: "", payload: "" }])}
                disabled={menuItems.length >= MAX_MENU_ITEMS}
                className={`flex items-center gap-1 text-[12px] font-semibold disabled:opacity-40 ${c.accent}`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {menuItems.length === 0 && (
                <p className="text-[12px] text-slate-400">None yet — up to {MAX_MENU_ITEMS} items, each a reply code or an https link.</p>
              )}
              {menuItems.map((item, i) => {
                const isLink = "type" in item && item.type === "web_url"
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input autoComplete="off"
                      aria-label={`Menu item ${i + 1} title`}
                      value={item.title}
                      onChange={(e) => setMenuItems((prev) => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                      placeholder="See our services"
                      maxLength={30}
                      className={`${inputCls} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => setMenuItems((prev) => prev.map((x, j) => {
                        if (j !== i) return x
                        return isLink ? { title: x.title, payload: "" } : { title: x.title, type: "web_url", url: "" }
                      }))}
                      className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                      aria-label={`Menu item ${i + 1}: switch between reply code and link`}
                    >
                      <LinkIcon className="h-3 w-3" aria-hidden /> {isLink ? "Link" : "Reply code"}
                    </button>
                    {isLink ? (
                      <input autoComplete="off" spellCheck={false} type="url" inputMode="url"
                        aria-label={`Menu item ${i + 1} link`}
                        value={(item as { url: string }).url}
                        onChange={(e) => setMenuItems((prev) => prev.map((x, j) => j === i ? { ...x, url: e.target.value } as MenuItem : x))}
                        placeholder="https://example.com/services"
                        maxLength={500}
                        className={`${inputCls} w-56 bg-slate-50 text-[12px]`}
                      />
                    ) : (
                      <input autoComplete="off" spellCheck={false}
                        aria-label={`Menu item ${i + 1} reply code`}
                        value={(item as { payload: string }).payload}
                        onChange={(e) => setMenuItems((prev) => prev.map((x, j) => j === i ? { ...x, payload: e.target.value } as MenuItem : x))}
                        placeholder="SERVICES"
                        maxLength={200}
                        className={`${inputCls} w-40 bg-slate-50 font-mono text-[12px]`}
                      />
                    )}
                    <button type="button" onClick={() => setMenuItems((prev) => prev.filter((_, j) => j !== i))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500" aria-label={`Remove menu item ${i + 1}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50 ${c.button}`}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
              {saving ? "Saving…" : `Save to ${c.name}`}
            </button>
            {syncedAt && <p className="text-[11px] text-slate-400">Last saved {relativeTime(syncedAt)}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
