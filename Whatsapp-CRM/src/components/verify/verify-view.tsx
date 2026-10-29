"use client"

/**
 * The page a person opens from their private link: their own details from
 * the business's list, to confirm or correct. Phone-first, one column,
 * large targets; every language the business can choose, right to left
 * for Arabic. Nothing here is trusted — the server checks the link, the
 * columns that may change and the values again.
 */

import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Lock, Pencil, RotateCcw, ShieldCheck } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { langInfo, isFormLang } from "@/lib/data-store/form-i18n"
import type { ViewItem } from "@/lib/verify/sheet-verify"
import { verifyStrings } from "@/lib/verify/verify-strings"

type Props =
  | { mode: "message"; lang: string; business: string; message: string; retry?: boolean }
  | {
      mode: "form"
      token: string
      lang: string
      business: string
      intro: string | null
      deadline: string
      items: ViewItem[]
      done: boolean
    }

export function VerifyView(props: Props) {
  const t = verifyStrings(props.lang)
  const rtl = isFormLang(props.lang) && langInfo(props.lang).rtl
  return (
    <div lang={props.lang} dir={rtl ? "rtl" : "ltr"} className="min-h-dvh bg-slate-50 px-4 py-6 sm:py-10">
      <main className="mx-auto w-full max-w-lg">
        {props.business && <p className="mb-3 text-center text-[13px] font-medium text-slate-500" dir="auto">{props.business}</p>}
        {props.mode === "message" ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <AlertCircle className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
            <p className="mt-3 text-[15px] leading-relaxed text-slate-700">{props.message}</p>
            {props.retry && (
              <button type="button" onClick={() => window.location.reload()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-[14px] font-medium text-slate-700 hover:bg-slate-50">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t.reload}
              </button>
            )}
          </div>
        ) : (
          <DetailsForm {...props} />
        )}
      </main>
    </div>
  )
}

function DetailsForm(props: Extract<Props, { mode: "form" }>) {
  const t = verifyStrings(props.lang)
  const [items, setItems] = useState(props.items)
  const [done, setDone] = useState<null | "verified" | "corrected">(props.done ? "verified" : null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<null | "confirm" | "correct">(null)
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null)
  const canEdit = items.some((i) => i.editable)

  // "Opened" is reported from here, once the page is really on a screen —
  // a mail or link scanner fetching the address runs no script.
  useEffect(() => {
    if (props.done) return
    void fetch(`/api/v/${encodeURIComponent(props.token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "opened" }),
    }).catch(() => {})
  }, [props.token, props.done])

  function startEdit() {
    setDraft(Object.fromEntries(items.filter((i) => i.editable).map((i) => [i.header, i.value])))
    setEditing(true)
    setError(null)
  }

  async function send(action: "confirm" | "correct") {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      const values: Record<string, string> = {}
      const seen: Record<string, string> = {}
      if (action === "correct") {
        for (const i of items) {
          if (!i.editable) continue
          if ((draft[i.header] ?? "").trim() !== i.value.trim()) {
            values[i.header] = draft[i.header] ?? ""
            seen[i.header] = i.value
          }
        }
      }
      const res = await apiFetch(`/api/v/${encodeURIComponent(props.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, values, seen }),
      })
      const d = (await res.json()) as { state?: "verified" | "corrected"; items?: ViewItem[] }
      if (Array.isArray(d.items)) setItems(d.items)
      setDone(d.state ?? "verified")
      setEditing(false)
    } catch (err) {
      console.error("[verify] save failed:", err)
      const text = errorText(err, t.error)
      setError({ text, stale: /reload|updated/i.test(text) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 pb-4 pt-5">
        <h1 className="text-[20px] font-semibold leading-snug text-slate-900">{t.title}</h1>
        {done ? (
          <p role="status" className="mt-2 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[14px] text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {done === "corrected" ? t.thanksCorrected : props.done && !busy ? t.already : t.thanks}
          </p>
        ) : (
          <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-slate-600" dir="auto">{props.intro || t.intro}</p>
        )}
        {props.deadline && !done && <p className="mt-2 text-[12.5px] font-medium text-amber-700">{t.by(props.deadline)}</p>}
      </div>

      <dl className="divide-y divide-slate-100">
        {items.map((i) => {
          const id = `v-${i.header.replace(/\W+/g, "-")}`
          return (
            <div key={i.header} className="px-5 py-3.5">
              <dt className="text-[12px] font-medium text-slate-500" dir="auto">
                {editing && i.editable ? <label htmlFor={id}>{i.header}</label> : i.header}
              </dt>
              <dd className="mt-1">
                {editing && i.editable ? (
                  <input
                    id={id}
                    value={draft[i.header] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [i.header]: e.target.value }))}
                    maxLength={200}
                    autoComplete="off"
                    dir="auto"
                    className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[16px] text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
                  />
                ) : (
                  <span className="flex items-center gap-1.5 break-words text-[16px] text-slate-900" dir="auto">
                    {i.value || <span className="text-slate-400">—</span>}
                    {!i.editable && /•/.test(i.value) && <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label={t.hidden} />}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      <div className="flex flex-col gap-2.5 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
        {error && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[13.5px] text-rose-700">
            <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error.text}</span>
            {error.stale && (
              <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-10 items-center gap-2 self-start rounded-lg bg-white px-3 text-[13px] font-medium text-rose-700 ring-1 ring-rose-200">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t.reload}
              </button>
            )}
          </div>
        )}
        {editing ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-slate-500">{t.editHint(props.business || "us")}</p>
            <button type="button" onClick={() => send("correct")} disabled={!!busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
              {busy === "correct" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {busy === "correct" ? t.saving : t.save}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError(null) }} disabled={!!busy} className="min-h-11 rounded-xl text-[14px] font-medium text-slate-600 hover:bg-slate-100">
              {t.cancel}
            </button>
          </>
        ) : (
          <>
            {!done && (
              <button type="button" onClick={() => send("confirm")} disabled={!!busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
                {busy === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                {busy === "confirm" ? t.saving : t.allCorrect}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={startEdit} disabled={!!busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60">
                <Pencil className="h-4 w-4" aria-hidden="true" /> {done ? t.correctAgain : t.fix}
              </button>
            )}
          </>
        )}
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[11.5px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {props.business}
        </p>
      </div>
    </div>
  )
}
