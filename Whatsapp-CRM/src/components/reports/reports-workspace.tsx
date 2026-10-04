'use client'

/**
 * Reports — ask a question as a sentence about your business's moments.
 *
 * Left, a library of ready reports (and the team's saved ones) to start
 * from; right, the question as a sentence whose highlighted words open
 * into their choices, then the answer. Everything a manager needs to
 * take it into a meeting is one click away: Excel, CSV, print or save as
 * PDF, and a full-screen Present view.
 *
 * Nothing here is specific to one kind of business. The moments include
 * each account's own Data Store tables, and the four questions — how
 * many, how much, conversion, repeat — mean the same for an institute, a
 * clinic or a shop. See src/lib/reports for the engine.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart2, Bookmark, CalendarRange, CheckSquare, ChevronDown, Database, Download, FileSpreadsheet, FileText,
  IndianRupee, Loader2, Maximize2, MessageSquare, Phone, Plus, Printer, Search, Target, Trash2, X,
} from 'lucide-react'
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog'
import type { ReportFilter, ReportResult, ReportSpec, Shape } from '@/lib/reports/engine'
import { ReportView } from './report-view'
import { TokenSelect, type TokenOption } from './token-select'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

// ── catalog ───────────────────────────────────────────────────────────

interface MomentOption {
  kind: string
  label: string
  group: string
  props: { key: string; label: string }[]
  values: { key: string; label: string; unit: 'INR' | 'min' | null }[]
}
interface Catalog {
  moments: MomentOption[]
  periods: { key: string; label: string }[]
  presets: { id: string; title: string; description: string; spec: ReportSpec }[]
  saved: { id: string; name: string; spec: ReportSpec }[]
  timezone: string
}

type Category = 'leads' | 'conversations' | 'calls' | 'tasks' | 'payments' | 'data'

const CATEGORY_OF_GROUP: Record<string, Category> = {
  Leads: 'leads',
  Conversations: 'conversations',
  Calls: 'calls',
  'Follow-ups & tasks': 'tasks',
  Payments: 'payments',
  'Data Store': 'data',
}

const CATEGORY: Record<Category, { label: string; icon: React.ComponentType<{ className?: string }>; tile: string }> = {
  leads: { label: 'Leads & sales', icon: Target, tile: 'bg-emerald-50 text-emerald-600' },
  conversations: { label: 'Conversations', icon: MessageSquare, tile: 'bg-indigo-50 text-indigo-600' },
  calls: { label: 'Calls', icon: Phone, tile: 'bg-sky-50 text-sky-600' },
  tasks: { label: 'Follow-ups', icon: CheckSquare, tile: 'bg-violet-50 text-violet-600' },
  payments: { label: 'Payments', icon: IndianRupee, tile: 'bg-amber-50 text-amber-600' },
  data: { label: 'Your data', icon: Database, tile: 'bg-teal-50 text-teal-600' },
}

const MOMENT_HELP: Record<string, string> = {
  'conversation.started': 'A customer starts a new chat',
  'message.customer': 'Any message a customer sends',
  'message.agent': 'A reply from your team',
  'message.bot': 'An automatic reply from a bot or the AI',
  'lead.created': 'A new lead is added',
  'lead.won': 'A lead is closed as won',
  'lead.lost': 'A lead is closed as lost, with a reason',
  'call.inbound': 'A call comes in',
  'call.missed': 'A call nobody answered',
  'call.outbound': 'Your team calls a customer',
  'followup.done': 'A follow-up is marked done',
  'task.done': 'A task is completed',
  'payment.requested': 'A payment link is sent',
  'payment.received': 'A payment is completed',
}

const SHAPES: { value: Shape; label: string; description: string }[] = [
  { value: 'count', label: 'How many', description: 'Count how often something happened' },
  { value: 'sum', label: 'How much', description: 'Add up an amount — payments, talk time, a number field' },
  { value: 'from_to', label: 'Conversion', description: 'Of those who did one thing, how many went on to another, and how fast' },
  { value: 'again', label: 'Repeat', description: 'Customers it happened to more than once' },
]

const PERIOD_LABEL: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_year: 'This year',
  last_12_months: 'Last 12 months',
}

const WINDOWS = [1, 7, 14, 30, 60, 90, 180, 365]
const NONE = '(none)'
const CARD = 'rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]'

function iconFor(group: string, cls = 'h-3.5 w-3.5') {
  const Icon = CATEGORY[CATEGORY_OF_GROUP[group] ?? 'data'].icon
  return <Icon className={cls} />
}

/** The question without how it is shown — a new chart style needs no new run. */
function engineKey(spec: ReportSpec): string {
  return JSON.stringify({ ...spec, display: undefined })
}

