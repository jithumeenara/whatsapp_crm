'use client'

/**
 * Settings → Channels → Website Bot.
 *
 * One card per chat widget, laid out as editor + live preview:
 *
 *   Appearance  title, welcome, brand colour (solid or gradient), button
 *               animation, side, logo
 *   Behaviour   which websites may show it, "Talk to a person", AI cap
 *   Contact     the menu on the button: WhatsApp numbers, call numbers, bot
 *   Install     a three-step checklist with the code to paste
 *
 * The preview is the real chat window inside a mock browser. Edits are
 * posted to it as they are typed (wc:preview — same-origin only, see
 * public/webchat/frame.js), so it shows the change before anything is
 * saved. Saving goes through apiFetch and the list reloads from what the
 * server returned; the save bar appears only when something changed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, Bot, Check, CheckCircle2, Copy, Globe, Loader2, MessageCircle, Palette,
  Plus, ShieldCheck, Sparkles, Trash2, Users, Wand2, X, Code2, Clock, Workflow, Phone, ChevronRight, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/hooks/use-confirm'
import { apiFetch, errorText } from '@/lib/api-fetch'
import { normalizeDomain } from '@/lib/webchat/domains'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

interface Widget {
  id: string
  public_key: string
  enabled: boolean
  name: string
  title: string
  welcome_message: string
  primary_color: string
  color_style: 'solid' | 'gradient'
  secondary_color: string | null
  launcher_animation: LauncherAnimation
  contact_menu_enabled: boolean
  whatsapp_links: { config_id: string; label: string; phone: string }[]
  call_links: { label: string; phone: string }[]
  whatsapp_prefill: string | null
  position: 'left' | 'right'
  logo_url: string | null
  allowed_domains: string[]
  allow_handoff: boolean
  daily_ai_limit: number
  last_seen_at: string | null
  last_seen_origin: string | null
  snippet: string
  visitors_30d: number
  chats_30d: number
}

interface Overview {
  origin: string
  ai: { assistant_on: boolean; configured: boolean; answers_website: boolean }
  totals: { ai_replies_30d: number; waiting_for_team: number }
  widgets: Widget[]
}

const SWATCHES = ['#4f46e5', '#2563eb', '#0891b2', '#0f766e', '#16a34a', '#ca8a04', '#ea580c', '#e11d48', '#9333ea', '#0f172a']

/** Ready-made pairs for the gradient: primary → second. */
const GRADIENT_PRESETS: [string, string][] = [
  ['#4f46e5', '#9333ea'],
  ['#2563eb', '#06b6d4'],
  ['#0f766e', '#22c55e'],
  ['#ea580c', '#e11d48'],
  ['#e11d48', '#9333ea'],
  ['#da2727', '#f59e0b'],
  ['#0f172a', '#4f46e5'],
  ['#ca8a04', '#ea580c'],
]

type LauncherAnimation = 'none' | 'pulse' | 'bounce' | 'wiggle' | 'float' | 'glow'

const ANIMATIONS: { key: LauncherAnimation; label: string; hint: string }[] = [
  { key: 'none', label: 'None', hint: 'Still' },
  { key: 'pulse', label: 'Pulse', hint: 'Rings ripple out' },
  { key: 'bounce', label: 'Bounce', hint: 'Hops now and then' },
  { key: 'wiggle', label: 'Wiggle', hint: 'A playful shake' },
  { key: 'float', label: 'Float', hint: 'Gently bobs' },
  { key: 'glow', label: 'Glow', hint: 'Shine + soft glow' },
]

