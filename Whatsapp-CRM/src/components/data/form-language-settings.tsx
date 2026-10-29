"use client"

/**
 * Public form settings: the language the questions are written in, the
 * others the form offers, and the business's own translations — filled by
 * AI on request, always editable. A translation whose original has
 * changed is marked "Check again" and is not shown on the form until it
 * is checked.
 */

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, ChevronDown, Languages, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { apiFetch, errorText } from "@/lib/api-fetch"
import {
  FORM_LANGS,
  MAX_EXTRA_LANGS,
  formLangList,
  langInfo,
  type CopyEntry,
  type CopySource,
  type FormCopy,
  type FormLang,
  type FormLanguages,
} from "@/lib/data-store/form-i18n"
import { FORM_STRINGS, UI_TEXT_KEYS } from "./form-strings"

const FIELD =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"

const LONG = /^(intro|success|consent|help:)/

type Show = "all" | "missing" | "check"

export function LanguageSettings({
  tableId, languages, copy, savedVersion, onLanguages, onEntries,
}: {
  tableId: string
  languages: FormLanguages
  copy: FormCopy
  /** Changes after each save, so the list of texts is read again. */
  savedVersion: number
  onLanguages(l: FormLanguages): void
  /** One language's translations, from the latest ones (never a stale copy). */
  onEntries(lang: FormLang, update: (prev: Record<string, CopyEntry>) => Record<string, CopyEntry>): void
}) {
  const [sources, setSources] = useState<CopySource[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<FormLang | null>(null)
  const [show, setShow] = useState<Show>("all")
  const [busy, setBusy] = useState(false)
  const [wordsOpen, setWordsOpen] = useState(false)
  const loadSeq = useRef(0)

  useEffect(() => {
    const seq = ++loadSeq.current
    apiFetch(`/api/data-tables/${tableId}/form/translate`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { sources?: CopySource[] }) => {
        if (seq !== loadSeq.current) return
        setSources(Array.isArray(d.sources) ? d.sources : [])
        setLoadError(null)
      })
      .catch((err) => {
        console.error("[form-languages] sources failed:", err)
        if (seq === loadSeq.current) setLoadError(errorText(err, "Could not read the form's text."))
      })
  }, [tableId, savedVersion])

  const all = formLangList(languages)
  const current: FormLang = tab && all.includes(tab) ? tab : (languages.extra[0] ?? languages.main)
  const isMain = current === languages.main
  const entries = copy[current] ?? {}

  function setMain(main: FormLang) {
    onLanguages({ main, extra: languages.extra.filter((l) => l !== main) })
  }
  function toggleExtra(l: FormLang) {
    const on = languages.extra.includes(l)
    if (!on && languages.extra.length >= MAX_EXTRA_LANGS) return
    onLanguages({ ...languages, extra: on ? languages.extra.filter((x) => x !== l) : [...languages.extra, l] })
  }
  function setEntry(path: string, text: string, source: string) {
    onEntries(current, (prev) => {
      const next = { ...prev }
      if (text.trim()) next[path] = { t: text.slice(0, 600), s: source }
      else delete next[path]
      return next
    })
  }

  const rows = sources ?? []
  const stale = (s: CopySource) => !!entries[s.path] && entries[s.path].s !== s.text
  const missing = (s: CopySource) => !entries[s.path]
  const done = rows.filter((s) => !missing(s) && !stale(s)).length
  const toCheck = rows.filter(stale).length
  const visible = rows.filter((s) => (show === "missing" ? missing(s) : show === "check" ? stale(s) : true))

  async function translate() {
    if (busy) return
    setBusy(true)
    const lang = current
    // What the AI has filled so far, to ask only for what is left.
    let merged = { ...entries }
    // As it was when the button was pressed: anything changed since is the admin's.
    const start = entries
    try {
      // A long list goes in a few rounds; each asks only for what is left.
      for (let round = 0; round < 6; round++) {
        const paths = rows.filter((s) => !merged[s.path] || merged[s.path].s !== s.text).map((s) => s.path)
        if (!paths.length) break
        const res = await apiFetch(`/api/data-tables/${tableId}/form/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang, paths }),
        })
        const d = (await res.json()) as { entries?: Record<string, CopyEntry>; more?: boolean }
        const got = d.entries ?? {}
        merged = { ...merged, ...got }
        // Into the latest translations: words typed meanwhile stay.
        onEntries(lang, (prev) => {
          const next = { ...prev }
          for (const [path, e] of Object.entries(got)) if (prev[path] === start[path]) next[path] = e
          return next
        })
        if (!d.more || !Object.keys(got).length) break
      }
      toast.success(`Translated into ${langInfo(lang).name} — read it through, then Save`)
    } catch (err) {
      console.error("[form-languages] translate failed:", err)
      toast.error(errorText(err, "Could not translate just now."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[12px] text-slate-600">
        Questions are written in
        <select value={languages.main} onChange={(e) => setMain(e.target.value as FormLang)} className={`${FIELD} h-9 py-0`} name="form-main-language">
          {FORM_LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}{l.native !== l.name ? ` · ${l.native}` : ""}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-1.5 text-[12px] text-slate-600">
        <span>Also show the form in <span className="text-slate-400">(up to {MAX_EXTRA_LANGS})</span></span>
        <div className="flex flex-wrap gap-1.5">
          {FORM_LANGS.filter((l) => l.code !== languages.main).map((l) => {
            const on = languages.extra.includes(l.code)
            const full = !on && languages.extra.length >= MAX_EXTRA_LANGS
            return (
              <button
                key={l.code}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => toggleExtra(l.code)}
                className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                <span lang={l.code}>{l.native}</span>
              </button>
            )
          })}
        </div>
        <span className="text-[11.5px] leading-relaxed text-slate-400">
          Readers switch at the top of the form; it opens in their phone&apos;s language when offered. A link can choose one: add <code className="rounded bg-slate-100 px-1">?lang={languages.extra[0] ?? "ml"}</code>. Answers are always saved as written in {langInfo(languages.main).name}.
        </span>
      </div>

      {/* ── Translations ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
          <Languages className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Translations
        </div>
        <div role="tablist" aria-label="Language to edit" className="flex flex-wrap gap-1">
          {all.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={current === l}
              onClick={() => setTab(l)}
              className={`h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors ${current === l ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <span lang={l}>{langInfo(l).native}</span>{l === languages.main ? " · main" : ""}
            </button>
          ))}
        </div>

        {isMain ? (
          <p className="text-[11.5px] leading-relaxed text-slate-500">
            Your questions are already in {langInfo(current).name}. Below you can reword the form&apos;s own buttons and messages.
          </p>
        ) : loadError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-2.5 py-2 text-[12px] text-rose-700">{loadError}</p>
        ) : sources === null ? (
          <p className="flex items-center gap-2 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading the form…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={translate}
                disabled={busy || !rows.length || done === rows.length}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                {busy ? "Translating…" : done ? "Translate the rest with AI" : "Translate with AI"}
              </button>
              <span className="text-[11.5px] tabular-nums text-slate-500" aria-live="polite">
                {done} of {rows.length} done{toCheck ? ` · ${toCheck} to check` : ""}
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-slate-400">
              Changed a question or option? Save first, then it shows here. Anything not translated shows in {langInfo(languages.main).name}.
            </p>
            {rows.length > 8 && (
              <div role="radiogroup" aria-label="Show" className="flex gap-1">
                {(["all", "missing", "check"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={show === s}
                    onClick={() => setShow(s)}
                    className={`h-7 rounded-full px-2.5 text-[11.5px] font-medium ${show === s ? "bg-primary/10 text-primary" : "text-slate-500 hover:bg-slate-100"}`}
                  >
                    {s === "all" ? "All" : s === "missing" ? "Not done" : "To check"}
                  </button>
                ))}
              </div>
            )}
            <ul className="flex flex-col gap-2.5">
              {visible.map((s) => {
                const e = entries[s.path]
                const old = stale(s)
                const id = `tr-${current}-${s.path}`.replace(/[^\w-]/g, "_")
                return (
                  <li key={s.path} className="flex flex-col gap-1">
                    <label htmlFor={id} className="flex flex-col gap-0.5 text-[11px] text-slate-400">
                      {s.where}
                      <span className="whitespace-pre-line break-words text-[12.5px] text-slate-700">{s.text}</span>
                    </label>
                    {LONG.test(s.path) ? (
                      <textarea id={id} rows={2} value={e?.t ?? ""} onChange={(ev) => setEntry(s.path, ev.target.value, s.text)} maxLength={600} lang={current} dir={langInfo(current).rtl ? "rtl" : "ltr"} className={`${FIELD} resize-y ${old ? "border-amber-300" : ""}`} />
                    ) : (
                      <input id={id} value={e?.t ?? ""} onChange={(ev) => setEntry(s.path, ev.target.value, s.text)} maxLength={600} lang={current} dir={langInfo(current).rtl ? "rtl" : "ltr"} autoComplete="off" className={`${FIELD} ${old ? "border-amber-300" : ""}`} />
                    )}
                    {old && (
                      <p className="flex flex-wrap items-center gap-2 text-[11.5px] text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Check again — the original changed. Not shown on the form until checked.
                        <button type="button" onClick={() => setEntry(s.path, e.t, s.text)} className="rounded-md bg-amber-100 px-2 py-0.5 font-medium hover:bg-amber-200">Still right</button>
                      </p>
                    )}
                  </li>
                )
              })}
              {!visible.length && <li className="text-[12px] text-slate-400">Nothing here.</li>}
            </ul>
          </>
        )}

        {/* The form's own words, reworded by the business if it likes. */}
        <button
          type="button"
          onClick={() => setWordsOpen((o) => !o)}
          aria-expanded={wordsOpen}
          className="mt-1 flex items-center gap-1 self-start text-[12px] font-medium text-slate-600 hover:text-slate-900"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${wordsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          Buttons and messages
        </button>
        {wordsOpen && (
          <ul className="flex flex-col gap-1.5">
            {UI_TEXT_KEYS.map((k) => {
              const builtIn = FORM_STRINGS[current][k] as string
              const id = `ui-${current}-${k}`
              return (
                <li key={k}>
                  <label htmlFor={id} className="sr-only">{FORM_STRINGS.en[k] as string}</label>
                  <input
                    id={id}
                    value={entries[`ui:${k}`]?.t ?? ""}
                    placeholder={builtIn}
                    onChange={(ev) => setEntry(`ui:${k}`, ev.target.value, "")}
                    maxLength={600}
                    lang={current}
                    dir={langInfo(current).rtl ? "rtl" : "ltr"}
                    autoComplete="off"
                    className={FIELD}
                  />
                </li>
              )
            })}
            <li className="text-[11.5px] text-slate-400">Empty = the wording shown in grey.</li>
          </ul>
        )}
      </div>
    </div>
  )
}
