'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CalendarClock, Clock, CheckCircle2, AlertCircle } from 'lucide-react'

interface ContactSummary {
  contact_id: string
  name: string
  phone: string
  conversation_id: string
  pending: number
  completed: number
  error: number
}

interface ScheduledContactsOverviewProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** Account-wide view (not scoped to one conversation): every contact with
 *  at least one scheduled message, and how many are pending/completed/
 *  erroring for each. Lives at the Inbox level, next to search. */
export function ScheduledContactsOverview({ open, onOpenChange }: ScheduledContactsOverviewProps) {
  const router = useRouter()
  const [items, setItems] = useState<ContactSummary[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/scheduled-messages/contacts-summary')
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // load() only ever calls setState inside its own body (never directly
    // in this effect) -- same pattern as ScheduledMessagesPanel's load,
    // which the linter accepts. It only flags this one because `load`'s
    // useCallback has an empty dep array (nothing here actually varies),
    // which the plugin's heuristic inlines for analysis instead of
    // treating as an opaque reference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load()
  }, [open, load])

  function goToContact(conversationId: string) {
    onOpenChange(false)
    router.push(`/inbox?c=${conversationId}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white p-0 overflow-hidden rounded-3xl gap-0 max-h-[85vh] overflow-y-auto">
        <DialogHeader className="px-6 pt-6 pb-5 bg-gradient-to-br from-indigo-50 to-white">
          <DialogTitle className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
            <CalendarClock className="h-4 w-4 text-indigo-500" />
            Scheduled Messages
          </DialogTitle>
          <p className="text-[12px] text-slate-400 mt-0.5">Every contact with a scheduled message, across the whole inbox.</p>
        </DialogHeader>

        <div className="px-6 pb-6 pt-1">
          {loading ? (
            <div className="space-y-2 py-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-2xl animate-pulse" />)}
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-[13px] text-slate-400 py-8">No scheduled messages anywhere yet.</p>
          ) : (
            <div className="space-y-2">
              {items.map((c) => (
                <button
                  key={c.contact_id}
                  type="button"
                  onClick={() => goToContact(c.conversation_id)}
                  className="w-full flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5 text-left hover:bg-slate-100 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</p>
                    <p className="text-[11px] text-slate-400">{c.phone}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.pending > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                        <Clock className="h-3 w-3" /> {c.pending}
                      </span>
                    )}
                    {c.completed > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> {c.completed}
                      </span>
                    )}
                    {c.error > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                        <AlertCircle className="h-3 w-3" /> {c.error}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
