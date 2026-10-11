'use client'

/**
 * Settings → Google.
 *
 * The account's own Google Cloud OAuth app (client id, secret and the
 * Picker's API key), then "Connect with Google". Once connected, private
 * Google Sheets can be used as AI knowledge (AI Config → Training), and a
 * Data Store table can send its new records to a sheet or import one
 * (the table's ⋯ menu → Google Sheet).
 *
 * The guide is here, next to the fields, because every value it asks for
 * comes from a different screen of Google Cloud and the order matters.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, LogOut, RefreshCw, Sheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/hooks/use-confirm'
import { apiFetch, errorText } from '@/lib/api-fetch'

interface GoogleConfig {
  configured: boolean
  connected: boolean
  status: string
  google_email: string | null
  client_id: string
  has_secret: boolean
  has_api_key: boolean
  last_error: string | null
  redirect_uri: string
  javascript_origin: string
  sheet_links: number
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

export function GoogleSettings() {
  const router = useRouter()
  const params = useSearchParams()
  const confirm = useConfirm()
  const [cfg, setCfg] = useState<GoogleConfig | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

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
    if (outcome === 'connected') toast.success('Google connected')
    else if (outcome === 'error') toast.error(reason || 'Connecting Google failed')
    else if (outcome === 'setup') toast.info('Save the Google app details first.')
    router.replace('/settings?tab=google', { scroll: false })
  }, [params, router])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await apiFetch('/api/google/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId.trim(), client_secret: secret.trim() || undefined, api_key: apiKey.trim() || undefined }),
      })
      setSecret('')
      setApiKey('')
      toast.success(cfg?.connected ? 'Saved.' : 'Saved. Now connect with Google.')
      await load()
    } catch (err) {
      toast.error(errorText(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'Disconnect Google?',
      description:
        'Private sheets stop syncing to the AI, and tables stop sending records to their sheets. Sheets already in Google Drive are not touched.',
      confirmLabel: 'Disconnect',
      variant: 'destructive',
    })
    if (!ok) return
    setBusy(true)
    try {
      await apiFetch('/api/google/config', { method: 'DELETE' })
      toast.success('Google disconnected')
      setClientId('')
      await load()
    } catch (err) {
      toast.error(errorText(err, 'Could not disconnect'))
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

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50">
            <GoogleLogo className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-slate-800">Google Sheets</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Private sheets as AI knowledge, new records written to a sheet, and a sheet&apos;s rows imported into a table.
              The CRM can open only the sheets you choose, or ones it creates — never the rest of your Drive.
            </p>
          </div>
          {cfg.connected && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected
            </span>
          )}
        </div>

        <div className="space-y-5 px-6 py-5">
          {cfg.connected && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-slate-800">
                <Sheet className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="truncate" title={cfg.google_email ?? undefined}>{cfg.google_email ?? 'Google account'}</span>
              </p>
              <p className="mt-1 text-[12px] text-slate-600">
                {cfg.sheet_links > 0 ? `${cfg.sheet_links} table sheet link${cfg.sheet_links === 1 ? '' : 's'}. ` : ''}
                Use it in AI Config → Training (Google Sheet → Choose from Google Drive) and in a Data Store table&apos;s ⋯ menu → Google Sheet.
              </p>
              {!cfg.has_api_key && (
                <p className="mt-2 text-[12px] text-amber-700">Add the Picker API key below — without it, sheets cannot be chosen.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = '/api/google/connect' }}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reconnect / change account
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
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">1 · Google Cloud app details</p>
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
            {[
              { label: 'Authorized redirect URI', value: cfg.redirect_uri },
              { label: 'Authorized JavaScript origin', value: cfg.javascript_origin },
            ].map((row) => (
              <div key={row.label} className="space-y-1.5">
                <Label className="text-[12px] text-slate-600">{row.label} — add exactly as shown</Label>
                <div className="flex items-center gap-2">
                  <code title={row.value} className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                    {row.value}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(row.value)} aria-label={`Copy ${row.label}`}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="submit" size="sm" disabled={saving || !detailsChanged}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save app details
            </Button>
          </form>

          {/* ── Step 2: connect ──────────────────────────────── */}
          {!cfg.connected && (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">2 · Connect</p>
              <p className="text-[12px] text-slate-500">Sign in with the Google account that owns (or can open) the sheets.</p>
              <button
                type="button"
                disabled={!cfg.configured || detailsChanged}
                onClick={() => { window.location.href = '/api/google/connect' }}
                className="inline-flex h-10 items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GoogleLogo className="h-4 w-4" /> Connect with Google
              </button>
              {(!cfg.configured || detailsChanged) && (
                <p className="text-[11px] text-slate-400">Save the app details first.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── The one-time Google Cloud setup ───────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-[12.5px] leading-relaxed text-slate-600 shadow-sm">
        <h4 className="text-[13px] font-semibold text-slate-800">Setting up the Google Cloud app (once, about 30 minutes)</h4>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            Sign in to{' '}
            <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:underline">
              Google Cloud <ExternalLink className="h-3 w-3" />
            </a>{' '}
            with the business&apos;s Google account (a normal Gmail is fine) and create a project.
          </li>
          <li>APIs &amp; Services → Library: enable <b>Google Sheets API</b>, <b>Google Drive API</b> and <b>Google Picker API</b>.</li>
          <li>
            OAuth consent screen → External. Fill in the app name, support email, logo, home page and privacy policy. Under Scopes add
            only <code className="rounded bg-slate-100 px-1">…/auth/drive.file</code>. Then <b>Publish app</b> — left in Testing, the
            connection stops working after 7 days.
          </li>
          <li>
            Credentials → Create credentials → OAuth client ID → Web application. Add the redirect URI and JavaScript origin shown
            above. Copy the client ID and client secret here.
          </li>
          <li>
            Credentials → Create credentials → API key. Restrict it to <b>Google Picker API</b> and to this website (HTTP referrer{' '}
            <code className="rounded bg-slate-100 px-1">{`${cfg.javascript_origin}/*`}</code>). Paste it as the Picker API key.
          </li>
          <li>
            Google may show &ldquo;Google hasn&apos;t verified this app&rdquo; until the brand is verified (a few days; the website&apos;s
            domain must be verified in Google Search Console). Choose Advanced → Continue meanwhile.
          </li>
        </ol>
      </div>
    </div>
  )
}
