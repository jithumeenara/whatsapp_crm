"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, RefreshCw, Trash2, FileText } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface Template { id: string; name: string; language: string; body: string; param_count: number; status: string; reject_reason: string | null }

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
}

/** Messenger utility templates: create, check approval, remove (admins). */
export function MessengerTemplates() {
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [language, setLanguage] = useState("en_US")
  const [body, setBody] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    try {
      const r = (await (await apiFetch(`/api/facebook/templates${refresh ? "?refresh=1" : ""}`)).json()) as { templates?: Template[] }
      setItems(Array.isArray(r.templates) ? r.templates : [])
    } catch (err) {
      console.error("[messenger templates] load failed:", err)
      toast.error(errorText(err, "Could not load templates."))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function create() {
    if (saving) return
    setSaving(true)
    try {
      await apiFetch("/api/facebook/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, language, body }) })
      toast.success("Template sent to Meta for approval.")
      setName(""); setBody("")
      await load(true)
    } catch (err) {
      console.error("[messenger templates] create failed:", err)
      toast.error(errorText(err, "Could not create the template."))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/facebook/templates/${id}`, { method: "DELETE" })
      toast.success("Template removed.")
      await load()
    } catch (err) {
      console.error("[messenger templates] delete failed:", err)
      toast.error(errorText(err, "Could not remove the template."))
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0866FF]"><FileText className="h-4.5 w-4.5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-slate-800">Messenger templates</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Updates you can send after the 24-hour window — an order, a booking, a reminder. Meta approves each template; promotions are not allowed.
          </p>
        </div>
        <Button size="sm" variant="ghost" disabled={refreshing} onClick={() => void load(true)} aria-label="Check approval status">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
        </Button>
      </div>

      <div className="space-y-5 p-6">
        {loading ? (
          <div className="flex justify-center py-6 text-slate-400" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></div>
        ) : items.length === 0 ? (
          <p className="text-[12.5px] text-slate-500">No templates yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((t) => (
              <li key={t.id} className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-slate-800">
                    <span className="font-mono">{t.name}</span> <span className="text-[11px] font-normal text-slate-400">{t.language}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[t.status] ?? "bg-slate-100 text-slate-600"}`}>{t.status}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] text-slate-600">{t.body}</p>
                  {t.reject_reason && <p className="mt-0.5 text-[11.5px] text-rose-700">Meta: {t.reject_reason}</p>}
                </div>
                <button type="button" onClick={() => setDeleteId(t.id)} aria-label={`Remove ${t.name}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-2">
            <label className="min-w-0 flex-1">
              <span className="text-[12px] text-slate-600">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} maxLength={60} autoComplete="off" spellCheck={false}
                placeholder="order_update" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 font-mono text-[13px]" />
            </label>
            <label>
              <span className="text-[12px] text-slate-600">Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2 text-[13px]">
                <option value="en_US">English</option>
                <option value="ml_IN">Malayalam</option>
                <option value="hi_IN">Hindi</option>
                <option value="ta_IN">Tamil</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[12px] text-slate-600">Message — use {"{{1}}"}, {"{{2}}"} for the parts that change</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} rows={3} autoComplete="off"
              placeholder="Hi {{1}}, your appointment on {{2}} is confirmed."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
          </label>
          <Button size="sm" disabled={saving || !name || !body.trim()} onClick={() => void create()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />} Create template
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="Remove this template?"
        description="It is removed at Meta too and can no longer be sent."
        confirmLabel="Remove"
        variant="destructive"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => { const id = deleteId; setDeleteId(null); if (id) void remove(id) }}
      />
    </div>
  )
}

/** In the Inbox, when a Messenger chat is past 24 hours: send an approved template. */
export function MessengerTemplateSender({ conversationId }: { conversationId: string }) {
  const [items, setItems] = useState<Template[] | null>(null)
  const [chosen, setChosen] = useState("")
  const [values, setValues] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch("/api/facebook/templates")
      .then((r) => r.json())
      .then((b: { templates?: Template[] }) => { if (!cancelled) setItems((Array.isArray(b.templates) ? b.templates : []).filter((t) => t.status === "approved")) })
      .catch((err) => { console.error("[messenger templates] list failed:", err); if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [])

  const t = items?.find((x) => x.id === chosen) ?? null
  if (!items || items.length === 0) return null

  async function send() {
    if (!t || sending) return
    setSending(true)
    try {
      await apiFetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message_type: "messenger_template", messenger_template_id: t.id, template_params: values }),
      })
      toast.success("Template sent.")
      setChosen(""); setValues([])
    } catch (err) {
      console.error("[messenger templates] send failed:", err)
      toast.error(errorText(err, "Could not send the template."))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-[12px] text-amber-900">
        <span className="sr-only">Template</span>
        <select value={chosen} onChange={(e) => { setChosen(e.target.value); const n = items.find((x) => x.id === e.target.value)?.param_count ?? 0; setValues(Array(n).fill("")) }}
          className="h-8 rounded-md border border-amber-200 bg-white px-2 text-[12.5px]">
          <option value="">Send an update template…</option>
          {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      {t && values.map((v, i) => (
        <input key={i} value={v} onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? e.target.value : x)))} maxLength={500} autoComplete="off"
          aria-label={`Blank ${i + 1}`} placeholder={`{{${i + 1}}}`} className="h-8 w-32 rounded-md border border-amber-200 bg-white px-2 text-[12.5px]" />
      ))}
      {t && (
        <Button size="sm" disabled={sending || values.some((v) => !v.trim())} onClick={() => void send()}>
          {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Send
        </Button>
      )}
    </div>
  )
}
