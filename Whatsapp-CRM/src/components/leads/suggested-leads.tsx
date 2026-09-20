'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, X, Loader2, Sparkles, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * What the assistant thinks is a lead, waiting on somebody to agree.
 *
 * ── Why the reason is the biggest thing on the row ──────────────────
 *
 * The decision being asked for is "is this person worth calling", and
 * the only thing that answers it is what they actually said. A score
 * out of a hundred does not — it asks the reader to trust a number they
 * cannot check, and the first time it is wrong they stop trusting all
 * of them. So the row leads with the assistant's sentence, in the
 * customer's own words where it could quote them, and the name and
 * number sit underneath it.
 *
 * ── Why rejecting is as easy as accepting ───────────────────────────
 *
 * The two buttons are the same size and sit side by side. A reject that
 * is harder to reach than an accept produces a tab people clear by
 * accepting everything, and then the accuracy figure measures nothing
 * but how tired the person was.
 */

interface Suggestion {
  id: string
  title: string
  ai_reason: string | null
  ai_confidence: string | null
  created_at: string
  contact?: { id: string; name: string | null; phone: string; avatar_url: string | null } | null
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  medium: 'bg-amber-50 text-amber-700 border-amber-100',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
}

export function SuggestedLeads({ onReviewed }: { onReviewed?: () => void }) {
  const [rows, setRows] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/leads?tab=suggested&limit=100')
      const json = await res.json()
      setRows(json.leads ?? [])
    } catch {
      toast.error('Could not load suggestions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function review(id: string, decision: 'accepted' | 'rejected') {
    setBusy((b) => new Set(b).add(id))
    // Removed from the list before the request finishes. The decision
    // has been made; leaving the row in place while a spinner turns
    // invites a second click on something already gone.
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      const res = await fetch('/api/leads/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: id, decision }),
      })
      if (!res.ok) throw new Error()
      toast.success(decision === 'accepted' ? 'Added to New Leads' : 'Dismissed')
      onReviewed?.()
    } catch {
      toast.error('Could not save that — putting it back.')
      void load()
    } finally {
      setBusy((b) => {
        const next = new Set(b)
        next.delete(id)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading suggestions…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-slate-300" />
        <p className="mt-2 text-[13px] font-medium text-slate-600">Nothing waiting</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-slate-400">
          When the assistant reads a conversation and thinks somebody is worth calling back, it
          will appear here for you to accept or dismiss.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12.5px] text-slate-500">
          {rows.length} conversation{rows.length === 1 ? '' : 's'} the assistant thinks{' '}
          {rows.length === 1 ? 'is' : 'are'} worth following up. Nothing here is in the lead pool
          yet.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row) => {
          const name = row.contact?.name || row.title
          const phone = row.contact?.phone
          const confidence = row.ai_confidence ?? 'medium'
          return (
            <div
              key={row.id}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-50">
                <MessageSquare className="h-3.5 w-3.5 text-violet-600" />
              </div>

              <div className="min-w-0 flex-1">
                {/* The reason first — it is the thing being judged. */}
                <p className="text-[13px] leading-relaxed text-slate-800">
                  {row.ai_reason || 'Looked like a genuine enquiry.'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-slate-500">
                  <span className="font-medium text-slate-700">{name}</span>
                  {phone && <span className="tabular-nums">{phone}</span>}
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-px text-[10.5px] font-medium capitalize',
                      CONFIDENCE_STYLE[confidence] ?? CONFIDENCE_STYLE.medium,
                    )}
                  >
                    {confidence} confidence
                  </span>
                </div>
              </div>

              {/* Same size, side by side. See this file's header. */}
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy.has(row.id)}
                  onClick={() => review(row.id, 'rejected')}
                  title="Not a lead"
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Not a lead
                </button>
                <button
                  type="button"
                  disabled={busy.has(row.id)}
                  onClick={() => review(row.id, 'accepted')}
                  title="Add to New Leads"
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-[#5B6CF9] px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#4a5ce8] disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="pt-1 text-[11px] text-slate-400">
        Dismissing removes the suggestion for good — that person will not be offered again. Both
        answers are counted, and the accuracy figure in Settings is what they add up to.
      </p>
    </div>
  )
}
