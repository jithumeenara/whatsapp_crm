'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

interface FollowupInlineFormProps {
  onSave: (data: { due_at: string; note: string }) => Promise<void>
  onCancel: () => void
}

export function FollowupInlineForm({ onSave, onCancel }: FollowupInlineFormProps) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!date) return
    setSaving(true)
    try {
      const due_at = new Date(`${date}T${time || '09:00'}:00`).toISOString()
      await onSave({ due_at, note })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
      <p className="text-sm font-medium text-slate-800">Schedule Follow-up</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Date <span className="text-destructive">*</span></Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Time</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Remarks</Label>
        <textarea
          className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm min-h-[60px] resize-none"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What to follow up on…"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !date} className="gap-1.5">
          {saving && <Loader2 className="size-3 animate-spin" />}
          Save Follow-up
        </Button>
      </div>
    </div>
  )
}