function defaultSpec(): ReportSpec {
  return { v: 1, shape: 'from_to', moment: 'lead.created', to: 'lead.won', by: 'source', window_days: 90, period: { preset: 'last_90_days' }, filters: [] }
}

// ── workspace ─────────────────────────────────────────────────────────

export function ReportsWorkspace() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [spec, setSpec] = useState<ReportSpec>(defaultSpec)
  const [activeId, setActiveId] = useState<string | null>('win-rate-by-source')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [insights, setInsights] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [presenting, setPresenting] = useState(false)
  const runSeq = useRef(0)

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/reports/catalog')
      const data = await res.json()
      if (!res.ok) {
        setCatalogError(data.error ?? 'Could not load reports.')
        return
      }
      setCatalog(data)
    } catch {
      setCatalogError('Could not load reports — check the connection.')
    }
  }, [])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  const moment = catalog?.moments.find((m) => m.kind === spec.moment)
  const key = engineKey(spec)

  // Runs when the question changes — not when only the chart style does.
  useEffect(() => {
    if (!catalog || !moment) return
    const seq = ++runSeq.current
    setRunning(true)
    setRunError(null)
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/reports/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: `{"spec":${key}}`,
        })
        const data = await res.json()
        if (seq !== runSeq.current) return
        if (!res.ok) {
          setRunError(data.error ?? 'The report could not run.')
          setResult(null)
          return
        }
        setResult(data.result)
        setInsights(data.insights ?? [])
      } catch {
        if (seq === runSeq.current) setRunError('The report could not run — check the connection.')
      } finally {
        if (seq === runSeq.current) setRunning(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [key, catalog, moment])

  function open(id: string, s: ReportSpec) {
    setActiveId(id)
    setSpec({ ...s, filters: s.filters ?? [] })
  }

  function edit(next: ReportSpec) {
    setActiveId(null)
    setSpec(next)
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <style>{PRINT_CSS}</style>

      <Header
        spec={spec}
        hasResult={!!result}
        onPresent={() => setPresenting(true)}
        onSaved={loadCatalog}
        defaultName={result?.title.split(' — ')[0] ?? ''}
      />

      {catalogError && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">{catalogError}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[288px_minmax(0,1fr)]">
        <Library catalog={catalog} activeId={activeId} onOpen={open} onChanged={loadCatalog} />

        <main className="min-w-0 space-y-5">
          <QuestionBar catalog={catalog} moment={moment} spec={spec} onChange={edit} />

          {runError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">{runError}</div>
          )}

          <section id="report-print" className={cn(CARD, 'relative p-4 sm:p-6')}>
            {running && (
              <div className="absolute right-4 top-4 flex items-center gap-1.5 text-[12px] text-slate-400 print:hidden">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating
              </div>
            )}
            {result ? (
              <div className={cn('transition-opacity', running && 'opacity-60')}>
                <ReportView
                  result={result}
                  insights={insights}
                  display={spec.display ?? {}}
                  onDisplay={(d) => setSpec((s) => ({ ...s, display: d }))}
                  momentKind={spec.moment}
                />
              </div>
            ) : !runError ? (
              <ResultSkeleton />
            ) : null}
          </section>
        </main>
      </div>

      {presenting && result && (
        <Presentation onClose={() => setPresenting(false)}>
          <ReportView result={result} insights={insights} display={spec.display ?? {}} onDisplay={() => {}} momentKind={spec.moment} presenting />
        </Presentation>
      )}
    </div>
  )
}

