'use client'

/**
 * Settings → Google: the Google Connections Hub.
 *
 *   1 · Google app      — paste the app details; "Verify" checks each one
 *                          (client ID, secret, redirect URI, Picker key)
 *                          without anyone signing in.
 *   2 · Google account  — which account is connected, since when, health.
 *   3 · Services        — one card per service (services.ts). Tick several
 *                          and "Connect selected" asks Google once; or use a
 *                          card's own Connect. Google lets people untick
 *                          single permissions, so each card shows what was
 *                          actually granted: Connected, Missing permission…
 *   Activity            — who connected, verified or switched off what.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, CircleHelp, ClipboardList, Copy, ExternalLink, FileSpreadsheet,
  HardDrive, History, KeyRound, Loader2, LogOut, Mail, RefreshCw, Send, ShieldCheck, Store, Users, XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/hooks/use-confirm'
import { apiFetch, errorText } from '@/lib/api-fetch'
import { GoogleCalendarSettings } from './google-calendar-settings'
import { GoogleContactsImport } from './google-contacts-import'
import { GoogleFormsLinks } from './google-forms-links'
import { GOOGLE_SERVICES, LEVEL_TEXT, type GoogleServiceId, type ServiceState } from '@/lib/google/services'

interface Check { id: string; label: string; ok: boolean | null; detail: string }

interface GoogleConfig {
  configured: boolean
  connected: boolean
  status: string
  google_email: string | null
  connected_at: string | null
  last_health_at: string | null
  client_id: string
  has_secret: boolean
  has_api_key: boolean
  last_error: string | null
  checks: Check[] | null
  checks_at: string | null
  verified: boolean
  redirect_uri: string
  javascript_origin: string
  sheet_links: number
  services: Array<{ id: GoogleServiceId; state: ServiceState; granted: boolean }>
  activity: Array<{ id: string; action: string; detail: string | null; at: string }>
}

const ICONS: Record<GoogleServiceId, LucideIcon> = {
  sheets: FileSpreadsheet,
  drive: HardDrive,
  gmail_send: Send,
  gmail_inbox: Mail,
  calendar: CalendarDays,
  contacts: Users,
  forms: ClipboardList,
  business_profile: Store,
}

const STATE_PILL: Record<ServiceState, { label: string; cls: string }> = {
  connected: { label: 'Connected', cls: 'bg-emerald-50 text-emerald-700' },
  missing_permission: { label: 'Missing permission', cls: 'bg-amber-50 text-amber-700' },
  off: { label: 'Not connected', cls: 'bg-slate-100 text-slate-500' },
  coming: { label: 'Coming soon', cls: 'bg-indigo-50 text-indigo-600' },
}

const LEVEL_CLS = {
  basic: 'bg-emerald-50 text-emerald-700',
  sensitive: 'bg-sky-50 text-sky-700',
  restricted: 'bg-rose-50 text-rose-700',
} as const

const ACTIVITY_TEXT: Record<string, string> = {
  app_saved: 'Google app details saved',
  app_removed: 'Google app removed',
  verified: 'App details verified',
  connected: 'Google account connected',
  services_added: 'Services connected',
  disconnected: 'Google account disconnected',
  service_on: 'Service switched on',
  service_off: 'Service switched off',
  permissions_changed: 'Google permissions changed',
  health_failed: 'Health check failed',
}

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

function CheckIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
  if (ok === false) return <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
  return <CircleHelp className="h-4 w-4 shrink-0 text-amber-500" />
}

function Step({ n, title, done, children, right }: { n: number; title: string; done?: boolean; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-800">{title}</h3>
        {right}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

export function GoogleSettings() {
  const router = useRouter()
  const params = useSearchParams()
  const confirm = useConfirm()
  const [cfg, setCfg] = useState<GoogleConfig | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [editingApp, setEditingApp] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<GoogleServiceId>>(new Set())

  const load = useCallback(async () => {
    try {
      const data = (await (await apiFetch('/api/google/config', { cache: 'no-store' })).json()) as GoogleConfig
      setCfg(data)
      setClientId(data.client_id)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // The result of the consent screen, carried back in the address; shown once.
  useEffect(() => {
    const outcome = params.get('google')
    if (!outcome) return
    const reason = params.get('reason')
    if (outcome === 'connected') toast.success(reason ? `Connected: ${reason}` : 'Google connected')
    else if (outcome === 'partial') toast.warning(reason || 'Some services were not allowed')
    else if (outcome === 'error') toast.error(reason || 'Connecting Google failed')
    else if (outcome === 'setup') toast.info('Save the Google app details first.')
    router.replace('/settings?tab=google', { scroll: false })
  }, [params, router])

  async function run(key: string, fn: () => Promise<void>, fallback: string) {
    if (busy) return
    setBusy(key)
    try {
      await fn()
    } catch (err) {
      toast.error(errorText(err, fallback))
    } finally {
      setBusy(null)
      void load()
    }
  }

  const saveApp = (e: React.FormEvent) => {
    e.preventDefault()
    void run('save', async () => {
      const res = (await (await apiFetch('/api/google/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId.trim(), client_secret: secret.trim() || undefined, api_key: apiKey.trim() || undefined }),
      })).json()) as { checks?: Check[] }
      setSecret('')
      setApiKey('')
      setEditingApp(false)
      const failed = (res.checks ?? []).filter((c) => c.ok === false)
      if (failed.length) toast.warning(`Saved, but check: ${failed.map((c) => c.label).join(', ')}`)
      else toast.success('Saved and verified.')
    }, 'Could not save')
  }

  const verify = () =>
    run('verify', async () => {
      const res = (await (await apiFetch('/api/google/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify' }),
      })).json()) as { checks: Check[] }
      const failed = res.checks.filter((c) => c.ok === false)
      if (failed.length) toast.warning(`Needs attention: ${failed.map((c) => c.label).join(', ')}`)
      else toast.success('All checks passed.')
    }, 'Could not verify')

  function connect(ids: readonly GoogleServiceId[], switching = false) {
    if (ids.length === 0) return
    window.location.href = `/api/google/connect?services=${ids.join(',')}${switching ? '&switch=1' : ''}`
  }

  const toggleService = (id: GoogleServiceId, enabled: boolean) =>
    run(`svc-${id}`, async () => {
      const res = await fetch('/api/google/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: id, enabled }),
      })
      if (res.status === 409) { connect([id]); return }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Could not change the service')
      }
      toast.success(enabled ? 'Switched on' : 'Switched off — the CRM no longer uses it')
    }, 'Could not change the service')

  async function disconnect(what: 'account' | 'all') {
    const ok = await confirm({
      title: what === 'all' ? 'Remove the Google app and account?' : 'Disconnect the Google account?',
      description:
        what === 'all'
          ? 'Every Google service stops, sheet links are removed, and the app details are forgotten. Sheets in Google Drive are not touched.'
          : 'Every Google service stops and Google revokes the CRM’s access. The app details stay, so connecting again is one click.',
      confirmLabel: what === 'all' ? 'Remove' : 'Disconnect',
      variant: 'destructive',
    })
    if (!ok) return
    await run(`disconnect-${what}`, async () => {
      await apiFetch(`/api/google/config?what=${what}`, { method: 'DELETE' })
      toast.success(what === 'all' ? 'Google removed' : 'Google account disconnected')
      if (what === 'all') setClientId('')
    }, 'Could not disconnect')
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Could not copy — select it and copy by hand'),
    )
  }

  const serviceInfo = useMemo(() => new Map((cfg?.services ?? []).map((s) => [s.id, s])), [cfg])

  if (loadFailed) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
        Google settings could not be loaded. Only admins can set this up.{' '}
        <button type="button" className="font-semibold underline" onClick={() => void load()}>Try again</button>
      </div>
    )
  }
  if (!cfg) return <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />

  const detailsChanged = clientId.trim() !== cfg.client_id || secret.trim() !== '' || apiKey.trim() !== ''
  const showAppForm = !cfg.configured || editingApp
  const failedChecks = (cfg.checks ?? []).filter((c) => c.ok === false)
  const appPill = !cfg.configured
    ? { label: 'Not set up', cls: 'bg-slate-100 text-slate-500' }
    : cfg.verified
      ? { label: 'Verified', cls: 'bg-emerald-50 text-emerald-700' }
      : { label: failedChecks.length ? 'Needs attention' : 'Not verified', cls: 'bg-amber-50 text-amber-700' }
  const selectable = (id: GoogleServiceId) => {
    const s = serviceInfo.get(id)
    return Boolean(s && (s.state === 'off' || s.state === 'missing_permission'))
  }
  const selectedList = [...selected].filter(selectable)
  // The services this account uses — what a reconnect or account switch
  // asks for again (Sheets when nothing is on yet).
  const inUse: GoogleServiceId[] = (() => {
    const on = cfg.services.filter((s) => s.state === 'connected' || s.state === 'missing_permission').map((s) => s.id)
    return on.length ? on : ['sheets']
  })()

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <GoogleLogo className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-slate-900">Google</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500">
            Connect your Google app once, then choose the Google services the CRM may use. Each service asks Google only for what it needs.
          </p>
        </div>
      </div>

      {/* ── 1 · Google app ─────────────────────────────────────── */}
      <Step
        n={1}
        title="Google app"
        done={cfg.verified}
        right={<span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${appPill.cls}`}>{appPill.label}</span>}
      >
        {cfg.configured && cfg.checks && (
          <div className="mb-4 space-y-2">
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {cfg.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2.5 px-3 py-2">
                  <CheckIcon ok={c.ok} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-slate-800">{c.label}</p>
                    <p className="break-words text-[11.5px] text-slate-500 [overflow-wrap:anywhere]">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void verify()} disabled={!!busy}>
                {busy === 'verify' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                Verify again
              </Button>
              {!showAppForm && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingApp(true)}>Edit app details</Button>
              )}
              <span className="text-[11px] text-slate-400">Checked {when(cfg.checks_at)}</span>
            </div>
          </div>
        )}

        {showAppForm && (
          <form onSubmit={saveApp} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-client" className="text-[12px] text-slate-600">OAuth client ID</Label>
              <Input id="g-client" value={clientId} onChange={(e) => setClientId(e.target.value)}
                placeholder="1234567890-abc123.apps.googleusercontent.com" autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="g-secret" className="flex items-center gap-1.5 text-[12px] text-slate-600">
                  <KeyRound className="h-3.5 w-3.5 text-slate-400" /> Client secret
                </Label>
                <Input id="g-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
                  placeholder={cfg.has_secret ? 'Saved — paste only to replace' : 'GOCSPX-…'} autoComplete="new-password" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-key" className="flex items-center gap-1.5 text-[12px] text-slate-600">
                  <KeyRound className="h-3.5 w-3.5 text-slate-400" /> Picker API key
                </Label>
                <Input id="g-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={cfg.has_api_key ? 'Saved — paste only to replace' : 'AIza…'} autoComplete="new-password" spellCheck={false} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">Stored encrypted. Never shown again.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!!busy || !detailsChanged}>
                {busy === 'save' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save &amp; verify
              </Button>
              {cfg.configured && (
                <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingApp(false); setClientId(cfg.client_id); setSecret(''); setApiKey('') }}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}

        <div className="mt-4 space-y-2">
          {[
            { label: 'Authorized redirect URI', value: cfg.redirect_uri },
            { label: 'Authorized JavaScript origin', value: cfg.javascript_origin },
          ].map((row) => (
            <div key={row.label} className="space-y-1">
              <Label className="text-[11.5px] text-slate-500">{row.label} — add exactly as shown in Google Cloud</Label>
              <div className="flex items-center gap-2">
                <code title={row.value} className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] text-slate-700">
                  {row.value}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={() => copy(row.value)} aria-label={`Copy ${row.label}`}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <details className="group mt-4 rounded-xl border border-slate-200 p-3 text-[12.5px] leading-relaxed text-slate-600">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-slate-700">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> How to create the Google app (once, about 30 minutes)
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>
              Sign in to{' '}
              <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:underline">
                Google Cloud <ExternalLink className="h-3 w-3" />
              </a>{' '}
              with the business&apos;s Google account (a normal Gmail is fine) and create a project.
            </li>
            <li>
              APIs &amp; Services → Library: enable <b>Google Sheets API</b>, <b>Google Drive API</b> and <b>Google Picker API</b> —
              and, for the services you will use, <b>Gmail API</b>, <b>Google Calendar API</b>, <b>People API</b>.
            </li>
            <li>
              OAuth consent screen → External. App name, support email, logo, home page, privacy policy. Then <b>Publish app</b> — left in
              Testing, the connection stops working after 7 days.
            </li>
            <li>Credentials → Create credentials → OAuth client ID → Web application. Add the redirect URI and JavaScript origin above.</li>
            <li>
              Credentials → Create credentials → API key. Restrict it to <b>Google Picker API</b> and to this website (HTTP referrer{' '}
              <code className="rounded bg-slate-100 px-1">{`${cfg.javascript_origin}/*`}</code>).
            </li>
            <li>Paste the three values above and press Save &amp; verify.</li>
          </ol>
        </details>
      </Step>

      {/* ── 2 · Google account ─────────────────────────────────── */}
      <Step
        n={2}
        title="Google account"
        done={cfg.connected}
        right={cfg.connected ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Connected</span> : undefined}
      >
        {cfg.connected ? (
          <div className="space-y-3">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-slate-800" title={cfg.google_email ?? undefined}>{cfg.google_email ?? 'Google account'}</p>
              <p className="text-[11.5px] text-slate-500">Connected {when(cfg.connected_at)} · last health check {when(cfg.last_health_at)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!!busy}
                onClick={() => connect(inUse, true)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Switch account
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => void disconnect('account')}
                className="border-rose-200 text-rose-600 hover:bg-rose-50">
                {busy === 'disconnect-account' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LogOut className="mr-1.5 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-slate-500">
            {cfg.configured
              ? 'Choose the services below and press Connect selected — Google then asks you to sign in.'
              : 'Set up the Google app first.'}
          </p>
        )}
        {cfg.status === 'error' && cfg.last_error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="break-words">{cfg.last_error}</p>
              <button type="button" className="mt-1 font-semibold underline"
                onClick={() => connect(inUse)}>
                Reconnect
              </button>
            </div>
          </div>
        )}
      </Step>

      {/* ── 3 · Services ───────────────────────────────────────── */}
      <Step n={3} title="Services" done={cfg.services.some((s) => s.state === 'connected')}>
        <div className="grid gap-3 md:grid-cols-2">
          {GOOGLE_SERVICES.map((svc) => {
            const info = serviceInfo.get(svc.id)
            const state = info?.state ?? 'off'
            const Icon = ICONS[svc.id]
            const canSelect = cfg.configured && selectable(svc.id)
            const pill = STATE_PILL[state]
            const level = LEVEL_TEXT[svc.level]
            return (
              <article
                key={svc.id}
                className={`flex flex-col rounded-2xl border p-4 transition-colors ${state === 'coming' ? 'border-dashed border-slate-200 bg-slate-50/50' : selected.has(svc.id) ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex items-start gap-3">
                  {canSelect ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${svc.name}`}
                      checked={selected.has(svc.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(svc.id)
                          else next.delete(svc.id)
                          return next
                        })
                      }
                      className="mt-2.5 h-4 w-4 shrink-0 accent-indigo-600"
                    />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${state === 'coming' ? 'bg-slate-100 text-slate-400' : 'bg-slate-50 text-slate-700'}`}>
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h4 className="text-[13.5px] font-semibold text-slate-800">{svc.name}</h4>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${pill.cls}`}>{pill.label}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{svc.summary}</p>
                  </div>
                </div>

                <ul className="mt-2.5 space-y-1 pl-[52px] text-[11.5px] text-slate-600">
                  {svc.features.map((f) => (
                    <li key={f} className="flex gap-1.5"><span className="text-slate-300">•</span><span>{f}</span></li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px]">
                  <span title={level.explain} className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${LEVEL_CLS[svc.level]}`}>{level.label}</span>
                  <span className="flex-1" />
                  {state === 'connected' && (
                    <>
                      {svc.openHref && (
                        <a href={svc.openHref} className="text-[12px] font-medium text-indigo-600 hover:underline">Open</a>
                      )}
                      <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => void toggleService(svc.id, false)}>
                        {busy === `svc-${svc.id}` && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Turn off
                      </Button>
                    </>
                  )}
                  {state === 'missing_permission' && (
                    <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => connect([svc.id])}>Fix permission</Button>
                  )}
                  {state === 'off' && cfg.configured && (
                    info?.granted ? (
                      <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void toggleService(svc.id, true)}>
                        {busy === `svc-${svc.id}` && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Turn on
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => connect([svc.id])}>Connect</Button>
                    )
                  )}
                </div>
                {state === 'missing_permission' && (
                  <p className="mt-2 pl-[52px] text-[11.5px] text-amber-700">
                    Google did not allow everything this needs. Connect again and keep every checkbox ticked on Google&apos;s screen.
                  </p>
                )}
                {svc.id === 'calendar' && state === 'connected' && <GoogleCalendarSettings />}
                {svc.id === 'contacts' && state === 'connected' && <GoogleContactsImport />}
                {svc.id === 'forms' && state === 'connected' && <GoogleFormsLinks />}
                {svc.level !== 'basic' && state !== 'coming' && (
                  <p className="mt-2 pl-[52px] text-[11px] leading-relaxed text-slate-400">{level.explain}</p>
                )}
              </article>
            )
          })}
        </div>

        {cfg.configured && (
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <p className="min-w-0 flex-1 text-[12.5px] text-slate-600">
              {selectedList.length === 0
                ? 'Tick the services to connect — Google asks for all of them on one screen.'
                : `${selectedList.length} selected: ${selectedList.map((id) => GOOGLE_SERVICES.find((s) => s.id === id)?.name).join(', ')}`}
            </p>
            <button
              type="button"
              disabled={selectedList.length === 0 || !!busy}
              onClick={() => connect(selectedList)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleLogo className="h-4 w-4" /> Connect selected
            </button>
          </div>
        )}
        {cfg.configured && !cfg.verified && (
          <p className="mt-2 text-[11.5px] text-amber-700">Verify the Google app first — a failed check usually means Google will refuse the sign-in.</p>
        )}
      </Step>

      {/* ── Activity ───────────────────────────────────────────── */}
      {cfg.activity.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-800"><History className="h-4 w-4 text-slate-400" /> Activity</h3>
          <ul className="mt-3 space-y-2">
            {cfg.activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-[12px]">
                <span className="w-28 shrink-0 text-slate-400">{when(a.at)}</span>
                <span className="min-w-0 flex-1 text-slate-700">
                  {ACTIVITY_TEXT[a.action] ?? a.action}
                  {a.detail && <span className="block break-words text-[11.5px] text-slate-500 [overflow-wrap:anywhere]">{a.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cfg.configured && (
        <div className="flex justify-end">
          <button type="button" onClick={() => void disconnect('all')} disabled={!!busy}
            className="text-[12px] font-medium text-rose-600 hover:underline disabled:opacity-50">
            Remove the Google app from this CRM
          </button>
        </div>
      )}
    </div>
  )
}
