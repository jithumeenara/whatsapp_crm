'use client'

import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CalendarClock, Loader2, Image as ImageIcon, X, Plus, Repeat, Send, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { ScheduledMessage } from '@/types'

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

function toLocalDateInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toLocalTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface ScheduleMessageDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  conversationId: string
  /** When set, edits this existing scheduled message instead of creating a new one. */
  editItem?: ScheduledMessage | null
  onScheduled?: () => void
}

export function ScheduleMessageDialog({ open, onOpenChange, conversationId, editItem, onScheduled }: ScheduleMessageDialogProps) {
  const isEdit = !!editItem
  const [text, setText] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [buttons, setButtons] = useState<string[]>([])

  const [scheduleType, setScheduleType] = useState<'once' | 'recurring'>('once')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [intervalValue, setIntervalValue] = useState(1)
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('days')
  const [stopOnReply, setStopOnReply] = useState(true)
  const [maxSends, setMaxSends] = useState(3)

  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    if (editItem) {
      setText(editItem.content_text ?? '')
      setMediaUrl(editItem.media_url ?? '')
      setButtons((editItem.buttons ?? []).map((b) => b.title))
      setScheduleType(editItem.schedule_type)
      setDate(toLocalDateInput(editItem.next_send_at))
      setTime(toLocalTimeInput(editItem.next_send_at))
      setIntervalValue(editItem.interval_value ?? 1)
      setIntervalUnit(editItem.interval_unit ?? 'days')
      setStopOnReply(editItem.stop_on_reply)
      setMaxSends(editItem.max_sends || 3)
    } else {
      setText('')
      setMediaUrl('')
      setButtons([])
      setScheduleType('once')
      setDate('')
      setTime('09:00')
      setIntervalValue(1)
      setIntervalUnit('days')
      setStopOnReply(true)
      setMaxSends(3)
    }
  }, [open, editItem])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) { toast.error('Upload failed'); return }
      const { url } = await res.json()
      setMediaUrl(url)
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function addButton() {
    if (buttons.length >= 3) return
    setButtons((prev) => [...prev, ''])
  }
  function updateButton(i: number, value: string) {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? value : b)))
  }
  function removeButton(i: number) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i))
  }

  const canSubmit =
    (text.trim() || mediaUrl) &&
    (scheduleType === 'once' ? !!date : intervalValue >= 1) &&
    buttons.every((b) => b.trim())

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      const validButtons = buttons.filter((b) => b.trim())
      const body: Record<string, unknown> = {
        conversation_id: conversationId,
        content_text: text.trim() || undefined,
        media_url: mediaUrl || undefined,
        media_type: mediaUrl ? 'image' : undefined,
        buttons: validButtons.length > 0
          ? validButtons.map((title, i) => ({ id: `btn_${i}`, title: title.slice(0, 20) }))
          : undefined,
        schedule_type: scheduleType,
        stop_on_reply: stopOnReply,
        max_sends: scheduleType === 'recurring' ? maxSends : 1,
      }
      if (scheduleType === 'once') {
        body.scheduled_at = new Date(`${date}T${time || '09:00'}:00`).toISOString()
      } else {
        body.interval_value = intervalValue
        body.interval_unit = intervalUnit
        if (date) body.scheduled_at = new Date(`${date}T${time || '09:00'}:00`).toISOString()
      }

      const res = await fetch(isEdit ? `/api/scheduled-messages/${editItem!.id}` : '/api/scheduled-messages', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || (isEdit ? 'Failed to save changes' : 'Failed to schedule message'))
        return
      }
      toast.success(isEdit ? 'Scheduled message updated' : scheduleType === 'once' ? 'Message scheduled' : 'Recurring message scheduled')
      onOpenChange(false)
      onScheduled?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white p-0 overflow-hidden rounded-3xl gap-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="px-6 pt-6 pb-5 bg-gradient-to-br from-indigo-50 to-white">
          <DialogTitle className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
            <CalendarClock className="h-4 w-4 text-indigo-500" />
            {isEdit ? 'Edit Scheduled Message' : 'Schedule Message'}
          </DialogTitle>
          <p className="text-[12px] text-slate-400 mt-0.5">
            {isEdit ? 'Changes restart this message’s progress.' : 'Send a message later, or on a repeating schedule.'}
          </p>
        </DialogHeader>

        <div className="px-6 pb-6 pt-1 space-y-5">
          {/* Message content */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Message</label>
            <textarea
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-800 min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What should this message say…"
              autoFocus
            />
          </div>

          {/* Image */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Image (optional)</label>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
            {mediaUrl ? (
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl} alt="Attached" className="h-24 w-24 rounded-xl object-cover border border-slate-200" />
                <button type="button" onClick={() => setMediaUrl('')}
                  className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-white hover:bg-slate-900">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-2 h-10 px-4 rounded-xl border border-dashed border-slate-300 text-[13px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                {uploading ? 'Uploading…' : 'Add image'}
              </button>
            )}
          </div>

          {/* Buttons — like the chatbot's Send Buttons node */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Buttons (optional, up to 3)</label>
              {buttons.length < 3 && (
                <button type="button" onClick={addButton} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
                  <Plus className="h-3 w-3" /> Add button
                </button>
              )}
            </div>
            {buttons.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={b} onChange={(e) => updateButton(i, e.target.value)} maxLength={20}
                  placeholder={`Button ${i + 1} label…`}
                  className="flex-1 h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
                <button type="button" onClick={() => removeButton(i)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Schedule type */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setScheduleType('once')}
              className={cn("h-10 rounded-xl border text-[13px] font-semibold transition-colors",
                scheduleType === 'once' ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")}>
              One time
            </button>
            <button type="button" onClick={() => setScheduleType('recurring')}
              className={cn("h-10 rounded-xl border text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-colors",
                scheduleType === 'recurring' ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")}>
              <Repeat className="h-3.5 w-3.5" /> Recurring
            </button>
          </div>

          {/* Once: date+time. Recurring: interval + optional start */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  {scheduleType === 'once' ? 'Date' : 'Start date (optional)'} {scheduleType === 'once' && <span className="text-rose-500">*</span>}
                </label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Time</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>

            {scheduleType === 'recurring' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Repeat every</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} value={intervalValue} onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                    <select value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as typeof intervalUnit)}
                      className="flex-1 h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-700">Stop when customer replies</span>
                  <button type="button" role="switch" aria-checked={stopOnReply} onClick={() => setStopOnReply((v) => !v)}
                    className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors", stopOnReply ? "bg-indigo-600" : "bg-slate-200")}>
                    <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", stopOnReply ? "translate-x-4" : "translate-x-0")} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Maximum times to send</label>
                  <input type="number" min={1} value={maxSends} onChange={(e) => setMaxSends(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
              className="h-10 px-4 rounded-xl text-[13px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving || !canSubmit}
              className="h-10 px-5 rounded-xl text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? <Save className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {isEdit ? 'Save Changes' : 'Schedule'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