/** The button's look, the same rule as public/webchat/widget.js. */
function fillOf(primary: string, style: 'solid' | 'gradient', second: string | null): string {
  if (style === 'solid') return primary
  return `linear-gradient(135deg, ${primary}, ${second || `color-mix(in srgb, ${primary} 72%, #000)`})`
}

/**
 * The same keyframes widget.js draws on the website, for the previews
 * here. Kept as one string so the two cannot drift far: change one, change
 * the other. Stopped for anyone who asked for reduced motion.
 */
const LAUNCHER_KEYFRAMES = `
@media (prefers-reduced-motion: no-preference) {
  .wcp-pulse .wcp-ring { animation: wcp-ring 2.6s cubic-bezier(.2,.6,.3,1) infinite; }
  .wcp-pulse .wcp-ring.r2 { animation-delay: 1.3s; }
  .wcp-bounce .wcp-btn { animation: wcp-bounce 3.4s cubic-bezier(.3,.7,.4,1) infinite; }
  .wcp-wiggle .wcp-btn { animation: wcp-wiggle 4.2s ease-in-out infinite; }
  .wcp-float .wcp-btn { animation: wcp-float 3.2s ease-in-out infinite; }
  .wcp-glow .wcp-btn { animation: wcp-glow 2.8s ease-in-out infinite; }
  .wcp-glow .wcp-btn::after { content: ""; position: absolute; inset: 0; border-radius: 9999px; pointer-events: none;
    background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,.55) 50%, transparent 65%); background-size: 260% 100%;
    animation: wcp-shine 2.8s ease-in-out infinite; }
}
.wcp-ring { opacity: 0; }
@keyframes wcp-ring { 0% { transform: scale(1); opacity: .5 } 100% { transform: scale(1.85); opacity: 0 } }
@keyframes wcp-bounce { 0%,55%,100% { translate: 0 0; scale: 1 1 } 12% { translate: 0 -16%; scale: .96 1.05 } 24% { translate: 0 0; scale: 1.08 .9 }
  32% { translate: 0 -7%; scale: .98 1.02 } 42% { translate: 0 0; scale: 1.03 .97 } }
@keyframes wcp-wiggle { 0%,68%,100% { rotate: 0deg } 72% { rotate: -16deg } 76% { rotate: 14deg } 80% { rotate: -10deg } 84% { rotate: 7deg } 88% { rotate: -3deg } 92% { rotate: 0deg } }
@keyframes wcp-float { 0%,100% { translate: 0 0 } 50% { translate: 0 -12% } }
@keyframes wcp-glow { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--wcp-color) 45%, transparent) }
  50% { box-shadow: 0 0 18px 6px color-mix(in srgb, var(--wcp-color) 45%, transparent) } }
@keyframes wcp-shine { 0% { background-position: 130% 0 } 55%,100% { background-position: -130% 0 } }
`

/** A chat button as the website shows it, animated. */
function LauncherPreview({ size, color, fill, animation }: { size: number; color: string; fill: string; animation: LauncherAnimation }) {
  return (
    <span
      className={cn('relative inline-flex shrink-0', animation !== 'none' && `wcp-${animation}`)}
      style={{ width: size, height: size, ['--wcp-color' as string]: color }}
      aria-hidden="true"
    >
      {animation === 'pulse' && (
        <>
          <span className="wcp-ring absolute inset-0 rounded-full" style={{ background: color }} />
          <span className="wcp-ring r2 absolute inset-0 rounded-full" style={{ background: color }} />
        </>
      )}
      <span
        className="wcp-btn relative flex h-full w-full items-center justify-center overflow-hidden rounded-full text-white shadow-lg"
        style={{ background: fill }}
      >
        <Bot style={{ width: size * 0.45, height: size * 0.45 }} />
      </span>
    </span>
  )
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

/** Small uppercase-free field label, consistent across the card. */
function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-slate-700">
        {children}
      </label>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

export function WebsiteChatSettings() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/website-chat', { cache: 'no-store' })
      setData((await res.json()) as Overview)
      setLoadError(null)
    } catch (err) {
      console.error('[website-chat] load failed:', err)
      setLoadError(errorText(err, 'Could not load Website Bot settings.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createWidget() {
    if (creating) return
    setCreating(true)
    try {
      await apiFetch('/api/website-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      toast.success('Website Bot created — add your website, then copy the install code.')
      await load()
    } catch (err) {
      console.error('[website-chat] create failed:', err)
      toast.error(errorText(err, 'Could not create the Website Bot.'))
    } finally {
      setCreating(false)
    }
  }

  async function setAnswersWebsite(on: boolean) {
    if (aiSaving) return
    setAiSaving(true)
    try {
      await apiFetch('/api/website-chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_auto_reply: on }),
      })
      toast.success(on ? 'The assistant now answers Website Bot chats' : 'Website Bot chats now wait for the team')
      await load()
    } catch (err) {
      console.error('[website-chat] ai toggle failed:', err)
      toast.error(errorText(err, 'Could not change the assistant setting.'))
    } finally {
      setAiSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />
        <div className="h-[560px] animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    )
  }
  if (loadError || !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {loadError ?? 'Could not load Website Bot settings.'}{' '}
        <button type="button" className="font-semibold underline" onClick={() => { setLoading(true); void load() }}>
          Try again
        </button>
      </div>
    )
  }

  const aiLive = data.ai.answers_website && data.ai.assistant_on

  return (
    <div className="space-y-5">
      {/* The assistant */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm shadow-indigo-500/30">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14.5px] font-semibold text-slate-900">AI replies on Website Bot</h3>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  aiLive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', aiLive ? 'bg-emerald-500' : 'bg-slate-400')} />
                {aiLive ? 'Answering' : 'Off'}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
              Same assistant, knowledge and hand-over rules as WhatsApp. Website chatbots run first. Whatever the assistant does
              for you on WhatsApp — registrations, bookings, if you have set them up — opens once the visitor has given a number.
            </p>
          </div>
          <div className="flex items-center gap-5 sm:pl-2">
            <div className="text-right">
              <div className="text-[18px] font-semibold leading-none text-slate-900">{data.totals.ai_replies_30d}</div>
              <div className="mt-1 text-[11px] text-slate-500">AI replies · 30d</div>
            </div>
            <div className="text-right">
              <div className="text-[18px] font-semibold leading-none text-slate-900">{data.totals.waiting_for_team}</div>
              <div className="mt-1 text-[11px] text-slate-500">Waiting for team</div>
            </div>
            <Switch
              checked={data.ai.answers_website}
              disabled={aiSaving || !data.ai.configured}
              onCheckedChange={(v) => void setAnswersWebsite(v)}
              aria-label="AI replies on Website Bot"
            />
          </div>
        </div>
        {!data.ai.configured ? (
          <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/70 px-5 py-2.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Set up the assistant in Settings → AI Config first.
          </div>
        ) : data.ai.answers_website && !data.ai.assistant_on ? (
          <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/70 px-5 py-2.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            The assistant itself is off — turn on “Answer messages no chatbot matched” on the Chatbots page.
          </div>
        ) : null}
      </section>

      {data.widgets.length === 0 ? (
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-[520px] rounded-full bg-indigo-100/60 blur-3xl" />
          <div className="relative">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 ring-8 ring-indigo-50/50">
              <MessageCircle className="h-6 w-6 text-indigo-600" />
            </div>
            <h3 className="mt-4 text-[16px] font-semibold text-slate-900">Add Website Bot to your website</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-500">
              One line of code. Visitors chat from your site; messages land in the Inbox under Website, answered by your chatbots,
              the assistant and your team.
            </p>
            <Button className="mt-5" onClick={() => void createWidget()} disabled={creating}>
              {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              Create Website Bot
            </Button>
          </div>
        </section>
      ) : (
        <>
          {data.widgets.map((w) => (
            <WidgetCard key={w.id} widget={w} onChanged={load} />
          ))}
          <button
            type="button"
            onClick={() => void createWidget()}
            disabled={creating}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 py-4 text-[13px] font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700 disabled:opacity-60"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add another Website Bot (another website or brand)
          </button>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

type Tab = 'appearance' | 'behaviour' | 'contact' | 'install'

interface FormState {
  name: string
  title: string
  welcome_message: string
  primary_color: string
  color_style: 'solid' | 'gradient'
  /** '' = a darker shade of the primary. */
  secondary_color: string
  launcher_animation: LauncherAnimation
  contact_menu_enabled: boolean
  /** Which of the account's WhatsApp numbers, with the name shown. */
  wa_selected: { config_id: string; label: string }[]
  /** As typed: "+91 85900 55117". */
  call_links: { label: string; phone: string }[]
  whatsapp_prefill: string
  position: 'left' | 'right'
  logo_url: string
  domains: string[]
  allow_handoff: boolean
  daily_ai_limit: string
}

function formOf(w: Widget): FormState {
  return {
    name: w.name,
    title: w.title,
    welcome_message: w.welcome_message,
    primary_color: w.primary_color,
    color_style: w.color_style === 'solid' ? 'solid' : 'gradient',
    secondary_color: w.secondary_color ?? '',
    launcher_animation: w.launcher_animation ?? 'none',
    contact_menu_enabled: w.contact_menu_enabled ?? false,
    wa_selected: (Array.isArray(w.whatsapp_links) ? w.whatsapp_links : []).map((l) => ({ config_id: l.config_id, label: l.label })),
    call_links: (Array.isArray(w.call_links) ? w.call_links : []).map((l) => ({ label: l.label, phone: `+${l.phone}` })),
    whatsapp_prefill: w.whatsapp_prefill ?? '',
    position: w.position,
    logo_url: w.logo_url ?? '',
    domains: w.allowed_domains,
    allow_handoff: w.allow_handoff,
    daily_ai_limit: String(w.daily_ai_limit),
  }
}

function WidgetCard({ widget, onChanged }: { widget: Widget; onChanged: () => Promise<void> }) {
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>(widget.allowed_domains.length ? 'appearance' : 'behaviour')
  const [form, setForm] = useState<FormState>(() => formOf(widget))
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)

  // What the server has — the baseline for "unsaved changes" and Discard.
  const saved = useMemo(() => formOf(widget), [widget])
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const colorValid = /^#[0-9a-fA-F]{6}$/.test(form.primary_color)
  const secondValid = form.secondary_color === '' || /^#[0-9a-fA-F]{6}$/.test(form.secondary_color)
  const shownColor = colorValid ? form.primary_color : widget.primary_color
  const shownFill = fillOf(shownColor, form.color_style, secondValid ? form.secondary_color || null : null)
  const limitValid = /^\d{1,6}$/.test(form.daily_ai_limit) && Number(form.daily_ai_limit) <= 100000
  const installed = Boolean(widget.last_seen_at)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Live preview: the frame applies these without a save (same-origin
  // only on its side). Debounced so typing does not repaint every key.
  const pushPreview = useCallback(() => {
    const win = frameRef.current?.contentWindow
    if (!win) return
    win.postMessage(
      {
        type: 'wc:preview',
        title: form.title || 'Chat',
        welcome_message: form.welcome_message,
        primary_color: colorValid ? form.primary_color : widget.primary_color,
        color_style: form.color_style,
        secondary_color: secondValid && form.secondary_color ? form.secondary_color : null,
        logo_url: form.logo_url.startsWith('https://') ? form.logo_url : null,
        allow_handoff: form.allow_handoff,
      },
      window.location.origin,
    )
  }, [form, colorValid, secondValid, widget.primary_color])

  useEffect(() => {
    const t = window.setTimeout(pushPreview, 150)
    return () => window.clearTimeout(t)
  }, [pushPreview])

  async function save() {
    if (saving) return
    if (!colorValid) { toast.error('Colour must look like #4f46e5.'); setTab('appearance'); return }
    if (!secondValid) { toast.error('Second colour must look like #4f46e5.'); setTab('appearance'); return }
    if (!limitValid) { toast.error('AI replies per day is a whole number from 0 to 100000.'); setTab('behaviour'); return }
    setSaving(true)
    try {
      await apiFetch(`/api/website-chat/${widget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          title: form.title,
          welcome_message: form.welcome_message,
          primary_color: form.primary_color,
          color_style: form.color_style,
          secondary_color: form.secondary_color || null,
          launcher_animation: form.launcher_animation,
          contact_menu_enabled: form.contact_menu_enabled,
          call_links: form.call_links.filter((l) => l.phone.trim() || l.label.trim()),
          whatsapp_prefill: form.whatsapp_prefill.trim() || null,
          // Only when changed: saving these reads each number from WhatsApp.
          ...(JSON.stringify(form.wa_selected) !== JSON.stringify(saved.wa_selected) ? { whatsapp_numbers: form.wa_selected } : {}),
          position: form.position,
          logo_url: form.logo_url.trim() || null,
          allowed_domains: form.domains,
          allow_handoff: form.allow_handoff,
          daily_ai_limit: Number(form.daily_ai_limit),
        }),
      })
      toast.success('Saved')
      justSaved.current = true
      await onChanged()
      setPreviewKey((k) => k + 1)
    } catch (err) {
      console.error('[website-chat] save failed:', err)
      toast.error(errorText(err, 'Could not save.'))
    } finally {
      setSaving(false)
    }
  }

  // When the server's copy changes, adopt it — after our own save (it may
  // have normalised a value), or when nothing here was edited. Toggling
  // the chat on or off must not throw away edits in progress.
  const justSaved = useRef(false)
  const lastSaved = useRef(saved)
  useEffect(() => {
    setForm((current) =>
      justSaved.current || JSON.stringify(current) === JSON.stringify(lastSaved.current) ? saved : current,
    )
    justSaved.current = false
    lastSaved.current = saved
  }, [saved])

  async function setEnabled(enabled: boolean) {
    if (toggling) return
    setToggling(true)
    try {
      await apiFetch(`/api/website-chat/${widget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      toast.success(enabled ? 'Chat is live' : 'Chat is off — the button disappears from your website')
      await onChanged()
    } catch (err) {
      console.error('[website-chat] toggle failed:', err)
      toast.error(errorText(err, 'Could not change it.'))
    } finally {
      setToggling(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete this Website Bot?',
      description:
        'The chat button disappears from every website using this code. Conversations and contacts it created stay in the Inbox.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok || deleting) return
    setDeleting(true)
    try {
      await apiFetch(`/api/website-chat/${widget.id}`, { method: 'DELETE' })
      toast.success('Website Bot deleted')
      await onChanged()
    } catch (err) {
      console.error('[website-chat] delete failed:', err)
      toast.error(errorText(err, 'Could not delete it.'))
      setDeleting(false)
    }
  }

  const status = !widget.enabled
    ? { label: 'Off', dot: 'bg-slate-400', cls: 'bg-slate-100 text-slate-600' }
    : installed
      ? { label: `Live on ${widget.last_seen_origin}`, dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700' }
      : { label: 'Waiting for install', dot: 'bg-amber-500', cls: 'bg-amber-50 text-amber-700' }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-100 px-5 py-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ background: shownFill }}
        >
          <MessageCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={form.name}
            maxLength={80}
            onChange={(e) => set('name', e.target.value)}
            aria-label="Name (only you see this)"
            className="w-full max-w-xs truncate rounded-md bg-transparent px-1 -ml-1 text-[14.5px] font-semibold text-slate-900 outline-none hover:bg-slate-50 focus:bg-slate-50 focus:ring-2 focus:ring-indigo-200"
          />
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', status.cls)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
              {status.label}
            </span>
            {installed && <span className="text-[11px] text-slate-400">seen {timeAgo(widget.last_seen_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600">
            <Users className="h-3.5 w-3.5 text-slate-400" /> <b className="font-semibold text-slate-800">{widget.visitors_30d}</b> visitors
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600">
            <MessageCircle className="h-3.5 w-3.5 text-slate-400" /> <b className="font-semibold text-slate-800">{widget.chats_30d}</b> chats
          </span>
          <span className="hidden text-[11px] text-slate-400 sm:inline">30 days</span>
        </div>
        <label className="flex items-center gap-2 text-[12px] font-medium text-slate-600">
          {widget.enabled ? 'On' : 'Off'}
          <Switch
            checked={widget.enabled}
            disabled={toggling}
            onCheckedChange={(v) => void setEnabled(v)}
            aria-label={widget.enabled ? 'Switch chat off' : 'Switch chat on'}
          />
        </label>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Editor */}
        <div className="min-w-0 border-slate-100 lg:border-r">
          <div role="tablist" aria-label="Widget settings" className="flex gap-1 border-b border-slate-100 px-4 pt-3">
            {([
              ['appearance', 'Appearance', Palette],
              ['behaviour', 'Behaviour', ShieldCheck],
              ['contact', 'Contact menu', Phone],
              ['install', 'Install', Code2],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'relative -mb-px inline-flex items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-[13px] font-medium transition',
                  tab === key ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {key === 'behaviour' && form.domains.length === 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-600" />}
              </button>
            ))}
          </div>

          <div className="space-y-6 p-5">
            {tab === 'appearance' && (
              <>
                <div>
                  <FieldLabel htmlFor={`title-${widget.id}`} hint={`${form.title.length}/60`}>Window title</FieldLabel>
                  <Input id={`title-${widget.id}`} value={form.title} maxLength={60} onChange={(e) => set('title', e.target.value)} />
                </div>
                <div>
                  <FieldLabel htmlFor={`welcome-${widget.id}`} hint={`${form.welcome_message.length}/500`}>Welcome message</FieldLabel>
                  <Textarea
                    id={`welcome-${widget.id}`}
                    value={form.welcome_message}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => set('welcome_message', e.target.value)}
                  />
                  <p className="mt-1 text-[11.5px] text-slate-400">The first thing a visitor reads — also shown as a small greeting next to the button.</p>
                </div>

                <div>
                  <FieldLabel>Brand colour</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    {SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set('primary_color', c)}
                        aria-label={`Colour ${c}`}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 transition hover:scale-110',
                          form.primary_color.toLowerCase() === c && 'ring-2 ring-slate-900',
                        )}
                        style={{ background: c }}
                      >
                        {form.primary_color.toLowerCase() === c && <Check className="h-4 w-4 text-white" />}
                      </button>
                    ))}
                    <label
                      className="relative flex h-8 cursor-pointer items-center gap-2 rounded-full border border-slate-200 pl-1 pr-3 text-[12px] text-slate-600 hover:border-slate-300"
                      title="Custom colour"
                    >
                      <span className="h-6 w-6 rounded-full border border-white shadow-inner" style={{ background: colorValid ? form.primary_color : '#fff' }} />
                      <input
                        type="color"
                        value={colorValid ? form.primary_color : '#4f46e5'}
                        onChange={(e) => set('primary_color', e.target.value)}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="Custom colour"
                      />
                      Custom
                    </label>
                    <Input
                      value={form.primary_color}
                      maxLength={7}
                      onChange={(e) => set('primary_color', e.target.value)}
                      aria-label="Colour code"
                      className={cn('h-8 w-24 font-mono text-[12px]', !colorValid && 'border-rose-300 focus-visible:ring-rose-200')}
                    />
                  </div>

                  {/* Solid or gradient */}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div role="radiogroup" aria-label="Colour style" className="inline-flex rounded-xl bg-slate-100 p-1">
                      {(['solid', 'gradient'] as const).map((style) => (
                        <button
                          key={style}
                          type="button"
                          role="radio"
                          aria-checked={form.color_style === style}
                          onClick={() => set('color_style', style)}
                          className={cn(
                            'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                            form.color_style === style ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                          )}
                        >
                          <span className="h-3.5 w-3.5 rounded-full" style={{ background: fillOf(shownColor, style, secondValid ? form.secondary_color || null : null) }} />
                          {style === 'solid' ? 'Solid' : 'Gradient'}
                        </button>
                      ))}
                    </div>
                    <span className="h-8 flex-1 min-w-[120px] rounded-xl ring-1 ring-black/5" style={{ background: shownFill }} aria-hidden="true" />
                  </div>

                  {form.color_style === 'gradient' && (
                    <div className="mt-3 space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-[12px] font-medium text-slate-600">Second colour</span>
                        <button
                          type="button"
                          onClick={() => set('secondary_color', '')}
                          aria-pressed={form.secondary_color === ''}
                          className={cn(
                            'h-8 rounded-full border px-3 text-[12px] transition',
                            form.secondary_color === '' ? 'border-slate-900 bg-white font-semibold text-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                          )}
                        >
                          Auto (darker)
                        </button>
                        <label className="relative flex h-8 cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-3 text-[12px] text-slate-600 hover:border-slate-300">
                          <span className="h-6 w-6 rounded-full border border-white shadow-inner" style={{ background: form.secondary_color && secondValid ? form.secondary_color : '#fff' }} />
                          <input
                            type="color"
                            value={form.secondary_color && secondValid ? form.secondary_color : '#9333ea'}
                            onChange={(e) => set('secondary_color', e.target.value)}
                            className="absolute inset-0 cursor-pointer opacity-0"
                            aria-label="Second colour"
                          />
                          Pick
                        </label>
                        <Input
                          value={form.secondary_color}
                          maxLength={7}
                          placeholder="#9333ea"
                          onChange={(e) => set('secondary_color', e.target.value.trim())}
                          aria-label="Second colour code"
                          className={cn('h-8 w-24 font-mono text-[12px]', !secondValid && 'border-rose-300 focus-visible:ring-rose-200')}
                        />
                      </div>
                      <div>
                        <div className="mb-1.5 text-[11.5px] text-slate-500">Or start from a ready-made gradient</div>
                        <div className="flex flex-wrap gap-2">
                          {GRADIENT_PRESETS.map(([a, b]) => {
                            const active = form.primary_color.toLowerCase() === a && form.secondary_color.toLowerCase() === b
                            return (
                              <button
                                key={a + b}
                                type="button"
                                onClick={() => setForm((f) => ({ ...f, primary_color: a, secondary_color: b, color_style: 'gradient' }))}
                                aria-label={`Gradient ${a} to ${b}`}
                                className={cn('flex h-8 w-14 items-center justify-center rounded-full ring-offset-2 transition hover:scale-105', active && 'ring-2 ring-slate-900')}
                                style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
                              >
                                {active && <Check className="h-4 w-4 text-white" />}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <FieldLabel>Button animation</FieldLabel>
                  <style>{LAUNCHER_KEYFRAMES}</style>
                  <div role="radiogroup" aria-label="Button animation" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {ANIMATIONS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        role="radio"
                        aria-checked={form.launcher_animation === a.key}
                        onClick={() => set('launcher_animation', a.key)}
                        className={cn(
                          'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                          form.launcher_animation === a.key ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300',
                        )}
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                          <LauncherPreview size={34} color={shownColor} fill={shownFill} animation={a.key} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-semibold text-slate-800">{a.label}</span>
                          <span className="block truncate text-[11px] text-slate-500">{a.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-slate-400">
                    The button also springs in when the page loads. The animation stops once a visitor opens the chat, and never plays for people who turned motion off on their device.
                  </p>
                </div>

                <div>
                  <FieldLabel>Position</FieldLabel>
                  <div className="grid grid-cols-2 gap-3">
                    {(['left', 'right'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => set('position', side)}
                        aria-pressed={form.position === side}
                        className={cn(
                          'group rounded-xl border p-3 text-left transition',
                          form.position === side ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300',
                        )}
                      >
                        <div className="relative h-14 rounded-lg border border-slate-200 bg-gradient-to-b from-white to-slate-50">
                          <div className="absolute left-2 top-2 h-1.5 w-12 rounded bg-slate-200" />
                          <div className="absolute left-2 top-5 h-1.5 w-20 rounded bg-slate-100" />
                          <span
                            className={cn('absolute bottom-1.5 h-4 w-4 rounded-full shadow', side === 'left' ? 'left-1.5' : 'right-1.5')}
                            style={{ background: shownFill }}
                          />
                        </div>
                        <div className="mt-2 text-[12.5px] font-medium text-slate-700">Bottom {side}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor={`logo-${widget.id}`} hint="optional">Logo</FieldLabel>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                      {form.logo_url.startsWith('https://') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.logo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Globe className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                    <Input
                      id={`logo-${widget.id}`}
                      value={form.logo_url}
                      placeholder="https://your-site.com/logo.png"
                      autoCapitalize="none"
                      onChange={(e) => set('logo_url', e.target.value)}
                    />
                  </div>
                  {form.logo_url && !form.logo_url.startsWith('https://') && (
                    <p className="mt-1 text-[11.5px] text-rose-700">Use an https:// image link.</p>
                  )}
                </div>
              </>
            )}

            {tab === 'behaviour' && (
              <>
                <DomainChips domains={form.domains} onChange={(d) => set('domains', d)} />

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  <label className="flex cursor-pointer items-center justify-between gap-4 p-4">
                    <span className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50">
                        <Users className="h-4 w-4 text-sky-700" />
                      </span>
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-800">“Talk to a person” button</span>
                        <span className="block text-[12px] leading-relaxed text-slate-500">
                          Visitors can ask for the team. The chat turns Pending in the Inbox and your hand-over alert fires.
                        </span>
                      </span>
                    </span>
                    <Switch checked={form.allow_handoff} onCheckedChange={(v) => set('allow_handoff', v)} aria-label="Talk to a person button" />
                  </label>
                  <div className="flex items-center justify-between gap-4 p-4">
                    <span className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                        <Sparkles className="h-4 w-4 text-violet-600" />
                      </span>
                      <span>
                        <label htmlFor={`limit-${widget.id}`} className="block text-[13px] font-semibold text-slate-800">
                          AI replies per day
                        </label>
                        <span className="block text-[12px] leading-relaxed text-slate-500">
                          A ceiling on cost if bots flood the chat. Past it, chats wait for the team.
                        </span>
                      </span>
                    </span>
                    <Input
                      id={`limit-${widget.id}`}
                      inputMode="numeric"
                      value={form.daily_ai_limit}
                      onChange={(e) => set('daily_ai_limit', e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                      className={cn('h-9 w-24 text-right', !limitValid && 'border-rose-300')}
                    />
                  </div>
                </div>
              </>
            )}

            {tab === 'behaviour' && <WelcomeChatbotCard />}

            {tab === 'contact' && (
              <ContactMenuEditor
                form={form}
                set={set}
                fill={shownFill}
                title={form.title || 'Chat with us'}
              />
            )}

            {tab === 'install' && (
              <InstallSteps widget={widget} hasDomains={form.domains.length > 0} onGoToDomains={() => setTab('behaviour')} />
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <div
              className={cn(
                'flex items-center gap-2 transition-opacity',
                dirty ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
              aria-hidden={!dirty}
            >
              <span className="hidden text-[12px] text-slate-500 sm:inline">Unsaved changes</span>
              <Button variant="ghost" size="sm" onClick={() => setForm(saved)} disabled={saving}>
                Discard
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-gradient-to-b from-slate-50 to-slate-100/70 p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-slate-700">Live preview</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Wand2 className="h-3 w-3" /> updates as you type
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              <span className="ml-2 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-slate-200">
                {form.domains[0]?.replace(/^\*\./, '') ?? 'your-website.com'}
              </span>
            </div>
            <div className="relative h-[540px] bg-white">
              <div className="space-y-2 p-4 opacity-70" aria-hidden="true">
                <div className="h-3 w-1/3 rounded bg-slate-200" />
                <div className="h-2 w-2/3 rounded bg-slate-100" />
                <div className="h-2 w-1/2 rounded bg-slate-100" />
              </div>
              {widget.enabled ? (
                <>
                <div className={cn('absolute bottom-[76px] top-14 w-[calc(100%-24px)] max-w-[340px]', form.position === 'left' ? 'left-3' : 'right-3')}>
                  <iframe
                    key={previewKey}
                    ref={frameRef}
                    title="Chat preview"
                    onLoad={() => window.setTimeout(pushPreview, 300)}
                    src={`/api/webchat/frame/${widget.public_key}#page=${encodeURIComponent('crm-settings-preview')}`}
                    className="h-full w-full rounded-2xl border border-slate-200 shadow-xl shadow-slate-900/10"
                  />
                </div>
                <div className={cn('absolute bottom-3', form.position === 'left' ? 'left-3' : 'right-3')}>
                  <LauncherPreview size={52} color={shownColor} fill={shownFill} animation={form.launcher_animation} />
                </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12.5px] text-slate-500">
                  <MessageCircle className="h-6 w-6 text-slate-300" />
                  Switch the chat on to preview it
                </div>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            This is a real chat — messages you send here reach your Inbox.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * One click to the welcome chatbot every Website Bot wants: name, mobile
 * number, language buttons. Created on the Website channel from the
 * built-in template and opened in the builder, as a draft — the business
 * reads the texts and switches it on there.
 */
function WelcomeChatbotCard() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  async function create() {
    if (creating) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_slug: 'welcome_name_number_language',
          channel: 'website',
          name: 'Website welcome — language, name & WhatsApp number',
        }),
      })
      const data = (await res.json()) as { chatbot?: { id?: string } }
      if (!data.chatbot?.id) throw new Error('The chatbot was not created.')
      toast.success('Welcome chatbot created — check the texts, then switch it on.')
      router.push(`/chatbot/${data.chatbot.id}`)
    } catch (err) {
      console.error('[website-chat] welcome chatbot failed:', err)
      toast.error(errorText(err, 'Could not create the welcome chatbot.'))
      setCreating(false)
    }
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
          <Workflow className="h-4 w-4 text-indigo-600" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-800">Welcome chatbot: language, name & WhatsApp number</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            Runs once for each new visitor: language buttons first (മലയാളം / English / हिन्दी), then their name and WhatsApp
            number — asked in the language they chose — and saves all three to the contact. With a number on file, the
            assistant does for website visitors whatever it does on WhatsApp.
          </p>
          <Button size="sm" className="mt-3" onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Create welcome chatbot
          </Button>
          <p className="mt-2 text-[11px] text-slate-400">Opens in the chatbot builder as a draft — edit any text or add languages, then switch it on.</p>
        </div>
      </div>
    </div>
  )
}

function DomainChips({ domains, onChange }: { domains: string[]; onChange: (d: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add(raw: string) {
    const parts = raw.split(/[\s,]+/).filter(Boolean)
    if (!parts.length) return
    const next = [...domains]
    for (const part of parts) {
      const d = normalizeDomain(part)
      if (!d) {
        setError(`“${parts.length > 1 ? raw.trim() : part}” is not a website address — e.g. example.com`)
        return
      }
      if (!next.includes(d)) next.push(d)
    }
    if (next.length > 20) {
      setError('Up to 20 websites per widget.')
      return
    }
    onChange(next)
    setDraft('')
    setError(null)
  }

  return (
    <div>
      <FieldLabel htmlFor="wc-domain-input">Websites that may show this chat</FieldLabel>
      <div
        className={cn(
          'flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 focus-within:ring-2',
          error ? 'border-rose-300 focus-within:ring-rose-100' : 'border-slate-200 focus-within:border-indigo-300 focus-within:ring-indigo-100',
        )}
      >
        {domains.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-[12.5px] font-medium text-slate-700">
            <Globe className="h-3 w-3 text-slate-400" />
            {d}
            <button
              type="button"
              onClick={() => onChange(domains.filter((x) => x !== d))}
              aria-label={`Remove ${d}`}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id="wc-domain-input"
          value={draft}
          autoCapitalize="none"
          autoComplete="off"
          placeholder={domains.length ? 'Add another…' : 'example.com — press Enter'}
          onChange={(e) => { setDraft(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
            else if (e.key === 'Backspace' && !draft && domains.length) onChange(domains.slice(0, -1))
          }}
          onBlur={() => draft.trim() && add(draft)}
          className="min-w-[160px] flex-1 bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-slate-400"
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] text-rose-700">{error}</p>
      ) : domains.length === 0 ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> Empty means any website can show this chat. Add your site’s address.
        </p>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-slate-400">
          “example.com” also covers www. “*.example.com” covers every subdomain. Other sites cannot show this chat — the browser blocks it.
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

interface AccountNumber {
  id: string
  label: string | null
  is_default: boolean
  status: string
  phone: string | null
}

/**
 * The contact menu: when it is on and has at least one number, clicking
 * the chat button on the website offers WhatsApp, a direct call, or the
 * bot (public/webchat/widget.js). WhatsApp numbers come from the
 * account's connected numbers; call numbers are typed in.
 */
function ContactMenuEditor({
  form,
  set,
  fill,
  title,
}: {
  form: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  fill: string
  title: string
}) {
  const [numbers, setNumbers] = useState<AccountNumber[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await apiFetch('/api/website-chat/whatsapp-numbers')
      const data = (await res.json()) as { numbers?: AccountNumber[] }
      setNumbers(Array.isArray(data.numbers) ? data.numbers : [])
    } catch (err) {
      console.error('[website-chat] could not load WhatsApp numbers:', err)
      setLoadError(errorText(err, 'Could not load your WhatsApp numbers.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = new Map(form.wa_selected.map((s) => [s.config_id, s.label]))
  const toggleNumber = (n: AccountNumber) => {
    if (selected.has(n.id)) set('wa_selected', form.wa_selected.filter((s) => s.config_id !== n.id))
    else if (form.wa_selected.length < 5) set('wa_selected', [...form.wa_selected, { config_id: n.id, label: n.label || 'WhatsApp' }])
  }
  const renameNumber = (id: string, label: string) =>
    set('wa_selected', form.wa_selected.map((s) => (s.config_id === id ? { ...s, label } : s)))

  const setCall = (i: number, patch: Partial<{ label: string; phone: string }>) =>
    set('call_links', form.call_links.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const phoneLooksRight = (v: string) => {
    const digits = v.replace(/\D/g, '')
    return !v.trim() || (/^[\d\s+().-]+$/.test(v) && digits.length >= 7 && digits.length <= 15)
  }

  const waCount = form.wa_selected.length
  const callCount = form.call_links.filter((c) => c.phone.trim()).length
  const nothingToShow = form.contact_menu_enabled && waCount === 0 && callCount === 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
        <div>
          <div className="text-[13.5px] font-semibold text-slate-800">Show a contact menu on the chat button</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            Visitors click the button and choose WhatsApp, a direct call, or the bot. Off: the button opens the chat straight away.
          </p>
        </div>
        <Switch
          checked={form.contact_menu_enabled}
          onCheckedChange={(v) => set('contact_menu_enabled', v)}
          aria-label="Show a contact menu on the chat button"
        />
      </div>

      {nothingToShow && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Add a WhatsApp or call number below. Until then the button keeps opening the chat.
        </div>
      )}

      <div>
        <FieldLabel hint={`${waCount}/5`}>WhatsApp numbers</FieldLabel>
        <p className="-mt-1 mb-2 text-[11.5px] text-slate-400">
          Your connected numbers. Tick the ones to offer; the name is what visitors see.
        </p>
        {loading && !numbers ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-[12.5px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading your numbers from WhatsApp…
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700">
            {loadError}
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : numbers && numbers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-[12.5px] text-slate-500">
            No WhatsApp number is connected yet — connect one in Settings → Channels → WhatsApp.
          </div>
        ) : (
          <div className="space-y-2">
            {(numbers ?? []).map((n) => {
              const on = selected.has(n.id)
              return (
                <div
                  key={n.id}
                  className={cn('flex flex-wrap items-center gap-3 rounded-xl border p-3 transition', on ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200')}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!n.phone || (!on && waCount >= 5)}
                    onChange={() => toggleNumber(n)}
                    aria-label={`Offer ${n.label || 'this number'}`}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#25d366] text-white">
                    <MessageCircle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-slate-800">
                      {n.phone ? `+${n.phone}` : 'Number could not be read from WhatsApp'}
                      {n.is_default && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500">default</span>}
                    </div>
                    <div className="text-[11.5px] text-slate-400">{n.label || 'Unnamed number'} · {n.status}</div>
                  </div>
                  {on && (
                    <Input
                      value={selected.get(n.id) ?? ''}
                      maxLength={40}
                      onChange={(e) => renameNumber(n.id, e.target.value)}
                      placeholder="Name visitors see"
                      aria-label="Name visitors see"
                      className="h-8 w-full sm:w-44"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <FieldLabel htmlFor="wc-prefill" hint={`${form.whatsapp_prefill.length}/300`}>First WhatsApp message (optional)</FieldLabel>
        <Textarea
          id="wc-prefill"
          rows={2}
          maxLength={300}
          value={form.whatsapp_prefill}
          onChange={(e) => set('whatsapp_prefill', e.target.value)}
          placeholder="Hi, I came from your website"
        />
        <p className="mt-1 text-[11.5px] text-slate-400">Typed into WhatsApp for them — they can change it before sending.</p>
      </div>

      <div>
        <FieldLabel hint={`${form.call_links.length}/5`}>Call numbers</FieldLabel>
        <p className="-mt-1 mb-2 text-[11.5px] text-slate-400">The Call button opens the visitor&apos;s dial pad with this number. Include the country code.</p>
        <div className="space-y-2">
          {form.call_links.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                value={c.label}
                maxLength={40}
                onChange={(e) => setCall(i, { label: e.target.value })}
                placeholder="Office"
                aria-label="Name"
                className="h-9 w-36"
              />
              <Input
                value={c.phone}
                maxLength={22}
                inputMode="tel"
                onChange={(e) => setCall(i, { phone: e.target.value })}
                placeholder="+91 85900 55117"
                aria-label="Phone number"
                className={cn('h-9 flex-1 min-w-[160px] font-mono text-[12.5px]', !phoneLooksRight(c.phone) && 'border-rose-300 focus-visible:ring-rose-200')}
              />
              <button
                type="button"
                onClick={() => set('call_links', form.call_links.filter((_, j) => j !== i))}
                className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                aria-label="Remove number"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={form.call_links.length >= 5}
            onClick={() => set('call_links', [...form.call_links, { label: '', phone: '' }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add number
          </Button>
          {(numbers ?? [])
            .filter((n) => n.phone && !form.call_links.some((c) => c.phone.replace(/\D/g, '') === n.phone))
            .slice(0, 3)
            .map((n) => (
              <button
                key={n.id}
                type="button"
                disabled={form.call_links.length >= 5}
                onClick={() => set('call_links', [...form.call_links, { label: n.label || 'Call us', phone: `+${n.phone}` }])}
                className="rounded-full border border-slate-200 px-3 py-1 text-[12px] text-slate-600 hover:border-slate-300 disabled:opacity-50"
              >
                + Use {n.label || `+${n.phone}`}
              </button>
            ))}
        </div>
      </div>

      {/* What visitors will see */}
      <div>
        <FieldLabel>What visitors see</FieldLabel>
        <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-900/5">
          <div className="px-4 py-3 text-white" style={{ background: fill }}>
            <div className="text-[14px] font-semibold">How can we help?</div>
            <div className="text-[11.5px] opacity-85">Choose how you would like to reach us</div>
          </div>
          <div className="space-y-2 p-2.5">
            {[
              waCount > 0 && { key: 'wa', bg: '#25d366', icon: MessageCircle, t: 'WhatsApp', s: waCount === 1 ? form.wa_selected[0].label : 'Chat with us on WhatsApp' },
              callCount > 0 && { key: 'call', bg: '#2563eb', icon: Phone, t: 'Direct call', s: callCount === 1 ? form.call_links.find((c) => c.phone.trim())?.phone : 'Talk to our team' },
              { key: 'bot', bg: fill, icon: Bot, t: title, s: 'Instant answers, any time' },
            ]
              .filter(Boolean)
              .map((o) => {
                const row = o as { key: string; bg: string; icon: typeof Phone; t: string; s: string | undefined }
                const Icon = row.icon
                return (
                  <div key={row.key} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: row.bg }}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-800">{row.t}</span>
                      <span className="block truncate text-[11.5px] text-slate-500">{row.s}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                )
              })}
          </div>
        </div>
        {!form.contact_menu_enabled && (
          <p className="mt-2 text-center text-[11.5px] text-slate-400">Switch the menu on above to use it on your website.</p>
        )}
      </div>
    </div>
  )
}

const PLATFORMS = {
  html: { label: 'Any website', how: 'Paste just before </body> on every page (or in a shared footer).' },
  wordpress: { label: 'WordPress', how: 'Plugins → “WPCode” (or any header & footer scripts plugin) → Footer → paste → Save. No plugin? Appearance → Theme File Editor → footer.php, just before </body>.' },
  nextjs: { label: 'Next.js', how: 'In app/layout.tsx: import Script from "next/script", then <Script src="…/webchat/widget.js" data-widget="wk_…" strategy="afterInteractive" /> inside <body>.' },
} as const

function InstallSteps({ widget, hasDomains, onGoToDomains }: { widget: Widget; hasDomains: boolean; onGoToDomains: () => void }) {
  const [platform, setPlatform] = useState<keyof typeof PLATFORMS>('html')
  const [copied, setCopied] = useState(false)
  const installed = Boolean(widget.last_seen_at)

  async function copy() {
    try {
      await navigator.clipboard.writeText(widget.snippet)
      setCopied(true)
      toast.success('Install code copied')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the code and copy it by hand.')
    }
  }

  const steps = [
    {
      done: hasDomains,
      title: 'Add your website',
      body: hasDomains ? 'Done — only the websites you listed can show the chat.' : (
        <>So no other site can use your chat. <button type="button" className="font-semibold text-indigo-600 hover:underline" onClick={onGoToDomains}>Add it in Behaviour →</button></>
      ),
    },
    { done: copied || installed, title: 'Copy the install code', body: null },
    {
      done: installed,
      title: 'Open your website',
      body: installed
        ? `Seen on ${widget.last_seen_origin} ${timeAgo(widget.last_seen_at)}.`
        : 'After pasting the code, open your site once — this turns green when the chat loads there.',
    },
  ]

  return (
    <ol className="space-y-5">
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-3">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
              step.done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
            )}
          >
            {step.done ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[13px] font-semibold text-slate-800">{step.title}</div>
            {step.body && <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{step.body}</p>}
            {i === 1 && (
              <div className="mt-2">
                <div className="mb-2 inline-flex rounded-lg bg-slate-100 p-0.5">
                  {(Object.keys(PLATFORMS) as (keyof typeof PLATFORMS)[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPlatform(key)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[12px] font-medium transition',
                        platform === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                      )}
                    >
                      {PLATFORMS[key].label}
                    </button>
                  ))}
                </div>
                <div className="overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-800">
                  <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
                    <span className="text-[11px] font-medium text-slate-400">HTML</span>
                    <button
                      type="button"
                      onClick={() => void copy()}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-slate-200 transition hover:bg-slate-800"
                    >
                      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-slate-100"><code>{widget.snippet}</code></pre>
                </div>
                <p className="mt-2 flex gap-1.5 text-[12px] leading-relaxed text-slate-500">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {PLATFORMS[platform].how}
                </p>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
