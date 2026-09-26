'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Copy, KeyRound, Loader2, LogOut, Mail, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/hooks/use-confirm'

interface MsConfig {
  configured: boolean
  tenant_id: string
  client_id: string
  has_secret: boolean
  mailbox_email: string | null
  mailbox_name: string | null
  status: 'not_connected' | 'connected' | 'error' | string
  last_error: string | null
  subscription_expires_at: string | null
  redirect_uri: string
}

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  )
}

/**
 * Settings → Email → "Connect with Microsoft".
 *
 * Two steps, in the order they happen: an admin pastes the app
 * registration's three values (kept encrypted in the database; the
 * secret is never shown again), then signs in with the mailbox to
 * connect. Only owners and admins get this far — the API refuses
 * everyone else, and this card hides itself for them.
 */
export function MicrosoftMailCard() {
  const router = useRouter()
  const params = useSearchParams()
  const confirm = useConfirm()
  const [cfg, setCfg] = useState<MsConfig | null>(null)
  const [hidden, setHidden] = useState(false)
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/email/microsoft/config', { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) { setHidden(true); return }
    const data = (await res.json()) as MsConfig
    setCfg(data)
    setTenantId(data.tenant_id)
    setClientId(data.client_id)
  }, [])

  useEffect(() => { void load() }, [load])

  // The result of a sign-in, carried back in the address; shown once.
  useEffect(() => {
    const outcome = params.get('microsoft')
    if (!outcome) return
    const reason = params.get('reason')
    if (outcome === 'connected') toast.success('Microsoft mailbox connected')
    else if (outcome === 'partial') toast.warning(`Connected, but receiving mail is not set up yet${reason ? `: ${reason}` : ''}`)
    else if (outcome === 'error') toast.error(reason || 'Connecting to Microsoft failed')
    router.replace('/settings?tab=channels&channel=email', { scroll: false })
  }, [params, router])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/email/microsoft/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId.trim(), client_id: clientId.trim(), client_secret: secret.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not save'); return }
      setSecret('')
      toast.success('Saved. Now connect the mailbox.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'Disconnect this mailbox?',
      description: 'New email will stop arriving in the Inbox and replies will not be sent from it. Conversations already here stay.',
      confirmLabel: 'Disconnect',
      variant: 'destructive',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/email/microsoft/config', { method: 'DELETE' })
      if (!res.ok) { toast.error('Could not disconnect'); return }
      toast.success('Disconnected')
      await load()
    } finally {
      setBusy(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Could not copy — select it and copy by hand'),
    )
  }

  if (hidden) return null
  if (!cfg) {
    return <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
  }

  const connected = cfg.status === 'connected' || (cfg.status === 'error' && !!cfg.mailbox_email)
  const detailsChanged = tenantId.trim() !== cfg.tenant_id || clientId.trim() !== cfg.client_id || secret.trim() !== ''

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50">
          <MicrosoftLogo className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-slate-800">Microsoft 365 / Outlook mailbox</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            New email arrives in the Inbox; replies go out from the mailbox and appear in its Sent Items.
          </p>
        </div>
        {cfg.status === 'connected' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </span>
        )}
      </div>

      <div className="space-y-5 px-6 py-5">
        {/* ── Connected mailbox ─────────────────────────────── */}
        {connected && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
              <Mail className="h-4 w-4 text-emerald-600" /> {cfg.mailbox_email}
              {cfg.mailbox_name && <span className="font-normal text-slate-500">· {cfg.mailbox_name}</span>}
            </p>
            {cfg.subscription_expires_at && cfg.status === 'connected' && (
              <p className="mt-1 text-[12px] text-slate-600">
                Receiving new mail. Renews itself automatically (next by{' '}
                {new Date(cfg.subscription_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}).
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = '/api/email/microsoft/connect' }}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reconnect / change mailbox
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={busy}
                className="border-rose-200 text-rose-600 hover:bg-rose-50">
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LogOut className="mr-1.5 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {cfg.status === 'error' && cfg.last_error && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{cfg.last_error}</span>
          </div>
        )}

        {/* ── Step 1: app details ───────────────────────────── */}
        <form onSubmit={save} className="space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">1 · App registration (from Microsoft Entra)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ms-tenant" className="text-[12px] text-slate-600">Directory (tenant) ID</Label>
              <Input id="ms-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-client" className="text-[12px] text-slate-600">Application (client) ID</Label>
              <Input id="ms-client" value={clientId} onChange={(e) => setClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-secret" className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <KeyRound className="h-3.5 w-3.5 text-slate-400" /> Client secret — the “Value”, not the Secret ID
            </Label>
            <Input id="ms-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
              placeholder={cfg.has_secret ? 'Saved — paste a new one only to replace it' : 'Paste the secret Value'}
              autoComplete="new-password" spellCheck={false} />
            <p className="text-[11px] text-slate-400">Stored encrypted. It is never shown again, here or anywhere else.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-600">Redirect URI — must be registered in Entra exactly as shown</Label>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                {cfg.redirect_uri}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={() => copy(cfg.redirect_uri)} aria-label="Copy redirect URI">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Button type="submit" size="sm" disabled={saving || !detailsChanged}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save app details
          </Button>
        </form>

        {/* ── Step 2: sign in with the mailbox ──────────────── */}
        {!connected && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">2 · Connect the mailbox</p>
            <p className="text-[12px] text-slate-500">
              Sign in with the mailbox to connect (for example info@yourdomain.com) — not necessarily the admin account.
            </p>
            <button
              type="button"
              disabled={!cfg.configured || detailsChanged}
              onClick={() => { window.location.href = '/api/email/microsoft/connect' }}
              className="inline-flex h-10 items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MicrosoftLogo className="h-4 w-4" /> Connect with Microsoft
            </button>
            {(!cfg.configured || detailsChanged) && (
              <p className="text-[11px] text-slate-400">Save the app details first.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
