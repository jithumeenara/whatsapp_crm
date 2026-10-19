'use client'

/**
 * Settings → Channels → Telegram.
 *
 * Not connected: the two-step setup (make a bot in @BotFather, paste its
 * token). Connected: the same overview WhatsApp has — hero with the bot,
 * connection health, AI replies, the bot's link to share, Telegram
 * Business, and disconnect. Everything shown comes from /api/telegram/config;
 * the token itself never comes back to the browser.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Briefcase,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Inbox,
  KeyRound,
  Loader2,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { TelegramIcon } from '@/components/icons/brand-icons'
import { useConfirm } from '@/hooks/use-confirm'
import { apiFetch, errorText } from '@/lib/api-fetch'
import { cn } from '@/lib/utils'

interface TelegramState {
  connected: boolean
  bot: {
    username: string
    display_name: string | null
    status: string
    last_error: string | null
    last_update_at: string | null
    connected_at: string
    link: string
  } | null
  business: Array<{ user_name: string; enabled: boolean; connected_at: string | null }>
  ai: { assistant_on: boolean; configured: boolean; answers_telegram: boolean }
  totals: { chats_30d: number; ai_replies_30d: number; waiting_for_team: number }
}

function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function ago(iso: string | null | undefined): string {
  if (!iso) return 'No messages yet'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(mins)) return 'No messages yet'
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return when(iso)
}

export function TelegramConfig({ onConnectionChange }: {
  /** Unused — the Channels tab passes it to every channel. */
  defaultConnectMethod?: 'quick' | 'manual'
  onConnectionChange?: (connected: boolean) => void
}) {
  const [data, setData] = useState<TelegramState | null>(null)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/telegram/config', { cache: 'no-store' })
      setData((await res.json()) as TelegramState)
      setLoadError('')
    } catch (err) {
      console.error('[telegram settings] load failed:', err)
      setLoadError(errorText(err, 'Could not load Telegram settings.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loadError && !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-[13px] text-slate-600">{loadError}</p>
        <Button type="button" variant="outline" onClick={() => void load()} className="h-9 px-3.5 text-[12.5px]">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-sky-500" aria-label="Loading" />
      </div>
    )
  }

  return data.connected && data.bot ? (
    <ConnectedOverview
      data={data}
      bot={data.bot}
      reload={load}
      onDisconnected={() => {
        onConnectionChange?.(false)
        void load()
      }}
    />
  ) : (
    <SetupView
      onConnected={() => {
        onConnectionChange?.(true)
        void load()
      }}
    />
  )
}

// ── Not connected ────────────────────────────────────────────────────

