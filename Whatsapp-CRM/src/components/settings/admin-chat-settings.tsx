'use client'

/**
 * Settings → Admin Chat. Owners and admins let up to five admins ask the
 * CRM assistant about the business from their own WhatsApp or Telegram.
 *
 * Anything that widens access (turning it on, adding someone, changing
 * their hours or what they may see) asks for the caller's own
 * authenticator code. Taking access away never does.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChannelMark } from '@/components/contacts/channel-links'
import { useConfirm } from '@/hooks/use-confirm'
import { apiFetch, errorText } from '@/lib/api-fetch'
import { cn } from '@/lib/utils'

type Channel = 'whatsapp' | 'telegram'
type Scope = 'reports' | 'lookup' | 'actions'

interface Member {
  id: string
  user_id: string
  name: string
  channel: Channel
  phone: string | null
  telegram_linked: boolean
  status: 'pending' | 'active'
  scope: Scope
  valid_from: string
  valid_until: string
  allowed_days: string[]
  start_minute: number
  end_minute: number
  verify_expires_at: string | null
  locked_until: string | null
  mfa_ready: boolean
  brief_enabled: boolean
  brief_minute: number
  alerts_enabled: boolean
  last_brief_date: string | null
}

interface State {
  settings: {
    enabled: boolean
    keyword: string
    idle_minutes: number
    max_minutes: number
    alert_waiting_threshold: number
    brief_template: { name: string; language: string | null } | null
  }
  templates: Array<{ name: string; language: string | null; body: string }>
  timezone: string
  max_members: number
  me_has_totp: boolean
  channels: { whatsapp: { labels: string[] } | null; telegram: { username: string } | null }
  members: Member[]
  sessions: Array<{ id: string; member_id: string; channel: Channel; state: string; started_at: string | null; last_activity_at: string; questions: number; name: string }>
  audit: Array<{ id: string; event: string; name: string | null; detail: Record<string, unknown>; created_at: string }>
  audit_chain: { ok: boolean; rows: number; brokenAtId: string | null }
  candidates: Array<{ user_id: string; name: string; role: string; phone: string | null; mfa_ready: boolean }>
  me: string
  approvals: Array<{
    id: string
    kind: string
    summary: string
    requested_by: string
    requested_by_name: string
    needs_other_approver: boolean
    recipients: number | null
    created_at: string
    expires_at: string
  }>
}

const DAYS = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun'],
] as const

const EVENT_LABEL: Record<string, string> = {
  settings_changed: 'Settings changed',
  member_added: 'Admin added',
  member_verified: 'Number verified',
  member_changed: 'Access changed',
  member_disabled: 'Admin removed',
  code_requested: 'Asked for a code',
  code_failed: 'Wrong code',
  locked: 'Locked after wrong codes',
  session_started: 'Session started',
  question: 'Question',
  session_ended: 'Session ended',
  refused: 'Refused',
  all_sessions_ended: 'All sessions ended',
  brief_sent: 'Daily brief sent',
  alert_sent: 'Alert sent',
  brief_off: 'Turned off daily briefs',
  alerts_off: 'Turned off alerts',
  action_proposed: 'Action proposed',
  action_awaiting_web: 'Waiting for approval in the CRM',
  action_rejected: 'Action cancelled',
  action_done: 'Action done',
  action_failed: 'Action failed',
  action_undone: 'Action undone',
}

const toTime = (m: number) => (m >= 1440 ? '23:59' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
const fromTime = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h === 23 && m === 59 ? 1440 : h * 60 + m
}
const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—'
const fmtDate = (ymd: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`))
const todayPlus = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function describeDays(days: string[]): string {
  if (days.length === 7) return 'Every day'
  return DAYS.filter(([k]) => days.includes(k)).map(([, l]) => l).join(', ')
}

// ── The authenticator-code prompt ─────────────────────────────────────

function CodeDialog({ open, title, onCancel, onSubmit }: { open: boolean; title: string; onCancel: () => void; onSubmit: (code: string) => Promise<void> }) {
  // Mounted fresh each time it opens (the parent keys it), so it starts empty.
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    if (busy || !/^\d{6}$/.test(code)) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(code)
    } catch (err) {
      setError(errorText(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <KeyRound className="h-4 w-4 text-indigo-600" aria-hidden="true" /> {title}
          </DialogTitle>
          <DialogDescription className="text-slate-500">Enter the 6-digit code from your authenticator app to confirm.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="space-y-2"
        >
          <label htmlFor="ac-stepup" className="text-[12px] font-semibold text-slate-700">
            Authenticator code
          </label>
          <Input
            id="ac-stepup"
            name="one-time-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''))
              setError('')
            }}
            placeholder="123456"
            className="h-11 text-center font-mono text-[18px] tracking-[0.4em]"
            aria-invalid={Boolean(error)}
            aria-describedby="ac-stepup-help"
          />
          <p id="ac-stepup-help" role={error ? 'alert' : undefined} className={cn('text-[12px]', error ? 'text-rose-700' : 'text-slate-400')}>
            {error || 'The code changes every 30 seconds.'}
          </p>
          <DialogFooter className="bg-white border-slate-200">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {busy ? 'Checking…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Add / edit an admin ────────────────────────────────────────────────

interface Draft {
  user_id: string
  channel: Channel
  phone: string
  scope: Scope
  valid_from: string
  valid_until: string
  allowed_days: string[]
  start: string
  end: string
  brief_enabled: boolean
  brief_time: string
  alerts_enabled: boolean
}

function MemberDialog({
  open,
  data,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean
  data: State
  editing: Member | null
  onClose: () => void
  onSaved: (verify?: { code: string; minutes: number; channel: Channel; phone: string | null; name: string }) => void
}) {
  // Mounted fresh for each open (the parent keys it), so the form starts
  // from the admin being changed, or from sensible defaults.
  const [draft, setDraft] = useState<Draft | null>(() => {
    if (editing) {
      return {
        user_id: editing.user_id,
        channel: editing.channel,
        phone: editing.phone ?? '',
        scope: editing.scope,
        valid_from: editing.valid_from,
        valid_until: editing.valid_until,
        allowed_days: editing.allowed_days,
        start: toTime(editing.start_minute),
        end: toTime(editing.end_minute),
        brief_enabled: editing.brief_enabled,
        brief_time: toTime(editing.brief_minute),
        alerts_enabled: editing.alerts_enabled,
      }
    }
    const first = data.candidates.find((c) => c.mfa_ready) ?? data.candidates[0]
    return {
      user_id: first?.user_id ?? '',
      channel: data.channels.whatsapp ? 'whatsapp' : 'telegram',
      phone: first?.phone?.replace(/\D/g, '') ?? '',
      scope: 'reports',
      valid_from: todayPlus(0),
      valid_until: todayPlus(30),
      allowed_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
      start: '09:00',
      end: '19:00',
      brief_enabled: true,
      brief_time: '09:00',
      alerts_enabled: false,
    }
  })
  const [askCode, setAskCode] = useState(false)

  if (!draft) return null
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const person = data.candidates.find((c) => c.user_id === draft.user_id)
  const valid =
    Boolean(draft.user_id) &&
    draft.allowed_days.length > 0 &&
    draft.valid_from <= draft.valid_until &&
    fromTime(draft.start) < fromTime(draft.end) &&
    (!draft.brief_enabled || (fromTime(draft.brief_time) >= fromTime(draft.start) && fromTime(draft.brief_time) < fromTime(draft.end))) &&
    (draft.channel === 'telegram' || draft.phone.replace(/\D/g, '').length >= 10)

  async function save(code: string) {
    if (!draft) return
    const fields = {
      scope: draft.scope,
      valid_from: draft.valid_from,
      valid_until: draft.valid_until,
      allowed_days: draft.allowed_days,
      start_minute: fromTime(draft.start),
      end_minute: fromTime(draft.end),
      brief_enabled: draft.brief_enabled,
      brief_minute: Math.min(1439, fromTime(draft.brief_time)),
      alerts_enabled: draft.alerts_enabled,
      totp_code: code,
    }
    if (editing) {
      await apiFetch(`/api/admin-chat/members/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) })
      toast.success('Access updated')
      setAskCode(false)
      onSaved()
      return
    }
    const res = await apiFetch('/api/admin-chat/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, user_id: draft.user_id, channel: draft.channel, phone: draft.phone }),
    })
    const body = (await res.json()) as { verify_code: string; verify_minutes: number }
    setAskCode(false)
    onSaved({ code: body.verify_code, minutes: body.verify_minutes, channel: draft.channel, phone: draft.channel === 'whatsapp' ? draft.phone.replace(/\D/g, '') : null, name: person?.name ?? 'the admin' })
  }

  return (
    <>
      <Dialog open={open && !askCode} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-800">{editing ? `Change access — ${editing.name}` : 'Add an admin'}</DialogTitle>
            <DialogDescription className="text-slate-500">
              Owners and admins with the authenticator app turned on. Times are in {data.timezone}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {!editing && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="ac-person" className="text-[12px] font-semibold text-slate-700">Person</label>
                  <select
                    id="ac-person"
                    value={draft.user_id}
                    onChange={(e) => {
                      const c = data.candidates.find((x) => x.user_id === e.target.value)
                      setDraft((d) => (d ? { ...d, user_id: e.target.value, phone: c?.phone?.replace(/\D/g, '') ?? d.phone } : d))
                    }}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800"
                  >
                    {data.candidates.map((c) => (
                      <option key={c.user_id} value={c.user_id}>
                        {c.name} ({c.role}){c.mfa_ready ? '' : ' — authenticator not on'}
                      </option>
                    ))}
                  </select>
                  {person && !person.mfa_ready && (
                    <p className="text-[12px] text-amber-800">They must turn on the authenticator app in Profile → Security before they can be added.</p>
                  )}
                </div>
                <fieldset className="space-y-1.5">
                  <legend className="text-[12px] font-semibold text-slate-700">Chat app</legend>
                  <div className="flex flex-wrap gap-2">
                    {(['whatsapp', 'telegram'] as const).map((ch) => {
                      const available = Boolean(data.channels[ch])
                      return (
                        <label
                          key={ch}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold',
                            draft.channel === ch ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-700',
                            !available && 'cursor-not-allowed opacity-50',
                          )}
                        >
                          <input type="radio" name="ac-channel" value={ch} checked={draft.channel === ch} disabled={!available} onChange={() => set('channel', ch)} className="sr-only" />
                          <ChannelMark channel={ch} className="h-5 w-5" />
                          {ch === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
                          {!available && <span className="text-[11px] font-normal">(not connected)</span>}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                {draft.channel === 'whatsapp' && (
                  <div className="space-y-1.5">
                    <label htmlFor="ac-phone" className="text-[12px] font-semibold text-slate-700">Their WhatsApp number</label>
                    <Input
                      id="ac-phone"
                      name="admin-whatsapp"
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      value={draft.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="91 98470 12345"
                      className="h-10"
                    />
                    <p className="text-[11.5px] text-slate-400">With the country code. It must be a personal number, not the business number.</p>
                  </div>
                )}
              </>
            )}
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] font-semibold text-slate-700">What they may see</legend>
              {(
                [
                  ['reports', 'Reports only', 'Counts and summaries — no names or numbers of people.'],
                  ['lookup', 'Reports and find a customer', 'Also look up a person; phone numbers and emails are masked.'],
                  ['actions', 'Reports, find and actions', 'Also add follow-ups, tags, leads and assign chats after a YES; templates and broadcast drafts are confirmed in the CRM too.'],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className={cn('flex cursor-pointer gap-2.5 rounded-xl border p-3', draft.scope === value ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200')}>
                  <input type="radio" name="ac-scope" value={value} checked={draft.scope === value} onChange={() => set('scope', value)} className="mt-0.5" />
                  <span>
                    <span className="block text-[13px] font-semibold text-slate-800">{label}</span>
                    <span className="block text-[12px] text-slate-500">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="ac-from" className="text-[12px] font-semibold text-slate-700">First day</label>
                <Input id="ac-from" type="date" value={draft.valid_from} onChange={(e) => set('valid_from', e.target.value)} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ac-until" className="text-[12px] font-semibold text-slate-700">Last day</label>
                <Input id="ac-until" type="date" value={draft.valid_until} onChange={(e) => set('valid_until', e.target.value)} className="h-10" />
              </div>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] font-semibold text-slate-700">Days</legend>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(([key, label]) => {
                  const on = draft.allowed_days.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('allowed_days', on ? draft.allowed_days.filter((d) => d !== key) : [...draft.allowed_days, key])}
                      className={cn('h-9 min-w-11 rounded-lg border px-2.5 text-[12.5px] font-semibold', on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500')}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="ac-start" className="text-[12px] font-semibold text-slate-700">From</label>
                <Input id="ac-start" type="time" value={draft.start} onChange={(e) => set('start', e.target.value)} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ac-end" className="text-[12px] font-semibold text-slate-700">Until</label>
                <Input id="ac-end" type="time" value={draft.end} onChange={(e) => set('end', e.target.value)} className="h-10" />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-[12px] font-semibold text-slate-700">Updates in their chat</legend>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-800">
                  <input type="checkbox" checked={draft.brief_enabled} onChange={(e) => set('brief_enabled', e.target.checked)} />
                  Daily brief at
                </label>
                <Input
                  type="time"
                  aria-label="Daily brief time"
                  value={draft.brief_time}
                  disabled={!draft.brief_enabled}
                  onChange={(e) => set('brief_time', e.target.value)}
                  className="h-9 w-40"
                />
                <p className="w-full text-[11.5px] text-slate-500">Counts only — new chats, leads and messages yesterday; waiting and unassigned now. Must be inside their hours.</p>
              </div>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 text-[13px] text-slate-800">
                <input type="checkbox" className="mt-0.5" checked={draft.alerts_enabled} onChange={(e) => set('alerts_enabled', e.target.checked)} />
                <span>
                  Alert when chats pile up
                  <span className="block text-[11.5px] text-slate-500">When the chats waiting for the team reach the line set under Briefs and alerts; at most every 3 hours.</span>
                </span>
              </label>
            </fieldset>
          </div>
          <DialogFooter className="bg-white border-slate-200">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={!valid || (!editing && !person?.mfa_ready)} onClick={() => setAskCode(true)}>
              {editing ? 'Save changes' : 'Add admin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CodeDialog key={askCode ? 'ask' : 'idle'} open={open && askCode} title={editing ? 'Confirm the change' : 'Confirm adding an admin'} onCancel={() => setAskCode(false)} onSubmit={save} />
    </>
  )
}

// ── The page ───────────────────────────────────────────────────────────

export function AdminChatSettings() {
  const confirm = useConfirm()
  const [data, setData] = useState<State | null>(null)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState<null | { title: string; run: (code: string) => Promise<void> }>(null)
  const [dialog, setDialog] = useState<{ open: boolean; editing: Member | null }>({ open: false, editing: null })
  const [verify, setVerify] = useState<null | { code: string; minutes: number; channel: Channel; phone: string | null; name: string }>(null)
  const [rules, setRules] = useState({ keyword: 'ADMIN', idle: '15', max: '60' })
  const [updates, setUpdates] = useState({ threshold: '10', template: '' })
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin-chat', { cache: 'no-store' })
      const body = (await res.json()) as State
      setData(body)
      setRules({ keyword: body.settings.keyword, idle: String(body.settings.idle_minutes), max: String(body.settings.max_minutes) })
      setUpdates({
        threshold: String(body.settings.alert_waiting_threshold),
        template: body.settings.brief_template ? `${body.settings.brief_template.name}|${body.settings.brief_template.language ?? ''}` : '',
      })
      setLoadError('')
    } catch (err) {
      console.error('[admin chat] load failed:', err)
      setLoadError(errorText(err, 'Could not load Admin Chat settings.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function putSettings(body: Record<string, unknown>, success: string) {
    await apiFetch('/api/admin-chat', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    toast.success(success)
    setPending(null)
    await load()
  }

  async function toggle(on: boolean) {
    if (!on) {
      if (busy) return
      setBusy('toggle')
      try {
        await putSettings({ enabled: false }, 'Admin Chat switched off — open sessions ended')
      } catch (err) {
        console.error('[admin chat] switch off failed:', err)
        toast.error(errorText(err, 'Could not switch off.'))
      } finally {
        setBusy('')
      }
      return
    }
    setPending({ title: 'Turn on Admin Chat', run: (code) => putSettings({ enabled: true, totp_code: code }, 'Admin Chat is on') })
  }

  async function endAll() {
    const ok = await confirm({ title: 'End every Admin Chat session?', description: 'Everyone is signed out of Admin Chat now and must send the keyword and a fresh code to come back.', confirmLabel: 'End all sessions', variant: 'destructive' })
    if (!ok || busy) return
    setBusy('endall')
    try {
      const res = await apiFetch('/api/admin-chat/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'end_all' }) })
      const body = (await res.json()) as { ended: number }
      toast.success(body.ended ? `${body.ended} session${body.ended === 1 ? '' : 's'} ended` : 'No sessions were open')
      await load()
    } catch (err) {
      console.error('[admin chat] end all failed:', err)
      toast.error(errorText(err, 'Could not end the sessions.'))
    } finally {
      setBusy('')
    }
  }

  async function remove(m: Member) {
    const ok = await confirm({ title: `Remove ${m.name} from Admin Chat?`, description: 'Their access stops now and any open session ends. Their CRM login is not affected.', confirmLabel: 'Remove', variant: 'destructive' })
    if (!ok || busy) return
    setBusy(`rm-${m.id}`)
    try {
      await apiFetch(`/api/admin-chat/members/${m.id}`, { method: 'DELETE' })
      toast.success(`${m.name} removed from Admin Chat`)
      await load()
    } catch (err) {
      console.error('[admin chat] remove failed:', err)
      toast.error(errorText(err, 'Could not remove.'))
    } finally {
      setBusy('')
    }
  }

  function approve(a: State['approvals'][number]) {
    setPending({
      title: 'Approve this action',
      run: async (code) => {
        const res = await apiFetch(`/api/admin-chat/actions/${a.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', totp_code: code }) })
        const body = (await res.json()) as { summary?: string }
        toast.success(`Done: ${body.summary ?? a.summary}`)
        setPending(null)
        await load()
      },
    })
  }

  async function reject(a: State['approvals'][number]) {
    if (busy) return
    setBusy(`rej-${a.id}`)
    try {
      await apiFetch(`/api/admin-chat/actions/${a.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'reject' }) })
      toast.success('Rejected — nothing was done')
      await load()
    } catch (err) {
      console.error('[admin chat] reject failed:', err)
      toast.error(errorText(err, 'Could not reject.'))
    } finally {
      setBusy('')
    }
  }

  function newCode(m: Member) {
    setPending({
      title: 'New verification code',
      run: async (code) => {
        const res = await apiFetch(`/api/admin-chat/members/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'new_code', totp_code: code }) })
        const body = (await res.json()) as { verify_code: string; verify_minutes: number }
        setPending(null)
        setVerify({ code: body.verify_code, minutes: body.verify_minutes, channel: m.channel, phone: m.phone, name: m.name })
        await load()
      },
    })
  }

  if (loadError && !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
        <p className="text-[13px] text-slate-600">{loadError}</p>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" aria-label="Loading" />
      </div>
    )
  }

  const s = data.settings
  const full = data.members.length >= data.max_members
  const noChannel = !data.channels.whatsapp && !data.channels.telegram

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-slate-800">Admin Chat</h2>
              <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', s.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                {s.enabled ? 'On' : 'Off'}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
              Up to {data.max_members} admins ask about the business — leads, enquiries, chats, registrations — from their own WhatsApp or Telegram, after typing their authenticator code. Changes (for admins allowed actions) need a YES in the chat, and anything that reaches customers is approved here too.
            </p>
          </div>
          <Switch
            checked={s.enabled}
            disabled={Boolean(busy) || !data.me_has_totp}
            onCheckedChange={(v) => void toggle(v)}
            aria-label={s.enabled ? 'Switch Admin Chat off' : 'Switch Admin Chat on'}
          />
        </div>
        {!data.me_has_totp && (
          <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50/70 px-5 py-2.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Turn on the authenticator app for your own login first (Profile → Security). Admin Chat settings ask for it.
          </div>
        )}
        {noChannel && (
          <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50/70 px-5 py-2.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Connect WhatsApp or Telegram first (Settings → Channels).
          </div>
        )}
        <ol className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-4">
          {[
            ['1', `Send ${s.keyword}`, 'From their own phone, to your business WhatsApp or Telegram bot.'],
            ['2', 'Type the code', 'The 6-digit code from their authenticator app.'],
            ['3', 'Ask', 'Typed or as a voice note, in Malayalam or English. Numbers are masked.'],
            ['4', 'STOP', `Or it closes after ${s.idle_minutes} min idle / ${s.max_minutes} min in all.`],
          ].map(([n, title, copy]) => (
            <li key={n} className="bg-white px-4 py-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10.5px] font-bold text-white">{n}</span>
              <p className="mt-2 text-[12.5px] font-semibold text-slate-800">{title}</p>
              <p className="mt-0.5 text-[11.5px] leading-5 text-slate-500">{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* One-time verification code just created */}
      {verify && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5" aria-live="polite">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-slate-800">
            <ChannelMark channel={verify.channel} className="h-5 w-5" /> Verify {verify.name}’s {verify.channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
          </h3>
          <p className="mt-1 text-[12.5px] text-slate-600">
            {verify.channel === 'whatsapp'
              ? `From ${verify.phone ? `+${verify.phone}` : 'their WhatsApp'}, send this to your business WhatsApp number`
              : `From their own Telegram, send this to @${data.channels.telegram?.username ?? 'your bot'}`}{' '}
            within {verify.minutes} minutes. It is shown only now.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-xl border border-indigo-200 bg-white px-4 py-2 font-mono text-[18px] font-bold tracking-wider text-indigo-700">{verify.code}</code>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(verify.code).then(
                  () => toast.success('Copied'),
                  () => toast.error('Could not copy — select it and copy by hand.'),
                )
              }}
            >
              <Copy className="h-4 w-4" aria-hidden="true" /> Copy
            </Button>
            <Button type="button" variant="outline" onClick={() => setVerify(null)}>
              Done
            </Button>
          </div>
        </section>
      )}

      {/* Waiting for approval */}
      {data.approvals.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5" aria-live="polite">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800">
            <LockKeyhole className="h-4 w-4 text-amber-700" aria-hidden="true" /> Waiting for approval ({data.approvals.length})
          </h3>
          <p className="mt-0.5 text-[12px] text-slate-600">Asked for in Admin Chat. Approving needs your authenticator code.</p>
          <ul className="mt-3 space-y-2">
            {data.approvals.map((a) => {
              const mine = a.requested_by === data.me
              const canApprove = a.needs_other_approver ? !mine : mine
              return (
                <li key={a.id} className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-white p-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-semibold text-slate-800">{a.summary}</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-500">
                      Asked by {a.requested_by_name} · {fmt(a.created_at)} · expires {fmt(a.expires_at)}
                      {a.needs_other_approver ? ' · needs another owner or admin' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button type="button" className="h-8 px-3 text-[12px]" disabled={!canApprove || !data.me_has_totp} onClick={() => approve(a)}
                      title={canApprove ? undefined : a.needs_other_approver ? 'Another owner or admin must approve this' : 'Only the admin who asked can confirm this'}>
                      Approve
                    </Button>
                    <Button type="button" variant="destructive" className="h-8 px-3 text-[12px]" disabled={busy === `rej-${a.id}`} onClick={() => void reject(a)}>
                      Reject
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Admins */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Admins ({data.members.length}/{data.max_members})</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">Each has their own number, hours and access. Times are in {data.timezone}.</p>
          </div>
          <Button type="button" onClick={() => setDialog({ open: true, editing: null })} disabled={full || noChannel || !data.me_has_totp || data.candidates.length === 0}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add admin
          </Button>
        </div>
        {data.members.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-[12.5px] text-slate-400">No admins yet. Add one to start.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {data.members.map((m) => {
              const locked = m.locked_until && new Date(m.locked_until) > new Date()
              const live = data.sessions.some((x) => x.member_id === m.id && x.state === 'active')
              return (
                <li key={m.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-3.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <ChannelMark channel={m.channel} className="mt-0.5 h-6 w-6 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-semibold text-slate-800" title={m.name}>{m.name}</span>
                        {m.status === 'pending' ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Waiting for verification</span>
                        ) : locked ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Locked</span>
                        ) : live ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">In a session</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Active</span>
                        )}
                        {!m.mfa_ready && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Authenticator off</span>}
                        {m.brief_enabled && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">Brief {toTime(m.brief_minute)}</span>}
                        {m.alerts_enabled && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">Alerts</span>}
                      </div>
                      <p className="mt-0.5 text-[12px] text-slate-500">
                        {m.channel === 'whatsapp' ? (m.phone ? `+${m.phone}` : 'WhatsApp') : m.telegram_linked ? 'Telegram linked' : 'Telegram'} ·{' '}
                        {m.scope === 'actions' ? 'Reports, find and actions' : m.scope === 'lookup' ? 'Reports + find a customer' : 'Reports only'}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-500">
                        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {describeDays(m.allowed_days)} · {toTime(m.start_minute)}–{toTime(m.end_minute)} · {fmtDate(m.valid_from)} – {fmtDate(m.valid_until)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {m.status === 'pending' && (
                      <Button type="button" variant="outline" className="h-8 px-3 text-[12px]" onClick={() => newCode(m)}>
                        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> New code
                      </Button>
                    )}
                    <Button type="button" variant="outline" className="h-8 px-3 text-[12px]" onClick={() => setDialog({ open: true, editing: m })}>
                      Change
                    </Button>
                    <Button type="button" variant="destructive" className="h-8 px-3 text-[12px]" disabled={busy === `rm-${m.id}`} onClick={() => void remove(m)} aria-label={`Remove ${m.name}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Session rules */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800">
            <LockKeyhole className="h-4 w-4 text-indigo-600" aria-hidden="true" /> Session rules
          </h3>
          <p className="mt-0.5 text-[12px] text-slate-500">The keyword only wakes the bot — the authenticator code is what keeps it safe.</p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              setPending({
                title: 'Save session rules',
                run: (code) =>
                  putSettings({ keyword: rules.keyword, idle_minutes: Number(rules.idle), max_minutes: Number(rules.max), totp_code: code }, 'Session rules saved'),
              })
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="ac-keyword" className="text-[12px] font-semibold text-slate-700">Keyword</label>
              <Input id="ac-keyword" name="admin-keyword" autoComplete="off" autoCapitalize="characters" maxLength={20} value={rules.keyword} onChange={(e) => setRules((r) => ({ ...r, keyword: e.target.value.replace(/\s/g, '') }))} className="h-10 font-mono uppercase" />
            </div>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="ac-idle" className="text-[12px] font-semibold text-slate-700">Close when idle (min)</label>
                <Input id="ac-idle" type="number" min={5} max={60} value={rules.idle} onChange={(e) => setRules((r) => ({ ...r, idle: e.target.value }))} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ac-max" className="text-[12px] font-semibold text-slate-700">Longest session (min)</label>
                <Input id="ac-max" type="number" min={10} max={240} value={rules.max} onChange={(e) => setRules((r) => ({ ...r, max: e.target.value }))} className="h-10" />
              </div>
            </div>
            <Button type="submit" variant="outline" disabled={!data.me_has_totp}>
              Save rules
            </Button>
          </form>
        </section>

        {/* Open sessions + kill switch */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800">
              <UserRound className="h-4 w-4 text-indigo-600" aria-hidden="true" /> Open sessions
            </h3>
            <Button type="button" variant="destructive" className="h-8 px-3 text-[12px]" disabled={busy === 'endall'} onClick={() => void endAll()}>
              {busy === 'endall' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Power className="h-3.5 w-3.5" aria-hidden="true" />}
              End all sessions
            </Button>
          </div>
          {data.sessions.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-[12.5px] text-slate-400">Nobody is in Admin Chat right now.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.sessions.map((x) => (
                <li key={x.id} className="flex items-center gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
                  <ChannelMark channel={x.channel} className="h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-slate-800">{x.name}</p>
                    <p className="text-[11.5px] text-slate-500">
                      {x.state === 'active' ? `Since ${fmt(x.started_at)} · ${x.questions} question${x.questions === 1 ? '' : 's'}` : 'Waiting for the code'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Briefs and alerts */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-[14px] font-semibold text-slate-800">Briefs and alerts</h3>
        <p className="mt-0.5 text-[12px] text-slate-500">
          Switched on per admin (Change). Telegram always delivers. WhatsApp delivers as a normal message within 24 hours of the admin’s last message to you; after that only an approved template can go.
        </p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            const [name, language] = updates.template.split('|')
            setPending({
              title: 'Save briefs and alerts',
              run: (code) =>
                putSettings(
                  { alert_waiting_threshold: Number(updates.threshold), brief_template: name ? { name, language: language || null } : null, totp_code: code },
                  'Briefs and alerts saved',
                ),
            })
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="ac-threshold" className="text-[12px] font-semibold text-slate-700">Alert at (chats waiting)</label>
            <Input id="ac-threshold" type="number" min={1} max={1000} value={updates.threshold} onChange={(e) => setUpdates((u) => ({ ...u, threshold: e.target.value }))} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ac-template" className="text-[12px] font-semibold text-slate-700">WhatsApp template (outside 24 hours)</label>
            <select
              id="ac-template"
              value={updates.template}
              onChange={(e) => setUpdates((u) => ({ ...u, template: e.target.value }))}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800"
            >
              <option value="">None — WhatsApp briefs only within 24 hours</option>
              {data.templates.map((t) => (
                <option key={`${t.name}|${t.language ?? ''}`} value={`${t.name}|${t.language ?? ''}`}>
                  {t.name}{t.language ? ` (${t.language})` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline" disabled={!data.me_has_totp}>
            Save
          </Button>
        </form>
        {data.templates.length === 0 && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] leading-5 text-slate-600">
            No suitable template yet. In Templates, create a <b>Utility</b> template with two variables and get it approved, for example:{' '}
            <span className="font-mono">Daily update for {'{{1}}'}: {'{{2}}'}. Reply {s.keyword} for details.</span>
          </p>
        )}
      </section>

      {/* Activity */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Activity</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">Every sign-in, question and change. Each entry is chained to the one before, so an edit shows.</p>
          </div>
          <span
            className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', data.audit_chain.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}
          >
            {data.audit_chain.ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {data.audit_chain.ok ? `Log intact (${data.audit_chain.rows})` : `Log changed at entry ${data.audit_chain.brokenAtId}`}
          </span>
        </div>
        {data.audit.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-[12.5px] text-slate-400">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.audit.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="w-32 shrink-0 text-[11.5px] tabular-nums text-slate-400">{fmt(a.created_at)}</span>
                <span className="text-[12.5px] font-semibold text-slate-700">{EVENT_LABEL[a.event] ?? a.event}</span>
                <span className="min-w-0 flex-1 break-words text-[12px] text-slate-500">
                  {[a.name, typeof a.detail?.question === 'string' ? `“${a.detail.question}”` : null, typeof a.detail?.reason === 'string' ? a.detail.reason.replace(/_/g, ' ') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog.open && (
      <MemberDialog
        key={dialog.editing?.id ?? 'new'}
        open={dialog.open}
        data={data}
        editing={dialog.editing}
        onClose={() => setDialog({ open: false, editing: null })}
        onSaved={(v) => {
          setDialog({ open: false, editing: null })
          if (v) setVerify(v)
          void load()
        }}
      />
      )}
      <CodeDialog key={pending?.title ?? 'none'} open={pending !== null} title={pending?.title ?? ''} onCancel={() => setPending(null)} onSubmit={async (code) => { if (pending) await pending.run(code) }} />
    </div>
  )
}
