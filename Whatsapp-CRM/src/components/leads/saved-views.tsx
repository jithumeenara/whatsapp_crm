'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bookmark, BookmarkPlus, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Filters somebody uses often enough to name.
 *
 * ── Why they are chips rather than a dropdown ───────────────────────
 *
 * A saved view is only worth having if it is faster than setting the
 * filters again, and a dropdown costs two clicks and a read before the
 * first one is saved. As chips they sit beside the tabs, where the eye
 * already is, and a view is one click — which is the entire feature.
 *
 * ── Why "Save this view" is not always there ────────────────────────
 *
 * It appears when the current filters differ from every saved view and
 * from the default. A permanent Save button on an unfiltered list
 * invites saving "everything", which is the default with an extra name
 * on it — and a list of views that includes one doing nothing is a list
 * people stop reading.
 */

export interface LeadFilters {
  tab: string
  tagId?: string
  search?: string
  score?: string
  district?: string
}

export interface SavedView {
  id: string
  name: string
  filters: LeadFilters
}

/** Compared by value, not by reference: two filter sets mean the same
 *  view if they select the same leads, however they were arrived at. */
function sameFilters(a: LeadFilters, b: LeadFilters): boolean {
  const norm = (f: LeadFilters) =>
    JSON.stringify({
      tab: f.tab ?? '',
      tagId: f.tagId ?? '',
      search: f.search ?? '',
      score: f.score ?? '',
      district: f.district ?? '',
    })
  return norm(a) === norm(b)
}

/** True when nothing beyond the tab is set — the default, which is not
 *  worth saving. */
function isBareTab(f: LeadFilters): boolean {
  return !f.tagId && !f.search && !f.score && !f.district
}

export function SavedViews({
  current,
  onApply,
}: {
  current: LeadFilters
  onApply: (filters: LeadFilters) => void
}) {
  const [views, setViews] = useState<SavedView[]>([])
  const [saving, setSaving] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/leads/views')
      if (!res.ok) return
      const data = await res.json()
      setViews(data.views ?? [])
    } catch {
      /* the bar simply does not appear */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const activeView = views.find((v) => sameFilters(v.filters, current))
  const canSave = !isBareTab(current) && !activeView

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const res = await fetch('/api/leads/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, filters: current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not save that view.')
      setViews((prev) => [...prev, data.view])
      setNaming(false)
      setName('')
      toast.success(`Saved "${trimmed}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that view.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(view: SavedView) {
    // Optimistic: the chip is gone from the screen before the request
    // lands, and put back if it fails. A saved view is cheap to recreate
    // and a spinner on a chip is more disruption than the action.
    setViews((prev) => prev.filter((v) => v.id !== view.id))
    try {
      const res = await fetch(`/api/leads/views?id=${encodeURIComponent(view.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
    } catch {
      setViews((prev) => [...prev, view].sort((a, b) => a.name.localeCompare(b.name)))
      toast.error('Could not remove that view.')
    }
  }

  if (views.length === 0 && !canSave) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((view) => {
        const active = activeView?.id === view.id
        return (
          <span
            key={view.id}
            className={cn(
              'group inline-flex h-7 items-center gap-1 rounded-lg pl-2.5 pr-1 text-[12px] ring-1 transition-colors',
              active
                ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
            )}
          >
            <button type="button" onClick={() => onApply(view.filters)} className="flex items-center gap-1.5">
              <Bookmark className={cn('h-3 w-3', active ? 'fill-indigo-600 text-indigo-600' : 'text-slate-300')} />
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => remove(view)}
              aria-label={`Remove ${view.name}`}
              className="rounded p-0.5 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}

      {canSave &&
        (naming ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-white pl-2 pr-1 ring-1 ring-indigo-200">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') { setNaming(false); setName('') }
              }}
              placeholder="Name this view"
              className="w-32 bg-transparent text-[12px] outline-none placeholder:text-slate-300"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="rounded px-1.5 text-[11.5px] font-medium text-indigo-600 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 text-[12px] text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600"
          >
            <BookmarkPlus className="h-3 w-3" />
            Save this view
          </button>
        ))}
    </div>
  )
}
