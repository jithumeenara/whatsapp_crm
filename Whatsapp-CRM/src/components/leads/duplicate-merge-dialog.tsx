'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Copy, Loader2, Merge, X, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Finding the same person entered twice, and folding them into one.
 *
 * ── Why the survivor is chosen, not computed ────────────────────────
 *
 * The obvious rule — keep the newest, or the one with the most
 * activity — is wrong often enough to matter. The row worth keeping is
 * usually the one an agent has been working, and that is a judgement
 * about who spoke to the customer, which the database does not hold.
 * So the oldest is *suggested*, everything each row carries is shown,
 * and a person decides.
 *
 * ── Why the counts are on screen ────────────────────────────────────
 *
 * A merge deletes rows. Somebody about to do that should be able to see
 * that the one they are discarding has four activities and a follow-up
 * on it — all of which move across, which is exactly the fact that
 * makes the merge safe to agree to.
 */

interface DuplicateLead {
  id: string
  title: string
  status: string
  score: string | null
  source: string | null
  created_at: string
  updated_at: string
  assignee?: { id: string; email: string; profile?: { full_name: string } | null } | null
  _count: { activities: number; follow_ups: number; tasks: number }
}

interface DuplicateGroup {
  contact: { id: string; name: string | null; phone: string } | null
  leads: DuplicateLead[]
}

export function DuplicateMergeDialog({
  open,
  onClose,
  onMerged,
}: {
  open: boolean
  onClose: () => void
  onMerged: () => void
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [busyContact, setBusyContact] = useState<string | null>(null)
  const [keepBy, setKeepBy] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/leads/duplicates')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not look for duplicates.')
      setGroups(data.groups ?? [])
      // The oldest is suggested, not imposed — see the header.
      const initial: Record<string, string> = {}
      for (const g of data.groups ?? []) {
        if (g.contact?.id && g.leads?.[0]) initial[g.contact.id] = g.leads[0].id
      }
      setKeepBy(initial)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not look for duplicates.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function merge(group: DuplicateGroup) {
    const contactId = group.contact?.id
    if (!contactId) return
    const keepId = keepBy[contactId]
    if (!keepId) return

    setBusyContact(contactId)
    try {
      const res = await fetch('/api/leads/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keep_id: keepId,
          merge_ids: group.leads.filter((l) => l.id !== keepId).map((l) => l.id),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not merge those leads.')
      toast.success(
        `Merged ${data.merged} into one — ${data.moved.activities} activities carried across`,
      )
      setGroups((prev) => prev.filter((g) => g.contact?.id !== contactId))
      onMerged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not merge those leads.')
    } finally {
      setBusyContact(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="grid max-h-[88dvh] w-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-slate-100 px-6 py-4 text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[16px] font-semibold text-slate-900">
              Duplicate leads
            </DialogTitle>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              The same contact with more than one open lead. Pick the one to keep — its history
              gains everything the others carry, and nothing is lost.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking…
            </div>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
              <p className="mt-2 text-[13px] font-medium text-slate-600">No duplicates</p>
              <p className="mt-0.5 text-[12px] text-slate-400">
                Every contact has at most one open lead.
              </p>
            </div>
          ) : (
            groups.map((group) => {
              const contactId = group.contact?.id ?? ''
              const keepId = keepBy[contactId]
              const busy = busyContact === contactId
              return (
                <div key={contactId} className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-slate-800">
                        {group.contact?.name || group.contact?.phone || 'Unknown contact'}
                      </p>
                      <p className="text-[11.5px] text-slate-400">
                        {group.leads.length} open leads · {group.contact?.phone}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => merge(group)}
                      disabled={busy || !keepId}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Merge className="h-3.5 w-3.5" />}
                      Merge into one
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {group.leads.map((lead) => {
                      const keeping = lead.id === keepId
                      return (
                        <label
                          key={lead.id}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 transition-colors',
                            keeping
                              ? 'bg-indigo-50 ring-indigo-200'
                              : 'bg-slate-50/60 ring-slate-200/70 hover:bg-slate-50',
                          )}
                        >
                          <input
                            type="radio"
                            name={`keep-${contactId}`}
                            checked={keeping}
                            onChange={() => setKeepBy((prev) => ({ ...prev, [contactId]: lead.id }))}
                            className="h-3.5 w-3.5 shrink-0 border-slate-300 text-indigo-600 focus:ring-indigo-400"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-medium text-slate-800">
                              {lead.title}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {lead.status.replace(/_/g, ' ')}
                              {lead.assignee
                                ? ` · ${lead.assignee.profile?.full_name || lead.assignee.email}`
                                : ' · unassigned'}
                              {' · '}
                              {new Date(lead.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          {/* What this row carries. The number is the
                              reason a merge is safe to agree to: it all
                              moves across. */}
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                            {lead._count.activities} events
                            {lead._count.follow_ups > 0 && ` · ${lead._count.follow_ups} follow-up`}
                          </span>
                          {keeping && (
                            <span className="shrink-0 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-indigo-700">
                              Keep
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The entry point, shown on the leads page only when there is
 *  something to fix — a button that always says zero is a button people
 *  learn to ignore. */
export function DuplicatesButton({ onClick, count }: { onClick: () => void; count: number }) {
  if (count === 0) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-[12.5px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
    >
      <Copy className="h-3.5 w-3.5" />
      {count} duplicate{count === 1 ? '' : 's'}
    </button>
  )
}
