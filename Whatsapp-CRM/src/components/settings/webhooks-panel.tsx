'use client'

import { useState, useEffect, useCallback } from 'react'
import { Webhook, Plus, Trash2, Copy, Check, AlertTriangle, ToggleLeft, ToggleRight, AlertCircle } from 'lucide-react'

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
  if (failures >= 10) return <span className="text-xs text-destructive font-medium">Auto-disabled</span>
  if (!status) return null
  const ok = status >= 200 && status < 300
  return (
    <span className={`text-xs font-mono ${ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
      {status}
    </span>
  )
}

export function WebhooksPanel() {
  const [hooks, setHooks] = useState<WebhookRow[]>([])
  const [tables, setTables] = useState<DataTable[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // form state
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
    setFEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    )
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
        body: JSON.stringify({
          name: fName.trim(),
          url: fUrl.trim(),
          events: fEvents,
          table_id: fTable || null,
        }),
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

  async function remove(id: string) {
    if (!confirm('Delete this webhook?')) return
    await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
    setHooks((prev) => prev.filter((h) => h.id !== id))
  }

  async function copySecret() {
    if (!newSecret) return
    await navigator.clipboard.writeText(newSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Webhook className="size-5 text-primary" />
          Webhooks
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Receive an HTTPS POST to your endpoint whenever a Data Store record is created, updated, or deleted.
          Each delivery is signed with HMAC-SHA256 so you can verify it came from this CRM.
        </p>
      </div>

      {/* One-time secret reveal */}
      {newSecret && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Copy the signing secret now — it will never be shown again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-white dark:bg-black/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs font-mono break-all">
              {newSecret}
            </code>
            <button
              onClick={copySecret}
              className="shrink-0 rounded-lg border border-amber-300 bg-white dark:bg-black/20 px-3 py-2 text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition-colors"
              title="Copy"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <div className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
            <p>Verify deliveries in your receiver:</p>
            <pre className="bg-white/60 dark:bg-black/30 rounded px-2 py-1.5 overflow-x-auto">{`const sig = req.headers['x-crm-signature']
const expected = 'sha256=' + createHmac('sha256', SECRET)
  .update(rawBody, 'utf8').digest('hex')
if (sig !== expected) return res.status(401).end()`}</pre>
          </div>
          <button onClick={() => setNewSecret(null)} className="text-xs text-amber-700 dark:text-amber-400 underline">
            I have saved it, close this
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <p className="text-sm font-semibold">New Webhook</p>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Name</label>
            <input
              autoFocus
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="e.g. Sync to Google Sheets"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">URL <span className="text-slate-400">(must be HTTPS)</span></label>
            <input
              value={fUrl}
              onChange={(e) => setFUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/crm"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">Events</label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fEvents.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                    className="rounded"
                  />
                  <code className="text-xs">{ev}</code>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Table scope <span className="text-slate-400">(optional — leave blank for all tables)</span></label>
            <select
              value={fTable}
              onChange={(e) => setFTable(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All tables</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Webhook'}
            </button>
            <button
              onClick={resetForm}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 px-4 py-2 text-sm text-slate-500 hover:border-primary hover:text-primary transition-colors"
        >
          <Plus className="size-4" />
          Add Webhook
        </button>
      )}

      {/* Webhook list */}
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
      ) : hooks.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No webhooks yet.</div>
      ) : (
        <div className="space-y-3">
          {hooks.map((h) => (
            <div
              key={h.id}
              className={`rounded-xl border p-4 space-y-2 ${h.is_active ? 'border-slate-200 bg-white' : 'border-slate-200/50 bg-slate-100/20 opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{h.name}</p>
                  <p className="text-xs text-slate-500 truncate">{h.url}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(h)}
                    className="rounded-lg p-1.5 text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors"
                    title={h.is_active ? 'Disable' : 'Enable'}
                  >
                    {h.is_active
                      ? <ToggleRight className="size-5 text-primary" />
                      : <ToggleLeft className="size-5" />}
                  </button>
                  <button
                    onClick={() => remove(h.id)}
                    className="rounded-lg p-1.5 text-slate-500 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {h.events.map((ev) => (
                  <span key={ev} className="rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5 font-mono">
                    {ev}
                  </span>
                ))}
                {h.table && (
                  <span className="rounded-full bg-slate-100 text-slate-500 text-xs px-2 py-0.5">
                    {h.table.name}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>Last: {fmt(h.last_triggered_at)}</span>
                {statusBadge(h.last_response_status, h.failure_count)}
                {h.failure_count > 0 && h.failure_count < 10 && (
                  <span className="text-amber-600">{h.failure_count} failure{h.failure_count > 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
