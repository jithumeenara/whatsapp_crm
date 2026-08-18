'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CalendarClock, Loader2, Repeat, Send, Save, LayoutTemplate, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { ScheduledMessage, MessageTemplate } from '@/types'
import { TemplatePicker, type TemplateSendValues } from './template-picker'

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1
    return params[idx] ?? `{{${raw}}}`
  })
}

function toLocalDateInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toLocalTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface SelectedTemplate {
  name: string
  language: string
  bodyParams: string[]
  headerText?: string
  buttonParams?: Record<number, string>
  preview: string
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
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [selected, setSelected] = useState<SelectedTemplate | null>(null)

  const [scheduleType, setScheduleType] = useState<'once' | 'recurring'>('once')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [intervalValue, setIntervalValue] = useState(1)
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('days')
  const [stopOnReply, setStopOnReply] = useState(true)
  const [maxSends, setMaxSends] = useState(3)

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editItem) {
      setSelected({
        name: editItem.template_name ?? '',
        language: editItem.template_language ?? '',
        bodyParams: editItem.template_body_params ?? [],
        headerText: editItem.template_header_text ?? undefined,
        buttonParams: editItem.template_button_params ?? undefined,
        preview: editItem.content_text || editItem.template_name || '',
      })
      setScheduleType(editItem.schedule_type)
      setDate(toLocalDateInput(editItem.next_send_at))
      setTime(toLocalTimeInput(editItem.next_send_at))
      setIntervalValue(editItem.interval_value ?? 1)
      setIntervalUnit(editItem.interval_unit ?? 'days')
      setStopOnReply(editItem.stop_on_reply)
      setMaxSends(editItem.max_sends || 3)
    } else {
      setSelected(null)
      setScheduleType('once')
      setDate('')
      setTime('09:00')
      setIntervalValue(1)
      setIntervalUnit('days')
      setStopOnReply(true)
      setMaxSends(3)
    }
  }, [open, editItem])

  function handleTemplateSelect(template: MessageTemplate, values: TemplateSendValues) {
    setSelected({
      name: template.name,
      language: template.language ?? 'en_US',
      bodyParams: values.body,
      headerText: values.headerText,
      buttonParams: values.buttonParams,
      preview: renderTemplateBody(template.body_text, values.body),
    })
    setTemplatePickerOpen(false)
  }

  const canSubmit = !!selected && (scheduleType === 'once' ? !!date : intervalValue >= 1)

  async function handleSubmit() {
    if (!canSubmit || !selected) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        conversation_id: conversationId,
        template_name: selected.name,
        template_language: selected.language,
        template_body_params: selected.bodyParams.length > 0 ? selected.bodyParams : undefined,
        template_header_text: selected.headerText || undefined,
        template_button_params: selected.buttonParams,
        content_text: selected.preview,
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg bg-white p-0 overflow-hidden rounded-3xl gap-0 max-h-[90vh] overflow-y-auto">
          <DialogHeader className="px-6 pt-6 pb-5 bg-gradient-to-br from-indigo-50 to-white">
            <DialogTitle className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
              <CalendarClock className="h-4 w-4 text-indigo-500" />
              {isEdit ? 'Edit Scheduled Message' : 'Schedule Message'}
            </DialogTitle>
            <p className="text-[12px] text-slate-400 mt-0.5">
              {isEdit ? 'Changes restart this message’s progress.' : 'Send an approved template later, or on a repeating schedule.'}
            </p>
          </DialogHeader>

          <div className="px-6 pb-6 pt-1 space-y-5">
            {/* Template selection — scheduled sends must use an approved
                template, since WhatsApp rejects free-form text/media once
                the customer's 24h session window closes, which a
                scheduled (especially recurring, multi-day) send routinely
                runs into. */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                Template <span className="text-rose-500">*</span>
              </label>
              {selected ? (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[12px] font-bold text-indigo-700">
                        <LayoutTemplate className="h-3.5 w-3.5" /> {selected.name}
                      </p>
                      <p className="mt-1 text-[13px] text-slate-700 line-clamp-3">{selected.preview}</p>
                    </div>
                    <button type="button" onClick={() => setTemplatePickerOpen(true)}
                      className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-indigo-500 hover:bg-white" title="Change template">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setTemplatePickerOpen(true)}
                  className="flex w-full items-center justify-center gap-2 h-11 rounded-2xl border border-dashed border-indigo-300 text-[13px] font-semibold text-indigo-600 hover:bg-indigo-50">
                  <LayoutTemplate className="h-4 w-4" /> Choose Template
                </button>
              )}
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

      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onSelect={handleTemplateSelect}
      />
    </>
  )
}