function SetupView({ onConnected, replacing = false, onCancel }: { onConnected: () => void; replacing?: boolean; onCancel?: () => void }) {
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const looksRight = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token.trim())

  async function connect() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const body = (await res.json()) as { username?: string }
      toast.success(body.username ? `Connected to @${body.username}` : 'Telegram connected')
      setToken('')
      onConnected()
    } catch (err) {
      console.error('[telegram settings] connect failed:', err)
      const msg = errorText(err, 'Could not connect the bot.')
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const form = (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          <KeyRound className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">{replacing ? 'Use a different bot' : 'Paste your bot token'}</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            The token is stored encrypted and is never shown again. Anyone with it can control the bot — keep it private.
          </p>
        </div>
      </div>
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void connect()
        }}
      >
        <label htmlFor="tg-token" className="text-[12px] font-semibold text-slate-700">
          Bot token
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Input
              id="tg-token"
              name="telegram-bot-token"
              type={show ? 'text' : 'password'}
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setError('')
              }}
              placeholder="1234567890:AAH…"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={100}
              aria-invalid={Boolean(error)}
              aria-describedby="tg-token-help"
              className="h-11 pr-11 font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide token' : 'Show token'}
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button type="submit" disabled={saving || !looksRight} className="h-11 px-5 text-[13px] bg-[#1B78AD] text-white hover:bg-[#166592]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? 'Connecting…' : 'Connect bot'}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving} className="h-11 px-4 text-[13px]">
              Cancel
            </Button>
          )}
        </div>
        <p id="tg-token-help" className={cn('text-[12px]', error ? 'text-rose-700' : 'text-slate-400')} role={error ? 'alert' : undefined}>
          {error || (token && !looksRight ? 'A token looks like 1234567890:AAH… (numbers, a colon, then letters).' : 'Copied from @BotFather after /newbot.')}
        </p>
      </form>
    </div>
  )

  if (replacing) return form

  const steps = [
    { n: 1, title: 'Open @BotFather', copy: 'In the Telegram app, search for @BotFather (blue tick) and press Start.' },
    { n: 2, title: 'Send /newbot', copy: 'Give a display name (your business) and a username ending in “bot”.' },
    { n: 3, title: 'Copy the token', copy: 'BotFather replies with a token like 1234567890:AAH… — copy it.' },
    { n: 4, title: 'Paste it here', copy: 'The CRM checks it, connects the bot and starts receiving chats.' },
  ]

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#EEF8FE] via-[#F7FCFF] to-[#EAF6FD]">
        <div className="relative flex flex-col gap-6 px-7 py-8 sm:flex-row sm:items-center">
          <div className="pointer-events-none absolute right-8 top-7 grid grid-cols-5 gap-2 opacity-40">
            {Array.from({ length: 20 }).map((_, i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-sky-400" />
            ))}
          </div>
          <div className="relative mx-auto h-32 w-32 shrink-0 sm:mx-0">
            <div className="absolute inset-x-5 bottom-1 h-8 rounded-[50%] bg-sky-900/10 blur-md" />
            <div className="absolute inset-x-7 bottom-3 h-20 -rotate-6 rounded-[24px] bg-white shadow-[0_16px_32px_-14px_rgba(15,23,42,0.18)] ring-1 ring-black/5" />
            <div className="absolute left-1/2 top-0 flex h-24 w-24 -translate-x-1/2 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5">
              <TelegramIcon className="h-14 w-14" />
            </div>
          </div>
          <div className="relative min-w-0 flex-1 text-center sm:text-left">
            <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold text-sky-800">
              Step {token ? 2 : 1} of 2
            </span>
            <h2 className="mt-3 text-[19px] font-bold text-slate-900">Telegram bot setup</h2>
            <p className="mt-1 max-w-md text-[13px] text-slate-500">
              Customers message your bot on Telegram; you answer from the Inbox — with your chatbots, the AI assistant and your team.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-[12px] font-semibold text-slate-600">
              <WifiOff className="h-3.5 w-3.5" /> Not connected
            </div>
          </div>
        </div>
        <div className="border-t border-sky-100/70 px-7 py-4">
          <div className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
            {[
              { n: 1, label: 'Create a bot in @BotFather', reached: true, done: Boolean(token) },
              { n: 2, label: 'Paste the token', reached: Boolean(token), done: false },
            ].map((s, i, arr) => (
              <span key={s.n} className="flex items-center gap-2.5">
                <span className="flex items-center gap-1.5">
                  <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', s.reached ? 'bg-[#1B78AD] text-white' : 'bg-slate-100 text-slate-400')}>
                    {s.done ? <Check className="h-3 w-3" /> : s.n}
                  </span>
                  <span className={cn('text-[11.5px]', s.reached ? 'font-semibold text-sky-800' : 'font-medium text-slate-400')}>{s.label}</span>
                </span>
                {i < arr.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-slate-300" />}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Create your bot — 2 minutes, free</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">No business verification and no phone number needed.</p>
          </div>
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            Open @BotFather <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1B78AD] text-[11px] font-bold text-white">{s.n}</span>
              <p className="mt-3 text-[12.5px] font-semibold text-slate-800">{s.title}</p>
              <p className="mt-1 text-[11.5px] leading-5 text-slate-500">{s.copy}</p>
            </li>
          ))}
        </ol>
      </div>

      {form}
    </div>
  )
}

// ── Connected ────────────────────────────────────────────────────────

function HeroStat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: 'ok' }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', tone === 'ok' ? 'bg-emerald-100' : 'bg-slate-100')}>
        <Icon className={cn('h-3.5 w-3.5', tone === 'ok' ? 'text-emerald-700' : 'text-slate-500')} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400">{label}</p>
        <p title={value} className={cn('truncate text-[13px] font-semibold tabular-nums', tone === 'ok' ? 'text-emerald-700' : 'text-slate-800')}>{value}</p>
      </div>
    </div>
  )
}

