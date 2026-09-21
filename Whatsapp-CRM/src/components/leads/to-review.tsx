'use client'

/**
 * Every decision the assistant made, in one place, waiting for a yes.
 *
 * ── Why this replaced two tabs ──────────────────────────────────────
 *
 * There were two: "Suggested" held conversations the assistant thought
 * were leads, and "Not enquiries" held leads it thought were not. Both
 * ask the same question — was it right? — and splitting them meant two
 * habits, of which the second was the one nobody formed.
 *
 * Worse, neither held the conversations the assistant dismissed before
 * a lead existed at all. Those left no trace anywhere, so the mistakes
 * that cost the most were the ones nobody could see. They are here now.
 *
 * ── Why the customer's own words are the largest thing on the row ───
 *
 * Somebody deciding whether the assistant was right needs what it was
 * reading, not a summary of it. The verdict and the reason are support;
 * the quote is the evidence.
 *
 * ── Why "the assistant was right" is a button ───────────────────────
 *
 * It would be easier to record only disagreements and assume silence
 * meant agreement. That makes accuracy climb toward 100% exactly when
 * people stop looking. And without it this list could never be emptied,
 * which is the difference between a queue somebody works and a second
 * inbox they learn to ignore.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Check,
  Loader2,
  MessageSquare,
  Sparkles,
  ThumbsUp,
  UserPlus,
  AlertTriangle,
  Inbox,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Judgement {
  id: string
  conversation_id: string
  contact_id: string | null
  lead_id: string | null
  is_lead: boolean
  not_lead_reason: string | null
  category: string | null
  category_label: string | null
  category_confidence: string
  priority: string
  out_of_scope_key: string | null
  follow_up_phrase: string | null
  reason: string
  acted: boolean
  created_at: string
  customer_said: string | null
  customer_name: string | null
  customer_phone: string | null
}

interface Category {
  key: string
  label: string
}

/** Plain words for the stored keys. The screen never shows a key — an
 *  agent should not have to learn the database's vocabulary to answer
 *  a yes/no question. */
const NOT_LEAD_LABELS: Record<string, string> = {
  existing_customer: 'Existing customer',
  job_application: 'Job application',
  vendor_or_sales: 'Someone selling to us',
  complaint: 'Complaint',
  spam_or_wrong_number: 'Spam or wrong number',
  out_of_scope: 'Something we do not offer',
  unclear: 'Not clear from the message',
}

const PRIORITY_STYLE: Record<string, { dot: string; label: string }> = {
  urgent: { dot: 'bg-rose-500', label: 'Urgent' },
  normal: { dot: 'bg-amber-400', label: 'Normal' },
  quiet: { dot: 'bg-slate-300', label: 'Quiet' },
}

export function ToReview({ onReviewed }: { onReviewed?: () => void }) {
  const router = useRouter()
  const [rows, setRows] = useState<Judgement[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/judgements?scope=open', { cache: 'no-store' })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        toast.error(payload.error || 'Could not load the review list')
        return
      }
      const data = (await res.json()) as { judgements: Judgement[]; categories: Category[] }
      setRows(data.judgements)
      setCategories(data.categories ?? [])
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function review(
    id: string,
    verdict: 'agreed' | 'corrected',
    changes?: { is_lead?: boolean; category?: string },
  ) {
    setBusy(id)
    // Removed from the list before the server answers. The whole value
    // of this screen is that it can be emptied, and a row that lingers
    // for a second after being answered makes it feel like it did not
    // work.
    const previous = rows
    setRows((r) => r.filter((x) => x.id !== id))
    try {
      const res = await fetch(`/api/judgements/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, ...changes }),
      })
      if (!res.ok) {
        setRows(previous)
        const payload = await res.json().catch(() => ({}))
        toast.error(payload.error || 'Could not save that')
        return
      }
      onReviewed?.()
    } catch {
      setRows(previous)
      toast.error('Could not reach the server')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-14 text-center">
        <Inbox className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-3 text-[13.5px] font-medium text-slate-700">Nothing to review</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-slate-500">
          The assistant&rsquo;s decisions land here for a second opinion. An empty list means
          everything has been answered — or that it has not been switched on yet, in Settings
          &rsquo;&rsquo; Leads.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-slate-500">
        {rows.length} {rows.length === 1 ? 'decision' : 'decisions'} waiting. Answering them is
        what teaches the assistant your business — and what makes the accuracy figure real.
      </p>

      {rows.map((j) => {
        const tone = PRIORITY_STYLE[j.priority] ?? PRIORITY_STYLE.normal
        const isBusy = busy === j.id
        return (
          <div
            key={j.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm"
          >
            {/* Who, and how loudly it would have been announced. */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-slate-800">
                  {j.customer_name?.trim() || j.customer_phone || 'Unknown contact'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {new Date(j.created_at).toLocaleString()}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                {tone.label}
              </span>
            </div>

            {/* The evidence. Largest thing on the row on purpose. */}
            {j.customer_said && (
              <p className="mt-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed text-slate-700">
                <MessageSquare className="mr-1.5 inline h-3.5 w-3.5 text-slate-400" />
                {j.customer_said}
              </p>
            )}

            {/* What it decided, and why. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
              {j.is_lead ? (
                <span className="font-medium text-emerald-700">A real enquiry</span>
              ) : (
                <span className="font-medium text-slate-600">
                  Not an enquiry
                  {j.not_lead_reason && (
                    <span className="font-normal text-slate-500">
                      {' '}
                      — {NOT_LEAD_LABELS[j.not_lead_reason] ?? j.not_lead_reason}
                    </span>
                  )}
                </span>
              )}
              {j.category_label && (
                <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">
                  {j.category_label}
                  {/* Said out loud rather than hidden: a category it was
                      unsure of should not be read as one it knew. */}
                  {j.category_confidence !== 'high' && (
                    <span className="font-normal text-indigo-400"> · not sure</span>
                  )}
                </span>
              )}
              {j.follow_up_phrase && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                  asked for &ldquo;{j.follow_up_phrase}&rdquo;
                </span>
              )}
              {!j.acted && (
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-slate-500">
                  watching only
                </span>
              )}
            </div>

            {j.reason && (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">{j.reason}</p>
            )}

            {/* Answering it. Agreeing is one click, because it is the
                common case and a queue that is slow to empty is a queue
                that stops being worked. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => void review(j.id, 'agreed')}
                className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              >
                {isBusy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                )}
                That&rsquo;s right
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => void review(j.id, 'corrected', { is_lead: !j.is_lead })}
              >
                {j.is_lead ? (
                  <>
                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                    Not an enquiry
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    It was an enquiry
                  </>
                )}
              </Button>

              {/* Correcting the subject is a separate act from correcting
                  whether it was a lead — a message can be a genuine
                  enquiry filed under the wrong department. */}
              {categories.length > 0 && (
                <Select
                  value={j.category ?? null}
                  onValueChange={(v) => v && void review(j.id, 'corrected', { category: v })}
                >
                  <SelectTrigger className="h-8 w-40 border-slate-200 text-[12px]" disabled={isBusy}>
                    <SelectValue placeholder="Set the subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <button
                type="button"
                onClick={() => router.push(`/inbox?conversation=${j.conversation_id}`)}
                className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600 hover:text-indigo-700"
              >
                Open the chat
                <Check className="h-3 w-3 opacity-0" aria-hidden />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
