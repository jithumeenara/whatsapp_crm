"use client"

import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import { Sparkles, Plus, Trash2, Loader2, MessageCircleQuestion, Link as LinkIcon, Menu as MenuIcon } from "lucide-react"

interface IceBreaker { question: string; payload: string }
type MenuItem =
  | { title: string; payload: string }
  | { title: string; type: "web_url"; url: string }

const MAX_ICE_BREAKERS = 4
const MAX_MENU_ITEMS = 3

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

export function InstagramIceBreakers() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [iceBreakers, setIceBreakers] = useState<IceBreaker[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/instagram/ice-breakers").then((x) => x.json())
      setHasToken(Boolean(r.has_token))
      setIceBreakers(r.ice_breakers ?? [])
      setMenuItems(r.persistent_menu ?? [])
      setSyncedAt(r.profile_synced_at ?? null)
    } catch {
      toast.error("Failed to load ice breakers")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function addIceBreaker() {
    if (iceBreakers.length >= MAX_ICE_BREAKERS) return
    setIceBreakers((prev) => [...prev, { question: "", payload: "" }])
  }
  function addMenuItem() {
    if (menuItems.length >= MAX_MENU_ITEMS) return
    setMenuItems((prev) => [...prev, { title: "", payload: "" }])
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/instagram/ice-breakers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ice_breakers: iceBreakers, persistent_menu: menuItems }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || "Failed to sync to Instagram."); return }
      toast.success("Synced to Instagram.")
      load()
    } catch {
      toast.error("Failed — network error.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F8]">
          <Sparkles className="h-4.5 w-4.5 text-[#D946A6]" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">Ice Breakers &amp; Persistent Menu</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Starter prompts and a menu shown by Instagram itself the first time a customer opens your DM thread — no ongoing engineering, just one sync.
          </p>
        </div>
      </div>

      {!hasToken ? (
        <div className="px-6 py-8 text-center text-[13px] text-slate-500">
          Connect Instagram above first — ice breakers need a working access token.
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {/* Ice Breakers */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                <MessageCircleQuestion className="h-3.5 w-3.5 text-slate-400" />
                Ice Breakers
                <span className="text-[11px] font-normal text-slate-400">({iceBreakers.length}/{MAX_ICE_BREAKERS})</span>
              </div>
              <button
                type="button"
                onClick={addIceBreaker}
                disabled={iceBreakers.length >= MAX_ICE_BREAKERS}
                className="flex items-center gap-1 text-[12px] font-semibold text-[#D946A6] hover:text-[#b93a89] disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {iceBreakers.length === 0 && (
                <p className="text-[12px] text-slate-400">No ice breakers yet — add up to {MAX_ICE_BREAKERS} tappable starter questions.</p>
              )}
              {iceBreakers.map((ib, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input autoComplete="off"
                    value={ib.question}
                    onChange={(e) => setIceBreakers((prev) => prev.map((x, j) => j === i ? { ...x, question: e.target.value } : x))}
                    placeholder="What are your store hours?"
                    maxLength={80}
                    className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-100"
                  />
                  <input autoComplete="off"
                    value={ib.payload}
                    onChange={(e) => setIceBreakers((prev) => prev.map((x, j) => j === i ? { ...x, payload: e.target.value } : x))}
                    placeholder="STORE_HOURS"
                    className="h-9 w-40 rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-[12px] text-slate-600 focus:outline-none focus:ring-2 focus:ring-pink-100"
                  />
                  <button type="button" onClick={() => setIceBreakers((prev) => prev.filter((_, j) => j !== i))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {iceBreakers.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {iceBreakers.filter((ib) => ib.question).map((ib, i) => (
                  <span key={i} className="rounded-full border border-pink-100 bg-pink-50 px-3 py-1.5 text-[12px] font-medium text-[#b93a89]">
                    {ib.question}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Persistent Menu */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                <MenuIcon className="h-3.5 w-3.5 text-slate-400" />
                Persistent Menu
                <span className="text-[11px] font-normal text-slate-400">({menuItems.length}/{MAX_MENU_ITEMS})</span>
              </div>
              <button
                type="button"
                onClick={addMenuItem}
                disabled={menuItems.length >= MAX_MENU_ITEMS}
                className="flex items-center gap-1 text-[12px] font-semibold text-[#D946A6] hover:text-[#b93a89] disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {menuItems.length === 0 && (
                <p className="text-[12px] text-slate-400">No menu items yet — up to {MAX_MENU_ITEMS}, each a reply payload or a link.</p>
              )}
              {menuItems.map((item, i) => {
                const isLink = "type" in item && item.type === "web_url"
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input autoComplete="off"
                      value={item.title}
                      onChange={(e) => setMenuItems((prev) => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                      placeholder="View Catalog"
                      maxLength={30}
                      className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-100"
                    />
                    <button
                      type="button"
                      onClick={() => setMenuItems((prev) => prev.map((x, j) => {
                        if (j !== i) return x
                        return isLink ? { title: x.title, payload: "" } : { title: x.title, type: "web_url", url: "" }
                      }))}
                      className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                      title="Toggle payload / link"
                    >
                      <LinkIcon className="h-3 w-3" /> {isLink ? "Link" : "Payload"}
                    </button>
                    {isLink ? (
                      <input autoComplete="off"
                        value={(item as { url: string }).url}
                        onChange={(e) => setMenuItems((prev) => prev.map((x, j) => j === i ? { ...x, url: e.target.value } as MenuItem : x))}
                        placeholder="https://example.com/catalog"
                        className="h-9 w-56 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[12px] text-slate-600 focus:outline-none focus:ring-2 focus:ring-pink-100"
                      />
                    ) : (
                      <input autoComplete="off"
                        value={(item as { payload: string }).payload}
                        onChange={(e) => setMenuItems((prev) => prev.map((x, j) => j === i ? { ...x, payload: e.target.value } as MenuItem : x))}
                        placeholder="VIEW_CATALOG"
                        className="h-9 w-40 rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-[12px] text-slate-600 focus:outline-none focus:ring-2 focus:ring-pink-100"
                      />
                    )}
                    <button type="button" onClick={() => setMenuItems((prev) => prev.filter((_, j) => j !== i))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[#D946A6] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#b93a89] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {saving ? "Syncing…" : "Sync to Instagram"}
            </button>
            {syncedAt && <p className="text-[11px] text-slate-400">Last synced {relativeTime(syncedAt)}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
