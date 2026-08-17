'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CalendarClock, Loader2 } from 'lucide-react'

interface ScheduleFollowupDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (data: { due_at: string; note: string }) => Promise<void>
}

export function ScheduleFollowupDialog({ open, onOpenChange, onSave }: ScheduleFollowupDialogProps) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDate('')
    setTime('09:00')
    setNote('')
  }, [open])

  const handleSave = async () => {
    if (!date) return
    setSaving(true)
    try {
      const due_at = new Date(`${date}T${time || '09:00'}:00`).toISOString()
      await onSave({ due_at, note })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white p-0 overflow-hidden rounded-3xl gap-0">
        <DialogHeader className="px-6 pt-6 pb-5 bg-gradient-to-br from-purple-50 to-white">
          <DialogTitle className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
            <CalendarClock className="h-4 w-4 text-purple-500" />
            Schedule Follow-up
          </DialogTitle>
          <p className="text-[12px] text-slate-400 mt-0.5">Pick a date to be reminded about this lead.</p>
        </DialogHeader>

        <div className="px-6 pb-6 pt-1 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                Date <span className="text-rose-500">*</span>
              </label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Remarks</label>
            <textarea
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-800 min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What to follow up on…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
              className="h-10 px-4 rounded-xl text-[13px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !date}
              className="h-10 px-5 rounded-xl text-[13px] font-bold text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Follow-up
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
