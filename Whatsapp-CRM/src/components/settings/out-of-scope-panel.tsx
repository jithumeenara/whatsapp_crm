'use client'

/**
 * Things this business does not offer, and what to say about them.
 *
 * ── Why this is not the "Never count these" box ─────────────────────
 *
 * There is already a box that stops a job enquiry becoming a lead. It
 * keeps the leads list clean and does nothing else — the assistant
 * still has no answer, so it still interrupts somebody, who types "no,
 * we don't have a hostel" and goes back to what they were doing. The
 * customer waited twenty minutes for one word.
 *
 * This list carries the reply. That is the entire difference, and it is
 * why the answer field is required: an entry without one would silence
 * the alert and leave the customer with nothing, which is worse than
 * the behaviour it replaced.
 *
 * ── Why there is no button to work this out ─────────────────────────
 *
 * The category list next door has one, because a business's subjects
 * can be read off its own knowledge base. This cannot. Nothing in a
 * knowledge base distinguishes "we have no hostel" from "nobody has
 * written the hostel page yet", and a model asked to guess would
 * eventually tell a customer that a real service does not exist — the
 * worst thing this system could do.
 *
 * So it starts empty on purpose and fills from what actually happens.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, ShieldOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface Entry {
  key: string
  question: string
  answer: string
  seen_count?: number
}

export function OutOfScopePanel() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/out-of-scope', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { entries: Entry[] }
      setEntries(data.entries)
    } catch {
      // Silent: an empty panel is also the correct state for a new
      // account, so there is nothing to explain.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: Entry[]) {
    // Caught here rather than by the server, so the message arrives
    // while the person is still looking at the empty box.
    const halfMade = next.find((e) => e.question.trim() && !e.answer.trim())
    if (halfMade) {
      toast.error(
        `"${halfMade.question.trim()}" has no answer yet. Without one the assistant would stay quiet and tell the customer nothing.`,
      )
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/out-of-scope', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: next.filter((e) => e.question.trim() && e.answer.trim()) }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        toast.error(payload.error || 'Could not save that')
        return
      }
      const data = (await res.json()) as { entries: Entry[] }
      setEntries(data.entries)
      toast.success('Saved')
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  function patch(i: number, field: 'question' | 'answer', value: string) {
    setEntries((e) => e.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50">
          <ShieldOff className="h-4 w-4 text-amber-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-slate-800">Things you don&rsquo;t offer</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            Questions you get often where the answer is no. The assistant answers these itself, in
            your words, and nobody gets interrupted — so the customer hears back in seconds instead
            of waiting for a person to type one sentence.
          </p>

          {loading ? (
            <div className="mt-5 flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
            </div>
          ) : (
            <>
              {entries.length === 0 && (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-5">
                  <p className="text-[12.5px] leading-relaxed text-slate-600">
                    Nothing here yet, which is the right place to start. Add one when you notice
                    the same question arriving and getting the same short no.
                  </p>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">
                    For example — <span className="text-slate-500">Do you have a hostel?</span> →{' '}
                    <span className="text-slate-500">
                      We don&rsquo;t run a hostel, but there are PGs close to the centre.
                    </span>
                  </p>
                </div>
              )}

              <div className="mt-4 space-y-2.5">
                {entries.map((entry, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start gap-2">
                      <Input
                        value={entry.question}
                        onChange={(e) => patch(i, 'question', e.target.value)}
                        placeholder="What people ask — Do you have a hostel?"
                        className="h-9 rounded-lg border-slate-200 text-[13px]"
                      />
                      <button
                        type="button"
                        onClick={() => setEntries((e) => e.filter((_, idx) => idx !== i))}
                        aria-label="Remove this one"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Textarea
                      value={entry.answer}
                      onChange={(e) => patch(i, 'answer', e.target.value)}
                      rows={2}
                      placeholder="What to tell them. This is what the customer will read, so write it the way you would say it."
                      className="mt-2 rounded-lg border-slate-200 text-[12.5px]"
                    />
                    {entry.seen_count ? (
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        Asked {entry.seen_count} times before this was added.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEntries((e) => [...e, { key: '', question: '', answer: '' }])}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add one
                </Button>
                {entries.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => void save(entries)}
                    disabled={saving}
                    className="ml-auto"
                  >
                    {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Save
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
