'use client'

/**
 * Which subjects one agent handles.
 *
 * ── Why ticks and not a proficiency score ───────────────────────────
 *
 * Microsoft's own guidance for skills-based routing recommends rating
 * each skill one to ten, on the grounds that coarser bands lose
 * precision when several agents share a skill. That is sound advice for
 * a floor of eighty agents and nonsense for a team of five: nobody
 * fills in forty honest numbers, and a scale everybody sets to 7 routes
 * worse than a tick, because it looks like data.
 *
 * Yes or no. If a team grows to the point where the difference between
 * a 6 and an 8 would change who gets a conversation, the column can
 * hold a number then.
 *
 * ── Why nothing ticked means everything ─────────────────────────────
 *
 * An agent with no subjects set is offered anything, which is both the
 * right default and the only correct answer for a business that has not
 * set subjects up at all. The alternative — treating empty as "handles
 * nothing" — would silently remove every agent from routing the moment
 * the feature shipped.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Tags } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Category {
  key: string
  label: string
  hint?: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: { user_id: string; full_name: string; handles_categories?: string[] | null }
  onSaved: () => void
}

export function AgentSubjectsDialog({ open, onOpenChange, member, onSaved }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/service-categories', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { categories: Category[] }
      setCategories(data.categories)
    } catch {
      // An empty list is also the state of an account with no subjects,
      // and the dialog says what to do about that.
    } finally {
      setLoading(false)
    }
  }, [])

  // Reset on open, not on mount: one dialog serves whichever row was
  // clicked, and keeping the last person's ticks is how somebody
  // rewrites the wrong agent's subjects.
  useEffect(() => {
    if (!open) return
    setPicked(new Set(member.handles_categories ?? []))
    void load()
  }, [open, member.handles_categories, load])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles_categories: [...picked] }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        toast.error(payload.error || 'Could not save that')
        return
      }
      toast.success('Saved')
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
              <Tags className="h-3.5 w-3.5" />
            </span>
            What {member.full_name || 'this member'} handles
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Conversations about these subjects are offered to them first. Tick nothing and they are
            offered anything.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
          </div>
        ) : categories.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-[12.5px] leading-relaxed text-slate-500">
            No subjects set up yet. Add them in Settings &rsaquo; Leads &rsaquo; What you handle —
            there is a button there that works them out from your own conversations.
          </p>
        ) : (
          <div className="space-y-1.5">
            {categories.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={picked.has(c.key)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p)
                      if (e.target.checked) n.add(c.key)
                      else n.delete(c.key)
                      return n
                    })
                  }
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-slate-800">{c.label}</span>
                  {c.hint && (
                    <span className="block text-[11.5px] leading-relaxed text-slate-500">
                      {c.hint}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          This is a preference, not a rule. If nobody who handles a subject is free, it still goes
          to whoever is — a customer waiting is worse than a conversation in the wrong hands, and
          the person who gets it is told why.
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || categories.length === 0}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
