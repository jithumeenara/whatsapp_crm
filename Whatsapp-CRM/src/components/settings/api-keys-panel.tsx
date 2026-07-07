'use client'

import { useState, useEffect, useCallback } from 'react'
import { KeyRound, Plus, Trash2, Copy, Check, AlertTriangle } from 'lucide-react'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  last_used_at: string | null
  created_at: string
}

function fmt(iso: string | null) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
}

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [newRawKey, setNewRawKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/api-keys')
      const data = await res.json()
      if (res.ok) setKeys(data.keys ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function create() {
    if (!newName.trim()) { setError('Name is required.'); return }
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed.'); return }
      setNewRawKey(data.raw)
      setNewName('')
      setShowForm(false)
      await load()
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this API key? Any app using it will immediately lose access.')) return
    await fetch(`/api/api-keys/${id}`, { method: 'DELETE' })
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }

  async function copyKey() {
    if (!newRawKey) return
    await navigator.clipboard.writeText(newRawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          API Keys
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Generate secret keys so external apps can read and write Data Store records via the REST API.
        </p>
      </div>

      {/* One-time key reveal */}
      {newRawKey && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Copy this key now — it will never be shown again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-white dark:bg-black/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs font-mono break-all">
              {newRawKey}
            </code>
            <button
              onClick={copyKey}
              className="shrink-0 rounded-lg border border-amber-300 bg-white dark:bg-black/20 px-3 py-2 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
              title="Copy"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <button
            onClick={() => setNewRawKey(null)}
            className="text-xs text-amber-700 dark:text-amber-400 underline"
          >
            I have copied it, close this
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-sm font-medium">New API Key</p>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            placeholder="e.g. My Integration"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={creating}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create Key'}
            </button>
            <button
              onClick={() => { setShowForm(false); setError('') }}
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
          New API Key
        </button>
      )}

      {/* Key list */}
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
      ) : keys.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No API keys yet.</div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-slate-500">Name</th>
                <th className="px-4 py-2.5 text-left font-medium text-slate-500">Prefix</th>
                <th className="px-4 py-2.5 text-left font-medium text-slate-500">Last used</th>
                <th className="px-4 py-2.5 text-left font-medium text-slate-500">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {keys.map((k) => (
                <tr key={k.id} className="bg-white hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{k.key_prefix}…</code>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmt(k.last_used_at)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmt(k.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => revoke(k.id)}
                      className="rounded-lg p-1.5 text-slate-500 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Revoke"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Usage guide */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Usage</p>
        <p className="text-sm text-slate-500">Send the key in the <code className="bg-slate-100 px-1 rounded">Authorization</code> header:</p>
        <pre className="text-xs bg-slate-100 rounded-lg px-3 py-2 overflow-x-auto">
{`Authorization: Bearer wcrm_<your-key>

# Example: create a record
curl -X POST https://yourapp.com/api/data-tables/TABLE_ID/records \\
  -H "Authorization: Bearer wcrm_..." \\
  -H "Content-Type: application/json" \\
  -d '{"data": {"name": "Alice", "score": 99}}'`}
        </pre>
      </div>
    </div>
  )
}
