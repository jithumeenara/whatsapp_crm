'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CalendarClock, Pencil, Trash2, Repeat, Clock, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { ScheduledMessage, ScheduledMessageStatus } from '@/types'
import { ScheduleMessageDialog } from './schedule-message-dialog'

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

const STATUS_LABEL: Record<ScheduledMessageStatus, string> = {
  active: 'Pending',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  expired: 'Expired',
}
const STATUS_COLOR: Record<ScheduledMessageStatus, string> = {
  active: 'bg-indigo-100 text-indigo-700',
  paused: 'bg-slate-100 text-slate-600',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  failed: 'bg-rose-100 text-rose-700',
  expired: 'bg-amber-100 text-amber-700',
}

function formatSchedule(sm: ScheduledMessage): string {
  const at = new Date(sm.next_send_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  if (sm.schedule_type === 'once') return `Once · ${at}`
  return `Every ${sm.interval_value} ${sm.interval_unit} · ${sm.sends_count}/${sm.max_sends} sent`
}

interface ScheduledMessagesPanelProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  conversationId: string
}

export function ScheduledMessagesPanel({ open, onOpenChange, conversationId }: ScheduledMessagesPanelProps) {
  const [items, setItems] = useState<ScheduledMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [editItem, setEditItem] = useState<ScheduledMessage | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/scheduled-messages?conversation_id=${conversationId}`)
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [conversationId])

  useEffect(() => { if (open) load() }, [open, load])

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/scheduled-messages/${id}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Failed to cancel'); return }
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'cancelled' } : it)))
      toast.success('Scheduled message cancelled')
    } finally {
      setDeletingId(null)
    }
  }

  const canEditOrDelete = (status: ScheduledMessageStatus) => status === 'active' || status === 'paused' || status === 'failed'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg bg-white p-0 overflow-hidden rounded-3xl gap-0 max-h-[85vh] overflow-y-auto">
          <DialogHeader className="px-6 pt-6 pb-5 bg-gradient-to-br from-indigo-50 to-white">
            <DialogTitle className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
              <CalendarClock className="h-4 w-4 text-indigo-500" />
              Scheduled Messages
            </DialogTitle>
            <p className="text-[12px] text-slate-400 mt-0.5">Every message scheduled for this conversation.</p>
          </DialogHeader>

          <div className="px-6 pb-6 pt-1">
            {loading ? (
              <div className="space-y-2 py-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />)}
              </div>
            ) : items.length === 0 ? (
              <p className="text-center text-[13px] text-slate-400 py-8">No scheduled messages yet.</p>
            ) : (
              <div className="space-y-2">
                {items.map((sm) => (
                  <div key={sm.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', STATUS_COLOR[sm.status])}>
                            {STATUS_LABEL[sm.status]}
                          </span>
                          {sm.schedule_type === 'recurring' && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                              <Repeat className="h-3 w-3" /> Recurring
                            </span>
                          )}
                          {sm.media_url && <ImageIcon className="h-3 w-3 text-slate-400" />}
                        </div>
                        <p className="mt-1.5 text-[13px] text-slate-800 line-clamp-2">{sm.content_text || '(image only)'}</p>
                        {sm.buttons && sm.buttons.length > 0 && (
                          <p className="mt-1 text-[11px] text-indigo-500">
                            Buttons: {sm.buttons.map((b) => b.title).join(' · ')}
                          </p>
                        )}
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock className="h-3 w-3" /> {formatSchedule(sm)}
                        </p>
                        {sm.status === 'failed' && sm.error_message && (
                          <p className="mt-1 flex items-start gap-1 text-[11px] text-rose-500">
                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {sm.error_message}
                          </p>
                        )}
                        {sm.status === 'expired' && (
                          <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-600">
                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> Never sent — too long overdue
                          </p>
                        )}
                      </div>

                      {canEditOrDelete(sm.status) && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => setEditItem(sm)} title="Edit"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-indigo-600">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => handleDelete(sm.id)} disabled={deletingId === sm.id} title="Delete"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-rose-600 disabled:opacity-50">
                            {deletingId === sm.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ScheduleMessageDialog
        open={!!editItem}
        onOpenChange={(v) => { if (!v) setEditItem(null) }}
        conversationId={conversationId}
        editItem={editItem}
        onScheduled={() => { setEditItem(null); load() }}
      />
    </>
  )
}