// Print or "Save as PDF" shows only the report, on white.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #report-print, #report-print * { visibility: visible !important; }
  #report-print { position: absolute; left: 0; top: 0; width: 100%; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  @page { size: A4; margin: 14mm; }
}`

// ── header ────────────────────────────────────────────────────────────

function Header({ spec, hasResult, onPresent, onSaved, defaultName }: {
  spec: ReportSpec; hasResult: boolean; onPresent: () => void; onSaved: () => void; defaultName: string
}) {
  const [exportOpen, setExportOpen] = useState(false)
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen && !saveOpen) return
    const onDown = (e: MouseEvent) => {
      if (exportOpen && !exportRef.current?.contains(e.target as Node)) setExportOpen(false)
      if (saveOpen && !saveRef.current?.contains(e.target as Node)) setSaveOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportOpen(false)
        setSaveOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen, saveOpen])

  async function download(format: 'xlsx' | 'csv') {
    setExportOpen(false)
    setBusy(format)
    try {
      const res = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, format }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? 'Export failed.')
        return
      }
      const blob = await res.blob()
      const match = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = match ? decodeURIComponent(match[1]) : `Report.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(format === 'xlsx' ? 'Excel downloaded.' : 'CSV downloaded.')
    } catch {
      toast.error('Export failed — check the connection.')
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    const n = name.trim()
    if (!n) {
      toast.error('Give the report a name.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/reports/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, spec }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Could not save.')
        return
      }
      toast.success('Saved for your team.')
      setSaveOpen(false)
      onSaved()
    } catch {
      toast.error('Could not save — check the connection.')
    } finally {
      setSaving(false)
    }
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <BarChart2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-[21px] font-bold leading-tight text-slate-900">Reports</h1>
          <p className="text-[12.5px] text-slate-500">Ask a question about your business — every number comes straight from your data.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" onClick={onPresent} disabled={!hasResult} className={btn}>
          <Maximize2 className="h-3.5 w-3.5" /> Present
        </button>

        <div ref={saveRef} className="relative">
          <button type="button" onClick={() => { setName(defaultName); setSaveOpen((v) => !v) }} disabled={!hasResult} className={btn} aria-expanded={saveOpen}>
            <Bookmark className="h-3.5 w-3.5" /> Save
          </button>
          {saveOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
              <label htmlFor="report-save-name" className="text-[12px] font-semibold text-slate-700">Name this report</label>
              <input
                id="report-save-name"
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save() }}
                className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-[13px] focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <p className="mt-1.5 text-[11.5px] text-slate-400">Everyone on your team with Reports access will see it.</p>
              <button type="button" onClick={save} disabled={saving}
                className="mt-2.5 w-full rounded-lg bg-indigo-600 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save report'}
              </button>
            </div>
          )}
        </div>

        <div ref={exportRef} className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={!hasResult || busy !== null}
            aria-expanded={exportOpen}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export
            <ChevronDown className="h-3.5 w-3.5 opacity-80" />
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <ExportItem icon={<FileSpreadsheet className="h-4 w-4 text-emerald-600" />} title="Excel" hint="Summary and data sheets" onClick={() => download('xlsx')} />
              <ExportItem icon={<FileText className="h-4 w-4 text-sky-600" />} title="CSV" hint="Plain data for any tool" onClick={() => download('csv')} />
              <ExportItem icon={<Printer className="h-4 w-4 text-slate-600" />} title="Print or save as PDF" hint="Just the report, on A4" onClick={() => { setExportOpen(false); setTimeout(() => window.print(), 50) }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ExportItem({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50">
      <span className="mt-0.5">{icon}</span>
      <span>
        <span className="block text-[13px] font-medium text-slate-800">{title}</span>
        <span className="block text-[11.5px] text-slate-500">{hint}</span>
      </span>
    </button>
  )
}

// ── library ───────────────────────────────────────────────────────────

function Library({ catalog, activeId, onOpen, onChanged }: {
  catalog: Catalog | null; activeId: string | null; onOpen: (id: string, s: ReportSpec) => void; onChanged: () => void
}) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Category | 'all' | 'saved'>('all')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const groupOf = useCallback(
    (s: ReportSpec): Category => CATEGORY_OF_GROUP[catalog?.moments.find((m) => m.kind === s.moment)?.group ?? ''] ?? 'data',
    [catalog],
  )

  const items = useMemo(() => {
    if (!catalog) return []
    const ready = catalog.presets.map((p) => ({ id: p.id, title: p.title, description: p.description, spec: p.spec, saved: false }))
    const saved = catalog.saved.map((s) => ({ id: s.id, title: s.name, description: 'Saved by your team', spec: s.spec, saved: true }))
    const all = tab === 'saved' ? saved : [...saved, ...ready]
    const q = query.trim().toLowerCase()
    return all.filter((r) => (tab === 'all' || tab === 'saved' || groupOf(r.spec) === tab) && (!q || `${r.title} ${r.description}`.toLowerCase().includes(q)))
  }, [catalog, tab, query, groupOf])

  const tabs: { key: Category | 'all' | 'saved'; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'saved', label: `Saved${catalog?.saved.length ? ` · ${catalog.saved.length}` : ''}` },
    ...(Object.keys(CATEGORY) as Category[])
      .filter((c) => catalog?.presets.some((p) => groupOf(p.spec) === c))
      .map((c) => ({ key: c, label: CATEGORY[c].label })),
  ]

  async function remove() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/reports/saved?id=${encodeURIComponent(deleteId)}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Could not delete.')
        return
      }
      toast.success('Saved report deleted.')
      setDeleteId(null)
      onChanged()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <aside className={cn(CARD, 'self-start p-3 print:hidden lg:sticky lg:top-4')}>
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[13px] font-semibold text-slate-900 lg:hidden"
        aria-expanded={mobileOpen}
      >
        Report library
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', mobileOpen && 'rotate-180')} />
      </button>

      <div className={cn('space-y-3', !mobileOpen && 'hidden lg:block', mobileOpen && 'mt-3')}>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input
            id="report-library-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            className="h-9 w-full bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                tab === t.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="-mx-1 max-h-[calc(100vh-15rem)] space-y-0.5 overflow-y-auto px-1">
          {!catalog && [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-50" />)}
          {catalog && items.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-slate-400">
              {tab === 'saved' ? 'Nothing saved yet. Build a report and press Save.' : 'No report matches.'}
            </p>
          )}
          {items.map((r) => {
            const cat = CATEGORY[groupOf(r.spec)]
            const Icon = r.saved ? Bookmark : cat.icon
            const active = r.id === activeId
            return (
              <div key={r.id} className="group relative">
                <button
                  type="button"
                  onClick={() => { onOpen(r.id, r.spec); setMobileOpen(false) }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                    active ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50',
                  )}
                >
                  <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', r.saved ? 'bg-slate-100 text-slate-600' : cat.tile)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 pr-5">
                    <span className={cn('block truncate text-[13px] font-semibold', active ? 'text-indigo-800' : 'text-slate-800')}>{r.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-slate-500">{r.description}</span>
                  </span>
                </button>
                {r.saved && (
                  <button
                    type="button"
                    aria-label={`Delete ${r.title}`}
                    onClick={() => setDeleteId(r.id)}
                    className="absolute right-2 top-2.5 rounded p-1 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <ConfirmIconDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null) }}
        icon={Trash2}
        tone="danger"
        title="Delete this saved report?"
        description="Only the saved question is removed — your data does not change."
        actionLabel="Delete"
        actionPendingLabel="Deleting…"
        onConfirm={remove}
        pending={deleting}
      />
    </aside>
  )
}

// ── the question ──────────────────────────────────────────────────────

function Word({ children }: { children: React.ReactNode }) {
  return <span className="text-[13.5px] text-slate-500">{children}</span>
}

function QuestionBar({ catalog, moment, spec, onChange }: {
  catalog: Catalog | null; moment: MomentOption | undefined; spec: ReportSpec; onChange: (s: ReportSpec) => void
}) {
  const momentOptions: TokenOption[] = useMemo(
    () => (catalog?.moments ?? []).map((m) => ({
      value: m.kind,
      label: m.label,
      group: m.group === 'Data Store' ? 'Your data' : m.group,
      description: MOMENT_HELP[m.kind] ?? 'A new record in this table',
      icon: iconFor(m.group),
    })),
    [catalog],
  )

  if (!catalog || !moment) {
    return <div className={cn(CARD, 'h-[118px] animate-pulse')} />
  }

  const set = (patch: Partial<ReportSpec>) => onChange({ ...spec, ...patch })

  function changeMoment(kind: string) {
    const m = catalog!.moments.find((x) => x.kind === kind)
    onChange({
      ...spec,
      moment: kind,
      by: m?.props.some((p) => p.key === spec.by) ? spec.by : null,
      value: spec.shape === 'sum' ? m?.values[0]?.key : undefined,
      shape: spec.shape === 'sum' && !m?.values.length ? 'count' : spec.shape,
      to: spec.to === kind ? undefined : spec.to,
      filters: [],
    })
  }

  function changeShape(shape: Shape) {
    const next: ReportSpec = { ...spec, shape }
    if (shape === 'sum') next.value = moment!.values[0]?.key
    if (shape === 'from_to') {
      const preferred = spec.moment === 'lead.won' ? 'payment.received' : 'lead.won'
      next.to = spec.to && spec.to !== spec.moment ? spec.to
        : catalog!.moments.find((m) => m.kind === preferred && m.kind !== spec.moment)?.kind
          ?? catalog!.moments.find((m) => m.kind !== spec.moment)?.kind
      next.window_days = spec.window_days ?? 90
    }
    if (shape === 'again') next.by = null
    onChange(next)
  }

  const isCustom = !!(spec.period.from || spec.period.to)
  const periodOptions: TokenOption[] = [
    ...catalog.periods.map((p) => ({ value: p.key, label: PERIOD_LABEL[p.key] ?? p.label })),
    { value: 'custom', label: 'Custom range…', description: 'Pick the first and last day' },
  ]
  const timeChart = (spec.shape === 'count' || spec.shape === 'sum') && !spec.by

  return (
    <div className={cn(CARD, 'p-4 sm:p-5 print:hidden')}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your question</p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 leading-none">
        <TokenSelect
          ariaLabel="Question"
          value={spec.shape}
          onChange={(v) => changeShape(v as Shape)}
          options={SHAPES.map((s) => ({ ...s, disabled: s.value === 'sum' && !moment.values.length }))}
        />

        {spec.shape === 'sum' && (
          <>
            <TokenSelect ariaLabel="Amount" value={spec.value ?? ''} onChange={(v) => set({ value: v })} options={moment.values.map((v) => ({ value: v.key, label: v.label }))} />
            <Word>of</Word>
          </>
        )}
        {spec.shape === 'from_to' && <Word>from</Word>}
        {spec.shape === 'again' && <Word>customers with more than one</Word>}

        <TokenSelect ariaLabel="Moment" value={spec.moment} onChange={changeMoment} options={momentOptions} widthClass="w-96" />

        {spec.shape === 'from_to' && (
          <>
            <Word>to</Word>
            <TokenSelect ariaLabel="Second moment" value={spec.to ?? ''} onChange={(v) => set({ to: v })} options={momentOptions.filter((o) => o.value !== spec.moment)} widthClass="w-96" />
            <Word>within</Word>
            <TokenSelect
              ariaLabel="Within"
              value={String(spec.window_days ?? 90)}
              onChange={(v) => set({ window_days: Number(v) })}
              options={WINDOWS.map((w) => ({ value: String(w), label: w === 1 ? '1 day' : `${w} days` }))}
              widthClass="w-44"
            />
          </>
        )}

        {spec.shape !== 'again' && moment.props.length > 0 && (
          <>
            <Word>split by</Word>
            <TokenSelect
              ariaLabel="Split by"
              muted={!spec.by}
              value={spec.by ?? ''}
              onChange={(v) => set({ by: v || null })}
              placeholder="nothing"
              options={[{ value: '', label: 'Nothing', description: 'One total, over time' }, ...moment.props.map((p) => ({ value: p.key, label: p.label }))]}
              widthClass="w-64"
            />
          </>
        )}

        <span className="mx-0.5 text-slate-300">·</span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4 text-slate-400" />
          <TokenSelect
            ariaLabel="Period"
            value={isCustom ? 'custom' : spec.period.preset ?? 'last_30_days'}
            onChange={(v) => {
              if (v === 'custom') {
                const today = new Date().toISOString().slice(0, 10)
                set({ period: { from: `${today.slice(0, 8)}01`, to: today } })
              } else set({ period: { preset: v as ReportSpec['period']['preset'] } })
            }}
            options={periodOptions}
            widthClass="w-60"
          />
        </span>
        {isCustom && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <input id="report-from" type="date" aria-label="First day" value={spec.period.from ?? ''} onChange={(e) => set({ period: { ...spec.period, from: e.target.value } })}
              className="h-8 rounded-lg border border-slate-200 px-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <Word>to</Word>
            <input id="report-to" type="date" aria-label="Last day" value={spec.period.to ?? ''} onChange={(e) => set({ period: { ...spec.period, to: e.target.value } })}
              className="h-8 rounded-lg border border-slate-200 px-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </span>
        )}
        {timeChart && (
          <>
            <Word>by</Word>
            <TokenSelect
              ariaLabel="Step"
              muted
              value={spec.bucket ?? ''}
              onChange={(v) => set({ bucket: (v || undefined) as ReportSpec['bucket'] })}
              options={[
                { value: '', label: 'Auto', description: 'Days, weeks or months to suit the period' },
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
              widthClass="w-60"
            />
          </>
        )}
      </div>

      <Filters moment={moment} spec={spec} onChange={(filters) => set({ filters })} />
    </div>
  )
}

// ── filters ───────────────────────────────────────────────────────────

function Filters({ moment, spec, onChange }: { moment: MomentOption; spec: ReportSpec; onChange: (f: ReportFilter[]) => void }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const filters = spec.filters ?? []
  const labelOf = (prop: string) => moment.props.find((p) => p.key === prop)?.label ?? prop

  if (!moment.props.length) return null

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3.5">
      {filters.map((f, i) => (
        <div key={`${f.prop}-${i}`} className="relative">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-[12.5px] text-slate-700">
            <button type="button" onClick={() => setEditing(i)} className="max-w-[260px] truncate">
              <span className="font-semibold">{labelOf(f.prop)}</span>
              <span className="text-slate-500">: {f.values.length > 2 ? `${f.values.length} values` : f.values.map((v) => (v === NONE ? 'empty' : v)).join(', ')}</span>
            </button>
            <button type="button" aria-label={`Remove ${labelOf(f.prop)} filter`} onClick={() => onChange(filters.filter((_, j) => j !== i))}
              className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
              <X className="h-3 w-3" />
            </button>
          </span>
          {editing === i && (
            <FilterEditor
              moment={moment}
              spec={spec}
              initial={f}
              onClose={() => setEditing(null)}
              onApply={(nf) => { onChange(filters.map((x, j) => (j === i ? nf : x))); setEditing(null) }}
            />
          )}
        </div>
      ))}
      {filters.length < 3 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-[12.5px] font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add filter
          </button>
          {editing === 'new' && (
            <FilterEditor
              moment={moment}
              spec={spec}
              onClose={() => setEditing(null)}
              onApply={(nf) => { onChange([...filters, nf]); setEditing(null) }}
            />
          )}
        </div>
      )}
      {filters.length === 0 && <span className="text-[12px] text-slate-400">Narrow it down — for example one source, one team member or one course.</span>}
    </div>
  )
}

function FilterEditor({ moment, spec, initial, onApply, onClose }: {
  moment: MomentOption; spec: ReportSpec; initial?: ReportFilter; onApply: (f: ReportFilter) => void; onClose: () => void
}) {
  const [prop, setProp] = useState(initial?.prop ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set(initial?.values ?? []))
  const [loaded, setLoaded] = useState<{ for: string; list: { key: string; label: string }[] } | null>(null)
  const [query, setQuery] = useState('')
  const loadKey = `${spec.moment}|${prop}`
  const options = loaded?.for === loadKey ? loaded.list : null
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // The values this detail actually has, from the last year.
  useEffect(() => {
    if (!prop) return
    let cancelled = false
    const forKey = `${spec.moment}|${prop}`
    fetch('/api/reports/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: { v: 1, shape: 'count', moment: spec.moment, by: prop, period: { preset: 'last_12_months' } } }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const groups = ((data?.result as ReportResult | undefined)?.groups ?? []).map((g) => ({ key: g.key, label: g.key === NONE ? 'Empty' : g.label }))
        setLoaded({ for: forKey, list: groups })
      })
      .catch(() => { if (!cancelled) setLoaded({ for: forKey, list: [] }) })
    return () => { cancelled = true }
  }, [prop, spec.moment])

  const shown = (options ?? []).filter((o) => !query.trim() || o.label.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div ref={ref} className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
      {!prop ? (
        <div className="p-1.5">
          <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Filter by</p>
          {moment.props.map((p) => (
            <button key={p.key} type="button" onClick={() => setProp(p.key)} className="block w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-slate-800 hover:bg-slate-50">
              {p.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="text-[12px] font-semibold text-slate-700">{moment.props.find((p) => p.key === prop)?.label} is any of</p>
            {(options?.length ?? 0) > 8 && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-2">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <input id="report-filter-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
                  className="h-8 w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
              </div>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {options === null && <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>}
            {options !== null && shown.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-slate-400">No values in the last year.</p>}
            {shown.map((o) => (
              <label key={o.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={picked.has(o.key)}
                  onChange={(e) => {
                    const next = new Set(picked)
                    if (e.target.checked) next.add(o.key)
                    else next.delete(o.key)
                    setPicked(next)
                  }}
                  className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
            <button type="button" onClick={() => (initial ? onClose() : setProp(''))} className="text-[12.5px] font-medium text-slate-500 hover:text-slate-700">
              {initial ? 'Cancel' : 'Back'}
            </button>
            <button
              type="button"
              disabled={picked.size === 0}
              onClick={() => onApply({ prop, values: [...picked].slice(0, 20) })}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Apply{picked.size ? ` (${picked.size})` : ''}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── loading and presenting ────────────────────────────────────────────

function ResultSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-6 w-2/3 animate-pulse rounded-lg bg-slate-100" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-50" />)}
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-slate-50" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-50" />
    </div>
  )
}

function Presentation({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    // Full screen where the browser allows it; the overlay alone where not.
    el?.requestFullscreen?.().catch(() => {})
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onFs = () => { if (!document.fullscreenElement) onClose() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [onClose])

  return (
    <div ref={ref} className="fixed inset-0 z-[100] overflow-y-auto bg-white">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-12">
        <div className="mb-8 flex justify-end">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
            <X className="h-3.5 w-3.5" /> Exit
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
