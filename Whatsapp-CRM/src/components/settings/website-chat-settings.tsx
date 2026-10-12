'use client'

/**
 * Settings → Website chat.
 *
 * One card per chat widget: switch it on or off, how it looks, which
 * websites may show it, the install code to paste, a live preview, and
 * what it has done in the last 30 days. Above them, whether the assistant
 * answers website chats at all.
 *
 * Everything here is saved by the server first and shown after — see
 * apiFetch — and the list reloads from what the server returned.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, Bot, CheckCircle2, Copy, Globe, Loader2, MessageCircle, Plus, Trash2, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/hooks/use-confirm'
import { apiFetch, errorText } from '@/lib/api-fetch'
import { normalizeDomainList } from '@/lib/webchat/domains'

interface Widget {
  id: string
  public_key: string
  enabled: boolean
  name: string
  title: string
  welcome_message: string
  primary_color: string
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

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

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
      setLoadError(errorText(err, 'Could not load website chat settings.'))
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
      toast.success('Chat widget created — add your website below, then copy the install code.')
      await load()
    } catch (err) {
      console.error('[website-chat] create failed:', err)
      toast.error(errorText(err, 'Could not create the widget.'))
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
      toast.success(on ? 'The assistant now answers website chats' : 'Website chats now wait for the team')
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
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (loadError || !data) {
    return (
      <div className="m-1 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {loadError ?? 'Could not load website chat settings.'}{' '}
        <button type="button" className="underline" onClick={() => { setLoading(true); void load() }}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* The assistant */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
            <Bot className="h-4.5 w-4.5 text-indigo-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-slate-900">AI replies on website chat</h3>
              <Switch
                checked={data.ai.answers_website}
                disabled={aiSaving || !data.ai.configured}
                onCheckedChange={(v) => void setAnswersWebsite(v)}
                aria-label="AI replies on website chat"
              />
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
              The same assistant, knowledge and hand-over rules as WhatsApp. Chatbots built for the Website channel run first; the
              assistant answers what no chatbot or automation picked up. Visitors are anonymous, so it will not save registrations or
              book appointments for them.
            </p>
            {!data.ai.configured && (
              <p className="mt-2 text-[12.5px] text-amber-700">Set up the assistant in Settings → AI Config first.</p>
            )}
            {data.ai.configured && data.ai.answers_website && !data.ai.assistant_on && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                The assistant itself is off. Turn on “Answer messages no chatbot matched” on the Chatbots page.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-slate-500">
              <span>{data.totals.ai_replies_30d} AI replies in 30 days</span>
              <span>{data.totals.waiting_for_team} chats waiting for the team</span>
            </div>
          </div>
        </div>
      </section>

      {data.widgets.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <MessageCircle className="mx-auto h-8 w-8 text-slate-400" />
          <h3 className="mt-3 text-[14px] font-semibold text-slate-900">No chat widget yet</h3>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-slate-500">
            Create one, list the website it goes on, and paste one line of code into that website. Visitors’ messages arrive in the
            Inbox under Website.
          </p>
          <Button className="mt-4" onClick={() => void createWidget()} disabled={creating}>
            {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            Create chat widget
          </Button>
        </section>
      ) : (
        <>
          {data.widgets.map((w) => (
            <WidgetCard key={w.id} widget={w} onChanged={load} />
          ))}
          <Button variant="outline" onClick={() => void createWidget()} disabled={creating}>
            {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            Add another widget
          </Button>
        </>
      )}
    </div>
  )
}

