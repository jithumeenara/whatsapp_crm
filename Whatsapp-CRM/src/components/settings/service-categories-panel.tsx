'use client'

/**
 * The list of subjects this business handles.
 *
 * ── Why the first thing on screen is a button, not a blank row ──────
 *
 * This list cannot ship in the product — a hospital's is Ortho and
 * Dental, a coaching institute's is LGS and LDC, and the fourth
 * customer is always one nobody thought of. So it has to be typed by
 * the owner, and an owner facing an empty box does not type it. Ever.
 * That is how configurable features die, and it has nothing to do with
 * how well they were built.
 *
 * The business has already told us who it is several times over: its
 * industry, its own description of itself, every entry in its knowledge
 * base and a few hundred real conversations. One button reads all of
 * that and proposes the list, with how often each subject actually came
 * up beside it. Editing a list that is already mostly right is a
 * completely different act from writing one from nothing.
 *
 * ── Why the hint field is not optional-feeling ──────────────────────
 *
 * Classification accuracy falls as labels multiply and start to
 * overlap, and the fix is almost never a better model — it is one
 * sentence saying where Ortho ends and Physio begins. So the hint sits
 * on the row rather than behind an "advanced" disclosure, with a
 * placeholder that shows what a useful one looks like.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Sparkles, Tags, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Row {
  key: string
  label: string
  hint: string
}

interface Suggestion extends Row {
  seen: number
}

/** The ceiling the server also enforces. A business with forty real
 *  departments is better served by twelve that route correctly than by
 *  forty that get guessed between. */
const MAX = 20

/** A key from a label, for rows typed by hand. Latin letters only, so a
 *  Malayalam label falls back to a generated key rather than an empty
 *  one the server would silently drop. */
function keyFrom(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || `c${Date.now().toString(36).slice(-5)}`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

export function ServiceCategoriesPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finding, setFinding] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/service-categories', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { categories: Array<Row & { id: string }> }
      setRows(data.categories.map((c) => ({ key: c.key, label: c.label, hint: c.hint ?? '' })))
    } catch {
      // Silent: the panel simply starts empty, which is also the state
      // of a brand new account and needs no explanation.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: Row[]) {
    setSaving(true)
    try {
      const res = await fetch('/api/service-categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: next }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        toast.error(payload.error || 'Could not save that')
        return
      }
      const data = (await res.json()) as { categories: Array<Row & { id: string }> }
      setRows(data.categories.map((c) => ({ key: c.key, label: c.label, hint: c.hint ?? '' })))
      toast.success('Saved')
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  async function findThem() {
    setFinding(true)
    try {
      const res = await fetch('/api/service-categories/suggest', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not work out the list')
        return
      }
      const found = (data.categories ?? []) as Suggestion[]
      if (found.length === 0) {
        toast.info('Nothing new to add — everything it found is already on the list.')
        return
      }
      setSuggestions(found)
      // Everything ticked to start with. The owner is reviewing a
      // proposal, not assembling one, and untick is a cheaper gesture
      // than tick-fifteen-times.
      setPicked(new Set(found.map((f) => f.key)))
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setFinding(false)
    }
  }

  function addPicked() {
    if (!suggestions) return
    const taken = new Set(rows.map((r) => r.key))
    const added = suggestions
      .filter((sug) => picked.has(sug.key) && !taken.has(sug.key))
      .map((sug) => ({ key: sug.key, label: sug.label, hint: sug.hint }))
    const next = [...rows, ...added].slice(0, MAX)
    setSuggestions(null)
    void save(next)
  }

  function addBlank() {
    if (rows.length >= MAX) {
      toast.error(`${MAX} is the limit — accuracy falls when categories start to overlap.`)
      return
    }
    setRows((r) => [...r, { key: '', label: '', hint: '' }])
  }

  function patch(i: number, field: keyof Row, value: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))
  }

  function saveRows() {
    const taken = new Set<string>()
    const next = rows
      .filter((r) => r.label.trim())
      .map((r) => {
        const key = r.key.trim() || keyFrom(r.label, taken)
        taken.add(key)
        return { ...r, key }
      })
    void save(next)
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
          <Tags className="h-4 w-4 text-indigo-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-slate-800">What you handle</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            The subjects a message could be about — departments, courses, product lines. The
            assistant sorts every enquiry into one of these, which is how it knows who to send it
            to.
          </p>

          {loading ? (
            <div className="mt-5 flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
            </div>
          ) : (
            <>
              {/* The proposal. Shown instead of the list while it is on
                  screen, so there is one thing to decide about. */}
              {suggestions ? (
                <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                  <p className="text-[12.5px] font-medium text-slate-700">
                    Found these in your own knowledge and conversations
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500">
                    The number is how often it came up. Untick anything you don&rsquo;t want.
                  </p>
                  <div className="mt-3 space-y-1.5">
                    {suggestions.map((sug) => (
                      <label
                        key={sug.key}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-white/70 px-2.5 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(sug.key)}
                          onChange={(e) =>
                            setPicked((p) => {
                              const n = new Set(p)
                              if (e.target.checked) n.add(sug.key)
                              else n.delete(sug.key)
                              return n
                            })
                          }
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium text-slate-700">
                            {sug.label}
                          </span>
                          {sug.hint && (
                            <span className="block text-[11px] text-slate-500">{sug.hint}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                          {sug.seen > 0 ? `seen ${sug.seen}×` : 'from your profile'}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" onClick={addPicked} disabled={saving || picked.size === 0}>
                      Add {picked.size} to the list
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSuggestions(null)}>
                      Not now
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {rows.length === 0 && (
                    <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
                      <p className="text-[12.5px] text-slate-600">
                        Nothing here yet. Rather than typing the list, let it read your business
                        and propose one.
                      </p>
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {rows.map((row, i) => (
                      <div
                        key={i}
                        className="grid gap-2 rounded-xl border border-slate-200 p-2.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] sm:items-start"
                      >
                        <Input
                          value={row.label}
                          onChange={(e) => patch(i, 'label', e.target.value)}
                          placeholder="Dental"
                          className="h-9 rounded-lg border-slate-200 text-[13px]"
                        />
                        <Input
                          value={row.hint}
                          onChange={(e) => patch(i, 'hint', e.target.value)}
                          placeholder="Teeth, implants, braces — not facial surgery, that is Maxillofacial"
                          className="h-9 rounded-lg border-slate-200 text-[12.5px]"
                        />
                        <button
                          type="button"
                          onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                          aria-label="Remove this one"
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={findThem} disabled={finding}>
                      {finding ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Work it out for me
                    </Button>
                    <Button size="sm" variant="outline" onClick={addBlank}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add one
                    </Button>
                    {rows.length > 0 && (
                      <Button size="sm" onClick={saveRows} disabled={saving} className="ml-auto">
                        {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Save
                      </Button>
                    )}
                  </div>

                  {rows.length > 0 && (
                    <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                      The second box is the one that matters. Two categories that could both
                      describe the same message are the main reason a message gets sorted wrongly,
                      and a line saying where one ends fixes it better than anything else can.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
