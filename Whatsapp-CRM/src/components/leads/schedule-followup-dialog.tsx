'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CalendarClock, Loader2 } from 'lucide-react'

interface ScheduleFollowupDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Resolves false when the save failed (the page says why): the dialog stays open. */
  onSave: (data: { due_at: string; note: string }) => Promise<boolean | void>
}

/** Today in the browser's calendar, as the date input wants it (YYYY-MM-DD). */
function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const FIELD = 'w-full h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400'

export function ScheduleFollowupDialog({ open, onOpenChange, onSave }: ScheduleFollowupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so every opening starts empty. */}
      {open && <FollowupForm onOpenChange={onOpenChange} onSave={onSave} />}
    </Dialog>
  )
}

function FollowupForm({ onOpenChange, onSave }: Omit<ScheduleFollowupDialogProps, 'open'>) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!date || saving) return
    // The browser's local time, sent as ISO with its offset (ten bug rules #10).
    const when = new Date(`${date}T${time || '09:00'}:00`)
    if (Number.isNaN(when.getTime())) { setError('Choose a valid date and time.'); return }
    if (when.getTime() < Date.now() - 60_000) { setError('That time has already passed. Choose a later one.'); return }
    setError('')
    setSaving(true)
    try {
      const ok = await onSave({ due_at: when.toISOString(), note: note.trim() })
      if (ok !== false) onOpenChange(false)
    } catch (err) {
      console.warn('[follow-up] not saved:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md bg-white p-0 overflow-hidden rounded-3xl gap-0">
      <DialogHeader className="px-6 pt-6 pb-5 bg-purple-50/60">
        <DialogTitle className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
          <CalendarClock className="h-4 w-4 text-purple-600" aria-hidden="true" />
          Schedule follow-up
        </DialogTitle>
        <DialogDescription className="text-[12px] text-slate-500 mt-0.5">Pick when to be reminded about this lead.</DialogDescription>
      </DialogHeader>

      <div className="px-6 pb-6 pt-4 space-y-4">
        <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="fu-date" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              Date <span className="text-rose-600" aria-hidden="true">*</span>
            </label>
            <input id="fu-date" name="fu-date" autoComplete="off" type="date" required value={date} onChange={(e) => setDate(e.target.value)}
              min={todayLocal()} className={FIELD} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fu-time" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Time</label>
            <input id="fu-time" name="fu-time" autoComplete="off" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="fu-note" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Remarks</label>
          <textarea id="fu-note" name="fu-note" autoComplete="off" maxLength={1000}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-800 min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What to follow up on…"
          />
        </div>

        {error && <p role="alert" className="text-[12px] text-rose-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
            className="h-10 px-4 rounded-xl text-[13px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !date}
            className="h-10 px-5 rounded-xl text-[13px] font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save follow-up'}
          </button>
        </div>
      </div>
    </DialogContent>
  )
}