function WidgetCard({ widget, onChanged }: { widget: Widget; onChanged: () => Promise<void> }) {
  const confirm = useConfirm()
  const [form, setForm] = useState({
    name: widget.name,
    title: widget.title,
    welcome_message: widget.welcome_message,
    primary_color: widget.primary_color,
    position: widget.position,
    logo_url: widget.logo_url ?? '',
    domains: widget.allowed_domains.join('\n'),
    allow_handoff: widget.allow_handoff,
    daily_ai_limit: String(widget.daily_ai_limit),
  })
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  const previewRef = useRef<HTMLIFrameElement>(null)

  const domainCheck = normalizeDomainList(form.domains)
  const installed = Boolean(widget.last_seen_at)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function save() {
    if (saving) return
    if (domainCheck.invalid.length) {
      toast.error(`Not a website address: ${domainCheck.invalid.slice(0, 3).join(', ')}`)
      return
    }
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
          position: form.position,
          logo_url: form.logo_url.trim() || null,
          allowed_domains: domainCheck.domains,
          allow_handoff: form.allow_handoff,
          daily_ai_limit: Number(form.daily_ai_limit),
        }),
      })
      toast.success('Saved')
      await onChanged()
      setPreviewKey((k) => k + 1)
    } catch (err) {
      console.error('[website-chat] save failed:', err)
      toast.error(errorText(err, 'Could not save.'))
    } finally {
      setSaving(false)
    }
  }

  async function setEnabled(enabled: boolean) {
    if (toggling) return
    setToggling(true)
    try {
      await apiFetch(`/api/website-chat/${widget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      toast.success(enabled ? 'Chat is on' : 'Chat is off — the button disappears from your website')
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
      title: 'Delete this chat widget?',
      description:
        'The chat button disappears from every website using this code. Conversations and contacts it created stay in the Inbox.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok || deleting) return
    setDeleting(true)
    try {
      await apiFetch(`/api/website-chat/${widget.id}`, { method: 'DELETE' })
      toast.success('Widget deleted')
      await onChanged()
    } catch (err) {
      console.error('[website-chat] delete failed:', err)
      toast.error(errorText(err, 'Could not delete it.'))
      setDeleting(false)
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(widget.snippet)
      toast.success('Install code copied')
    } catch {
      toast.error('Could not copy — select the code and copy it by hand.')
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <Globe className="h-4.5 w-4.5 text-slate-500" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-slate-900">{widget.name}</h3>
          <p className="text-[12px] text-slate-500">
            {installed ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Seen on {widget.last_seen_origin} · {timeAgo(widget.last_seen_at)}
              </span>
            ) : (
              'Not seen on a website yet'
            )}
          </p>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-slate-500">
          <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {widget.visitors_30d} visitors</span>
          <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {widget.chats_30d} chats</span>
          <span className="text-slate-400">30 days</span>
        </div>
        <Switch
          checked={widget.enabled}
          disabled={toggling}
          onCheckedChange={(v) => void setEnabled(v)}
          aria-label={widget.enabled ? 'Switch chat off' : 'Switch chat on'}
        />
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={`name-${widget.id}`}>Name (only you see this)</Label>
              <Input id={`name-${widget.id}`} value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`title-${widget.id}`}>Window title</Label>
              <Input id={`title-${widget.id}`} value={form.title} maxLength={60} onChange={(e) => set('title', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor={`welcome-${widget.id}`}>Welcome message</Label>
            <Textarea
              id={`welcome-${widget.id}`}
              value={form.welcome_message}
              maxLength={500}
              rows={2}
              onChange={(e) => set('welcome_message', e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={`color-${widget.id}`}>Colour</Label>
              <div className="flex items-center gap-2">
                <input
                  id={`color-${widget.id}`}
                  type="color"
                  value={form.primary_color}
                  onChange={(e) => set('primary_color', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
                />
                <Input value={form.primary_color} maxLength={7} onChange={(e) => set('primary_color', e.target.value)} aria-label="Colour code" />
              </div>
            </div>
            <div>
              <Label htmlFor={`pos-${widget.id}`}>Position</Label>
              <select
                id={`pos-${widget.id}`}
                value={form.position}
                onChange={(e) => set('position', e.target.value === 'left' ? 'left' : 'right')}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="right">Bottom right</option>
                <option value="left">Bottom left</option>
              </select>
            </div>
            <div>
              <Label htmlFor={`limit-${widget.id}`}>AI replies per day (max)</Label>
              <Input
                id={`limit-${widget.id}`}
                type="number"
                min={0}
                max={100000}
                value={form.daily_ai_limit}
                onChange={(e) => set('daily_ai_limit', e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`logo-${widget.id}`}>Logo (https image link, optional)</Label>
            <Input
              id={`logo-${widget.id}`}
              value={form.logo_url}
              placeholder="https://example.com/logo.png"
              autoCapitalize="none"
              onChange={(e) => set('logo_url', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`domains-${widget.id}`}>Websites allowed to show this chat</Label>
            <Textarea
              id={`domains-${widget.id}`}
              value={form.domains}
              rows={3}
              autoCapitalize="none"
              placeholder={'example.com\n*.example.com'}
              onChange={(e) => set('domains', e.target.value)}
            />
            <p className="mt-1 text-[12px] text-slate-500">
              One per line. “example.com” also covers www.example.com; “*.example.com” covers every subdomain.
            </p>
            {domainCheck.invalid.length > 0 && (
              <p className="mt-1 text-[12px] text-rose-600">Not a website address: {domainCheck.invalid.slice(0, 3).join(', ')}</p>
            )}
            {domainCheck.domains.length === 0 && domainCheck.invalid.length === 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Empty means any website can show this chat. Add your site’s address.
              </p>
            )}
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
            <span>
              <span className="block text-[13px] font-medium text-slate-800">“Talk to a person” button</span>
              <span className="block text-[12px] text-slate-500">Lets a visitor ask for the team; the chat becomes Pending in the Inbox.</span>
            </span>
            <Switch checked={form.allow_handoff} onCheckedChange={(v) => set('allow_handoff', v)} aria-label="Talk to a person button" />
          </label>

          <div>
            <Label>Install code</Label>
            <p className="mb-1.5 text-[12px] text-slate-500">
              Paste this before <code>&lt;/body&gt;</code> on every page — in WordPress, a “header and footer scripts” plugin or the
              theme footer; in Next.js, a <code>&lt;Script&gt;</code> in the root layout.
            </p>
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[12px] text-slate-100">
                <code>{widget.snippet}</code>
              </pre>
              <Button variant="outline" size="sm" onClick={() => void copySnippet()} aria-label="Copy install code">
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
            <Button variant="ghost" className="text-rose-600 hover:text-rose-700" onClick={() => void remove()} disabled={deleting}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete
            </Button>
          </div>
        </div>

        <div>
          <Label>Preview</Label>
          <p className="mb-1.5 text-[11.5px] text-slate-400">A real chat — test messages reach your Inbox.</p>
          {widget.enabled ? (
            <iframe
              key={previewKey}
              ref={previewRef}
              title="Chat preview"
              src={`/api/webchat/frame/${widget.public_key}#page=${encodeURIComponent('crm-settings-preview')}`}
              className="h-[520px] w-full rounded-2xl border border-slate-200 shadow-sm"
            />
          ) : (
            <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-slate-300 text-[12.5px] text-slate-500">
              Switch the chat on to preview it
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