function ConnectedOverview({
  data,
  bot,
  reload,
  onDisconnected,
}: {
  data: TelegramState
  bot: NonNullable<TelegramState['bot']>
  reload: () => Promise<void>
  onDisconnected: () => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState<'' | 'disconnect' | 'reconnect' | 'ai'>('')
  const [replacing, setReplacing] = useState(false)
  const healthy = bot.status === 'connected'
  const business = data.business ?? []

  async function disconnect() {
    if (busy) return
    const ok = await confirm({
      title: 'Disconnect Telegram?',
      description: `@${bot.username} stops receiving messages in the CRM. Chats and contacts stay; you can connect again any time.`,
      confirmLabel: 'Disconnect',
      variant: 'destructive',
    })
    if (!ok) return
    setBusy('disconnect')
    try {
      await apiFetch('/api/telegram/config', { method: 'DELETE' })
      toast.success('Telegram disconnected')
      onDisconnected()
    } catch (err) {
      console.error('[telegram settings] disconnect failed:', err)
      toast.error(errorText(err, 'Could not disconnect.'))
    } finally {
      setBusy('')
    }
  }

  async function reconnect() {
    if (busy) return
    setBusy('reconnect')
    try {
      await apiFetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reconnect: true }),
      })
      toast.success('Connection checked — Telegram will deliver here')
      await reload()
    } catch (err) {
      console.error('[telegram settings] reconnect failed:', err)
      toast.error(errorText(err, 'Could not reconnect.'))
      await reload()
    } finally {
      setBusy('')
    }
  }

  async function setAi(on: boolean) {
    if (busy) return
    setBusy('ai')
    try {
      await apiFetch('/api/telegram/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_auto_reply: on }),
      })
      toast.success(on ? 'The AI assistant now answers Telegram' : 'The AI assistant no longer answers Telegram')
      await reload()
    } catch (err) {
      console.error('[telegram settings] AI toggle failed:', err)
      toast.error(errorText(err, 'Could not save.'))
    } finally {
      setBusy('')
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(bot.link)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy — select the link and copy it by hand.')
    }
  }

  const health = [
    { label: 'Bot token', value: healthy ? 'Valid' : 'Needs attention', ok: healthy, icon: KeyRound },
    { label: 'Webhook', value: healthy ? 'Delivering here' : 'Not delivering', ok: healthy, icon: Globe },
    { label: 'Last message received', value: ago(bot.last_update_at), ok: true, icon: Inbox },
    { label: 'Telegram Business', value: business.some((b) => b.enabled) ? 'Linked' : 'Not linked', ok: true, icon: Briefcase },
  ]

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-[#EEF8FE] via-[#F7FCFF] to-[#EAF6FD] p-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative mx-auto shrink-0 sm:mx-0">
            <span className="flex h-28 w-28 items-center justify-center rounded-full bg-white shadow-[0_10px_30px_rgba(34,158,217,0.2)] ring-8 ring-sky-50">
              <TelegramIcon className="h-16 w-16" />
            </span>
            <span
              className={cn('absolute -right-1 bottom-1 flex h-9 w-9 items-center justify-center rounded-full ring-4 ring-white', healthy ? 'bg-emerald-500' : 'bg-amber-500')}
            >
              {healthy ? <CheckCircle2 className="h-5 w-5 text-white" /> : <AlertTriangle className="h-5 w-5 text-white" />}
            </span>
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold', healthy ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')}>
                {healthy ? 'Connected' : 'Needs attention'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                <Bot className="h-3 w-3" /> via Bot API
              </span>
            </div>
            <h2 className="mt-3 text-[22px] font-bold tracking-tight text-slate-900">Telegram is connected</h2>
            <p className="mt-1.5 break-words text-[13px] text-slate-500">
              {bot.display_name ? `${bot.display_name} · ` : ''}@{bot.username} receives customer messages in your Inbox.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
              <a
                href={bot.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" /> Open in Telegram
              </a>
              <Button type="button" variant="outline" onClick={() => setReplacing((v) => !v)} disabled={Boolean(busy)} className="h-10 px-4 text-[13px]">
                <KeyRound className="h-4 w-4" /> Change bot
              </Button>
              <Button type="button" onClick={() => void disconnect()} disabled={Boolean(busy)} className="h-10 bg-[#1B78AD] px-4 text-[13px] text-white hover:bg-[#166592]">
                {busy === 'disconnect' ? <><Loader2 className="h-4 w-4 animate-spin" />Disconnecting…</> : 'Disconnect'}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 rounded-xl border border-sky-100 bg-white/70 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat icon={CheckCircle2} label="Connection status" value={healthy ? 'Active' : 'Error'} tone={healthy ? 'ok' : undefined} />
          <HeroStat icon={Bot} label="Bot username" value={`@${bot.username}`} />
          <HeroStat icon={CalendarClock} label="Connected on" value={when(bot.connected_at)} />
          <HeroStat icon={MessageCircle} label="Chats · 30 days" value={String(data.totals.chats_30d)} />
        </div>
      </div>

      {replacing && (
        <SetupView
          replacing
          onCancel={() => setReplacing(false)}
          onConnected={() => {
            setReplacing(false)
            void reload()
          }}
        />
      )}

      {/* Connection health */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Connection health</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {healthy ? 'Everything looks good — Telegram delivers customer messages to this CRM.' : 'Telegram is not delivering here. Press Reconnect to fix it.'}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void reconnect()} disabled={Boolean(busy)} className="h-9 shrink-0 px-3.5 text-[12.5px] border-slate-200">
            {busy === 'reconnect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reconnect
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {health.map((h) => (
            <div key={h.label} className="rounded-xl border border-slate-100 bg-white px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11.5px] text-slate-400">{h.label}</p>
                {h.ok ? <h.icon className="h-4 w-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
              </div>
              <p className={cn('mt-1 text-[13.5px] font-semibold', h.ok ? 'text-slate-800' : 'text-amber-700')}>{h.value}</p>
            </div>
          ))}
        </div>
        {bot.last_error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span className="break-words">{bot.last_error}</span>
          </div>
        )}
      </div>

      {/* AI assistant */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-slate-800">AI assistant on Telegram</h3>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
              Same assistant, knowledge and hand-over rules as WhatsApp. Telegram chatbots run first; the assistant answers what no chatbot matched.
            </p>
          </div>
          <div className="flex items-center gap-5 sm:pl-2">
            <div className="text-right">
              <div className="text-[18px] font-semibold leading-none tabular-nums text-slate-900">{data.totals.ai_replies_30d}</div>
              <div className="mt-1 text-[11px] text-slate-500">AI replies · 30d</div>
            </div>
            <div className="text-right">
              <div className="text-[18px] font-semibold leading-none tabular-nums text-slate-900">{data.totals.waiting_for_team}</div>
              <div className="mt-1 text-[11px] text-slate-500">Waiting for team</div>
            </div>
            <Switch
              checked={data.ai.answers_telegram}
              disabled={busy === 'ai' || !data.ai.configured}
              onCheckedChange={(v) => void setAi(v)}
              aria-label="AI replies on Telegram"
            />
          </div>
        </div>
        {!data.ai.configured ? (
          <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/70 px-5 py-2.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Set up the assistant in Settings → AI Config first.
          </div>
        ) : data.ai.answers_telegram && !data.ai.assistant_on ? (
          <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/70 px-5 py-2.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            The assistant itself is off — turn on “Answer messages no chatbot matched” on the Chatbots page.
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Share */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800">
            <Wifi className="h-4 w-4 text-sky-600" /> Your bot’s link
          </h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Put it on your website, Instagram bio, posters or a QR code. A customer opens it, presses Start, and the chat lands in your Inbox.
          </p>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{bot.link}</code>
            <Button type="button" variant="outline" onClick={() => void copyLink()} className="h-8 shrink-0 px-3 text-[12px]">
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <p className="mt-3 text-[11.5px] leading-5 text-slate-400">
            Telegram does not show the customer’s phone number. To get it, open the chat in the Inbox and press “Ask for number” in the contact panel — the customer taps “Share my number” and it is saved.
          </p>
        </section>

        {/* Telegram Business */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800">
            <Briefcase className="h-4 w-4 text-sky-600" /> Answer your personal Telegram (optional)
          </h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            With Telegram Business (Premium), chats sent to your own Telegram account also come to this Inbox, and replies go from your account.
          </p>
          <ol className="mt-4 space-y-2 text-[12.5px] text-slate-600">
            <li className="flex gap-2"><span className="font-semibold text-sky-700">1.</span> Telegram → Settings → Telegram Business → Chatbots</li>
            <li className="flex gap-2"><span className="font-semibold text-sky-700">2.</span> Add <code className="rounded bg-slate-100 px-1">@{bot.username}</code> and allow “Reply to messages”</li>
          </ol>
          {business.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-3 text-[12px] text-slate-400">No business account linked yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {business.map((b, i) => (
                <li key={`${b.user_name}-${i}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-4 py-2.5">
                  <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-700">{b.user_name || 'Business account'}</span>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', b.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                    {b.enabled ? 'Linked' : 'Removed'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
