'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Plus, Trash2, Copy, Check, AlertTriangle, ToggleLeft, ToggleRight, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog'

interface DataTable { id: string; name: string }

interface WebhookRow {
  id: string
  name: string
  url: string
  events: string[]
  table_id: string | null
  is_active: boolean
  last_triggered_at: string | null
  last_response_status: number | null
  failure_count: number
  created_at: string
  table: { id: string; name: string } | null
}

const ALL_EVENTS = ['record.created', 'record.updated', 'record.deleted'] as const

function fmt(iso: string | null) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
}

function statusBadge(status: number | null, failures: number) {
  if (failures >= 10) return <span className="text-[11.5px] text-rose-600 font-medium">Auto-disabled</span>
  if (!status) return null
  const ok = status >= 200 && status < 300
  return (
    <span className={`text-[11.5px] font-mono ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>{status}</span>
  )
}

export function WebhooksPanel() {
  const reduceMotion = useReducedMotion()
  const [hooks, setHooks] = useState<WebhookRow[]>([])
  const [tables, setTables] = useState<DataTable[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [fName, setFName] = useState('')
  const [fUrl, setFUrl] = useState('')
  const [fEvents, setFEvents] = useState<string[]>(['record.created', 'record.updated', 'record.deleted'])
  const [fTable, setFTable] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [hRes, tRes] = await Promise.all([
        fetch('/api/webhooks'),
        fetch('/api/data-tables'),
      ])
      const hData = await hRes.json()
      const tData = await tRes.json()
      if (hRes.ok) setHooks(hData.webhooks ?? [])
      if (tRes.ok) setTables(tData.tables ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggleEvent(ev: string) {
    setFEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]))
  }

  async function create() {
    if (!fName.trim()) { setError('Name is required.'); return }
    if (!fUrl.trim()) { setError('URL is required.'); return }
    if (fEvents.length === 0) { setError('Select at least one event.'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fName.trim(), url: fUrl.trim(), events: fEvents, table_id: fTable || null }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed.'); return }
      setNewSecret(data.signing_secret)
      resetForm()
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setShowForm(false)
    setFName('')
    setFUrl('')
    setFEvents(['record.created', 'record.updated', 'record.deleted'])
    setFTable('')
    setError('')
  }

  async function toggleActive(hook: WebhookRow) {
    const res = await fetch(`/api/webhooks/${hook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !hook.is_active }),
    })
    if (res.ok) {
      const data = await res.json()
      setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, ...data.webhook } : h)))
    }
  }

  async function remove() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch(`/api/webhooks/${deleteTarget.id}`, { method: 'DELETE' })
      setHooks((prev) => prev.filter((h) => h.id !== deleteTarget.id))
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function copySecret() {
    if (!newSecret) return
    await navigator.clipboard.writeText(newSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-5">
      {newSecret && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[13px] font-medium text-amber-800">Copy the signing secret now — it will never be shown again.</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-xl bg-white border border-amber-200 px-3 py-2 text-[12px] font-mono break-all">{newSecret}</code>
            <button onClick={copySecret} className="shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-2 text-amber-700 hover:bg-amber-100 transition-colors" title="Copy">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <div className="text-[12px] text-amber-700 space-y-1">
            <p>Verify deliveries in your receiver:</p>
            <pre className="bg-white/60 rounded-lg px-2.5 py-1.5 overflow-x-auto text-[11px]">{`const sig = req.headers['x-crm-signature']
const expected = 'sha256=' + createHmac('sha256', SECRET)
  .update(rawBody, 'utf8').digest('hex')
if (sig !== expected) return res.status(401).end()`}</pre>
          </div>
          <button onClick={() => setNewSecret(null)} className="text-[12px] text-amber-700 underline underline-offset-2">
            I have saved it, close this
          </button>
        </div>
      )}

      {showForm ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
          <p className="text-[13px] font-semibold text-slate-800">New Webhook</p>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-slate-600">Name</label>
            <input
              autoFocus
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="e.g. Sync to Google Sheets"
              className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none transition-all focus:border-[#5B6CF9]/40 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/10"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-slate-600">URL <span className="text-slate-400">(must be HTTPS)</span></label>
            <input
              value={fUrl}
              onChange={(e) => setFUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/crm"
              className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none transition-all focus:border-[#5B6CF9]/40 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/10"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-slate-600">Events</label>
            <div className="flex flex-wrap gap-3">
              {ALL_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fEvents.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                    className="h-3.5 w-3.5 rounded accent-[#5B6CF9]"
                  />
                  <code className="text-[12px] text-slate-600">{ev}</code>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-slate-600">Table scope <span className="text-slate-400">(optional — leave blank for all tables)</span></label>
            <select
              value={fTable}
              onChange={(e) => setFTable(e.target.value)}
              className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none transition-all focus:border-[#5B6CF9]/40 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/10"
            >
              <option value="">All tables</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[12.5px] text-rose-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={create} disabled={submitting} className="h-9 px-4 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : 'Create Webhook'}
            </Button>
            <Button variant="outline" onClick={resetForm} className="h-9 px-4 text-[13px] border-slate-200">Cancel</Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-[13px] text-slate-500 hover:border-[#5B6CF9]/50 hover:text-[#5B6CF9] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Webhook
        </button>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : hooks.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm py-10 text-center text-[13px] text-slate-400">No webhooks yet.</div>
      ) : (
        <div className="space-y-3">
          {hooks.map((h, i) => (
            <motion.div
              key={h.id}
              className={`rounded-2xl border p-4 space-y-2.5 shadow-sm ${h.is_active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-60'}`}
              initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(i * 0.04, 0.3), ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[13.5px] text-slate-800 truncate">{h.name}</p>
                  <p className="text-[12px] text-slate-500 truncate">{h.url}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(h)}
                    className="rounded-lg p-1.5 text-slate-400 hover:text-[#5B6CF9] hover:bg-[#EEF0FF] transition-colors"
                    title={h.is_active ? 'Disable' : 'Enable'}
                  >
                    {h.is_active ? <ToggleRight className="h-5 w-5 text-[#5B6CF9]" /> : <ToggleLeft className="h-5 w-5" />}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(h)}
                    className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {h.events.map((ev) => (
                  <span key={ev} className="rounded-full bg-[#EEF0FF] text-[#5B6CF9] text-[11px] px-2 py-0.5 font-mono">{ev}</span>
                ))}
                {h.table && <span className="rounded-full bg-slate-100 text-slate-500 text-[11px] px-2 py-0.5">{h.table.name}</span>}
              </div>

              <div className="flex items-center gap-3 text-[11.5px] text-slate-500">
                <span>Last: {fmt(h.last_triggered_at)}</span>
                {statusBadge(h.last_response_status, h.failure_count)}
                {h.failure_count > 0 && h.failure_count < 10 && (
                  <span className="text-amber-600">{h.failure_count} failure{h.failure_count > 1 ? 's' : ''}</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <ConfirmIconDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        icon={Trash2}
        tone="danger"
        title="Delete this webhook?"
        description={<>&quot;{deleteTarget?.name}&quot; will stop receiving events immediately. This can&apos;t be undone.</>}
        actionLabel="Delete"
        actionPendingLabel="Deleting…"
        onConfirm={remove}
        pending={deleting}
      />
    </div>
  )
}
