'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { KeyRound, Plus, Trash2, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog'

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
  const reduceMotion = useReducedMotion()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [newRawKey, setNewRawKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState(false)

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

  async function revoke() {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await fetch(`/api/api-keys/${revokeTarget.id}`, { method: 'DELETE' })
      setKeys((prev) => prev.filter((k) => k.id !== revokeTarget.id))
      setRevokeTarget(null)
    } finally {
      setRevoking(false)
    }
  }

  async function copyKey() {
    if (!newRawKey) return
    await navigator.clipboard.writeText(newRawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
          <KeyRound className="h-4.5 w-4.5 text-[#5B6CF9]" />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">API Keys</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Generate secret keys so external apps can read and write Data Store records via the REST API.
          </p>
        </div>
      </div>

      {newRawKey && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[13px] font-medium text-amber-800">
              Copy this key now — it will never be shown again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-xl bg-white border border-amber-200 px-3 py-2 text-[12px] font-mono break-all">
              {newRawKey}
            </code>
            <button
              onClick={copyKey}
              className="shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-2 text-amber-700 hover:bg-amber-100 transition-colors"
              title="Copy"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button onClick={() => setNewRawKey(null)} className="text-[12px] text-amber-700 underline underline-offset-2">
            I have copied it, close this
          </button>
        </div>
      )}

      {showForm ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-3">
          <p className="text-[13px] font-semibold text-slate-800">New API Key</p>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            placeholder="e.g. My Integration"
            className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none transition-all focus:border-[#5B6CF9]/40 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/10"
          />
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={create} disabled={creating} className="h-9 px-4 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : 'Create Key'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setError('') }} className="h-9 px-4 text-[13px] border-slate-200">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-[13px] text-slate-500 hover:border-[#5B6CF9]/50 hover:text-[#5B6CF9] transition-colors"
        >
          <Plus className="h-4 w-4" />
          New API Key
        </button>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm py-10 text-center text-[13px] text-slate-400">No API keys yet.</div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-500">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-500">Prefix</th>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-500">Last used</th>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-500">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((k, i) => (
                  <motion.tr
                    key={k.id}
                    className="bg-white hover:bg-slate-50"
                    initial={reduceMotion ? undefined : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{k.name}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11.5px]">{k.key_prefix}…</code>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[12px]">{fmt(k.last_used_at)}</td>
                    <td className="px-4 py-3 text-slate-500 text-[12px]">{fmt(k.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setRevokeTarget(k)}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Revoke"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-2">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Usage</p>
        <p className="text-[13px] text-slate-500">Send the key in the <code className="bg-slate-200/70 px-1 rounded text-[12px]">Authorization</code> header:</p>
        <pre className="text-[11.5px] bg-white border border-slate-200 rounded-xl px-3 py-2.5 overflow-x-auto">
{`Authorization: Bearer wcrm_<your-key>

# Example: create a record
curl -X POST https://yourapp.com/api/data-tables/TABLE_ID/records \\
  -H "Authorization: Bearer wcrm_..." \\
  -H "Content-Type: application/json" \\
  -d '{"data": {"name": "Alice", "score": 99}}'`}
        </pre>
      </div>

      <ConfirmIconDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        icon={KeyRound}
        tone="danger"
        title="Revoke this API key?"
        description={<>Any app using &quot;{revokeTarget?.name}&quot; will immediately lose access. This can&apos;t be undone.</>}
        actionLabel="Revoke"
        actionPendingLabel="Revoking…"
        onConfirm={revoke}
        pending={revoking}
      />
    </div>
  )
}
