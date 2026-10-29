"use client"

/**
 * Everyone on a "check details" list, read from the sheet: who confirmed,
 * corrected, opened, has not opened, and who the messages did not reach
 * — with the reason — so staff can send by SMS or email, or call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Loader2, Mail, MessageCircle, MessageSquare, Phone, RefreshCw, Search, ShieldOff, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { everyWhileVisible } from "@/lib/visible-interval"

interface Send { status: string | null; error: string | null }
interface Person {
  ref: string
  rowNumber: number
  name: string
  phone: string | null
  email: string | null
  state: string
  wa: Send
  sms: Send
  email_send: Send
  cannot: string | null
  duplicate: boolean
  send_count: number
  sheet_status: string
}

type Filter = "all" | "done" | "opened" | "waiting" | "not_reached"

const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  verified: { text: "Confirmed", cls: "bg-emerald-50 text-emerald-700" },
  corrected: { text: "Corrected", cls: "bg-sky-50 text-sky-700" },
  phone: { text: "Confirmed by phone", cls: "bg-emerald-50 text-emerald-700" },
  opened: { text: "Opened", cls: "bg-amber-50 text-amber-800" },
  pending: { text: "Not opened", cls: "bg-slate-100 text-slate-600" },
}

const done = (p: Person) => p.state === "verified" || p.state === "corrected" || p.state === "phone"
const notReached = (p: Person) => !done(p) && (!!p.cannot || p.wa.status === "failed") && p.sms.status !== "sent" && p.email_send.status !== "sent"

function SendBadge({ icon: Icon, send, label }: { icon: typeof Mail; send: Send; label: string }) {
  if (!send.status) return null
  const failed = send.status === "failed"
  return (
    <span title={send.error ?? undefined} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] ${failed ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
      <Icon className="h-3 w-3" aria-hidden="true" /> <span className="sr-only">{label}:</span> {failed ? "failed" : send.status}
    </span>
  )
}

export function VerifyPeople({ id, spreadsheetId }: { id: string; spreadsheetId: string }) {
  const { accountRole } = useAuth()
  const admin = hasMinRole(accountRole ?? "viewer", "admin")
  const [people, setPeople] = useState<Person[] | null>(null)
  const [missing, setMissing] = useState(0)
  const [shared, setShared] = useState(0)
  const [tooMany, setTooMany] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [ask, setAsk] = useState<null | { title: string; description: string; label: string; run: () => Promise<void>; destructive?: boolean }>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const res = await apiFetch(`/api/sheet-verifications/${id}/people`, { cache: "no-store" })
      const d = (await res.json()) as { people?: Person[]; missing_refs?: number; shared_refs?: number; too_many?: boolean; last_send_error?: string | null; sending?: boolean }
      if (seq !== loadSeq.current) return
      setPeople(Array.isArray(d.people) ? d.people : [])
      setMissing(d.missing_refs ?? 0)
      setShared(d.shared_refs ?? 0)
      setTooMany(!!d.too_many)
      setSendError(d.last_send_error ?? null)
      setSending(!!d.sending)
      setError(null)
    } catch (err) {
      console.error("[verify-people] load failed:", err)
      if (seq === loadSeq.current) { setPeople((p) => p ?? []); setError(errorText(err, "Could not read the sheet")) }
    }
  }, [id])

  useEffect(() => { void load() }, [load])
  // While a send runs, its progress shows; otherwise every minute. Each
  // look reads the Google Sheet, which Google allows only so often.
  useEffect(() => everyWhileVisible(() => { void load() }, sending ? 10_000 : 60_000), [load, sending])

  async function act(key: string, body: Record<string, unknown>, ok: (d: Record<string, unknown>) => string) {
    if (busy) return
    setBusy(key)
    try {
      const res = await apiFetch(`/api/sheet-verifications/${id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = (await res.json()) as Record<string, unknown>
      toast.success(ok(d))
      await load()
    } catch (err) {
      console.error("[verify-people] action failed:", err)
      toast.error(errorText(err, "That did not work"))
    } finally {
      setBusy(null)
    }
  }

  async function copyLink(ref: string) {
    try {
      const res = await apiFetch(`/api/sheet-verifications/${id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "link", ref }) })
      const d = (await res.json()) as { link?: string }
      if (!d.link) throw new Error("No link came back.")
      await navigator.clipboard.writeText(d.link)
      toast.success("Link copied — send it only to this person")
    } catch (err) {
      console.error("[verify-people] link failed:", err)
      toast.error(errorText(err, "Could not copy the link"))
    }
  }

  const list = people ?? []
  const counts = useMemo(() => ({
    all: list.length,
    done: list.filter(done).length,
    opened: list.filter((p) => p.state === "opened").length,
    waiting: list.filter((p) => p.state === "pending" && !notReached(p)).length,
    not_reached: list.filter(notReached).length,
  }), [list])
  const pendingCount = list.filter((p) => !done(p)).length
  const shown = list.filter((p) => {
    if (filter === "done" && !done(p)) return false
    if (filter === "opened" && p.state !== "opened") return false
    if (filter === "waiting" && !(p.state === "pending" && !notReached(p))) return false
    if (filter === "not_reached" && !notReached(p)) return false
    const q = query.trim().toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q)
  })

  const send = (channel: "whatsapp" | "sms" | "email", scope: "pending" | "not_reached") => {
    const n = scope === "pending" ? pendingCount : counts.not_reached
    const via = channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : "email"
    setAsk({
      title: `Send ${n} link${n === 1 ? "" : "s"} by ${via}?`,
      description: `${scope === "pending" ? "Everyone who has not confirmed or corrected yet" : "Everyone WhatsApp did not reach"} gets their own private link. ${channel === "whatsapp" ? "Each WhatsApp template message is charged by Meta. " : channel === "sms" ? "Each SMS is charged by your SMS provider. " : ""}The same number twice gets one message.`,
      label: "Send",
      run: () => act(`send-${channel}`, { action: "send", channel, scope }, (d) => `Sending ${d.queued ?? ""} — this list updates as they go`),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

      {admin && (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          {sendError && !sending && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> The last send stopped: {sendError}
            </p>
          )}
          {tooMany && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> This tab has more than 2000 rows; only the first 2000 are read. Use “Only rows where” in Settings to check it in parts.
            </p>
          )}
          {shared > 0 && (
            <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {shared} reference{shared === 1 ? " is" : "s are"} on more than one row — rows copied with their Verify ref. Press “Get the sheet ready” to give each its own; those people need their new link.
            </p>
          )}
          {missing > 0 && (
            <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {missing} row{missing === 1 ? "" : "s"} have no reference yet (new rows, or the first time). Get the sheet ready before sending.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => act("prepare", { action: "prepare" }, (d) => `Sheet ready — ${Number(d.added ?? 0)} new reference${d.added === 1 ? "" : "s"}${Number(d.replaced ?? 0) ? `, ${Number(d.replaced)} copied one${d.replaced === 1 ? "" : "s"} replaced` : ""}`)} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {busy === "prepare" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />} Get the sheet ready
            </button>
            <button type="button" onClick={() => send("whatsapp", "pending")} disabled={!!busy || sending || !pendingCount || missing > 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Send on WhatsApp ({pendingCount})
            </button>
            <button type="button" onClick={() => send("sms", "not_reached")} disabled={!!busy || sending || !counts.not_reached} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> SMS to not reached
            </button>
            <button type="button" onClick={() => send("email", "not_reached")} disabled={!!busy || sending || !counts.not_reached} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Email to not reached
            </button>
            <a href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-100">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open the sheet
            </a>
            <button type="button" onClick={() => setAsk({ title: "Cancel every link sent so far?", description: "Links already sent stop working at once. Send again to give people new ones. Their answers so far stay.", label: "Cancel links", destructive: true, run: () => act("revoke", { action: "revoke" }, () => "All earlier links cancelled") })} disabled={!!busy} className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" /> Cancel all links
            </button>
          </div>
          {sending && <p role="status" className="flex items-center gap-2 text-[12.5px] text-slate-600"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Sending… this list updates as it goes.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1">
          {([["all", "All"], ["done", "Done"], ["opened", "Opened"], ["waiting", "Not opened"], ["not_reached", "Not reached"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={`h-8 rounded-full px-3 text-[12.5px] font-medium tabular-nums ${filter === k ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
              {label} {counts[k]}
            </button>
          ))}
        </div>
        <label className="relative ms-auto">
          <span className="sr-only">Find a person</span>
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or reference…" autoComplete="off" name="verify-search" className="h-8 w-44 rounded-lg border border-slate-200 bg-white ps-8 pe-3 text-[13px] outline-none focus:border-primary" />
        </label>
        <button type="button" onClick={() => void load()} aria-label="Read the sheet again" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>

      {people === null ? (
        <div className="h-32 animate-pulse rounded-2xl bg-white" />
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-[13px] text-slate-500">{list.length ? "Nobody here." : "No rows found in this sheet yet. Check the tab and the “Only rows where” setting."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {shown.map((p) => {
            const st = STATE_LABEL[p.state] ?? STATE_LABEL.pending
            return (
              <li key={p.ref} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate text-[14px] font-medium text-slate-900">{p.name || "(no name)"}</span>
                  <span className="block truncate text-[12px] tabular-nums text-slate-500">
                    {p.ref} · row {p.rowNumber}{p.phone ? ` · ${p.phone}` : ""}{p.duplicate ? " · same number as another row" : ""}
                  </span>
                  {(p.cannot || p.wa.error) && !done(p) && <span className="mt-0.5 block text-[12px] text-rose-700">{p.cannot ?? p.wa.error}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${st.cls}`}>{st.text}</span>
                  <SendBadge icon={MessageCircle} send={p.wa} label="WhatsApp" />
                  <SendBadge icon={MessageSquare} send={p.sms} label="SMS" />
                  <SendBadge icon={Mail} send={p.email_send} label="Email" />
                </span>
                <span className="flex items-center gap-1">
                  {!done(p) && (
                    <button type="button" onClick={() => setAsk({ title: `Confirmed on a call with ${p.name || "this person"}?`, description: "Their row is marked “Verified by phone” with your name and the time. Make any corrections in the sheet yourself.", label: "Mark confirmed", run: () => act(`phone-${p.ref}`, { action: "phone", ref: p.ref }, () => "Marked confirmed by phone") })} disabled={!!busy} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Confirmed by phone
                    </button>
                  )}
                  {admin && (
                    <button type="button" onClick={() => copyLink(p.ref)} aria-label={`Copy ${p.name || "this person"}'s link`} title="Copy their private link" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {done(p) && <Check className="h-4 w-4 text-emerald-600" aria-label="Done" />}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <p className="flex items-center gap-1.5 text-[11.5px] text-slate-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Names and numbers are read from your sheet each time and are not stored in the CRM.</p>

      <ConfirmDialog
        open={!!ask}
        title={ask?.title ?? ""}
        description={ask?.description}
        confirmLabel={ask?.label}
        variant={ask?.destructive ? "destructive" : "default"}
        onCancel={() => setAsk(null)}
        onConfirm={() => { const run = ask?.run; setAsk(null); if (run) void run() }}
      />
    </div>
  )
}
