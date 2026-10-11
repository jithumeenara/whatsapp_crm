'use client'

/**
 * The Calendar card's settings: when the assistant may book, how long a
 * slot is, and what syncs. "Show free times" runs the same check the
 * assistant runs, so what is offered to customers can be seen first.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch, errorText } from '@/lib/api-fetch'
import type { CalendarSettings } from '@/lib/google/calendar'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SLOT_LENGTHS = [15, 20, 30, 45, 60, 90, 120]

export function GoogleCalendarSettings() {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState<CalendarSettings | null>(null)
  const [timezone, setTimezone] = useState('')
  const [synced, setSynced] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [slots, setSlots] = useState<Array<{ start: string; label: string }> | null>(null)

  useEffect(() => {
    if (!open || s) return
    let live = true
    apiFetch('/api/google/calendar')
      .then((r) => r.json())
      .then((d: { settings?: CalendarSettings; timezone?: string; synced?: number }) => {
        if (!live) return
        if (d.settings) setS(d.settings)
        setTimezone(d.timezone ?? '')
        setSynced(d.synced ?? 0)
      })
      .catch((err) => {
        console.error('[calendar settings] load failed:', err)
        if (live) setLoadError(errorText(err, 'Could not load the calendar settings.'))
      })
    return () => {
      live = false
    }
  }, [open, s])

  const set = <K extends keyof CalendarSettings>(k: K, v: CalendarSettings[K]) => setS((p) => (p ? { ...p, [k]: v } : p))

  async function save() {
    if (!s || saving) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/google/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: s }),
      })
      const d = (await res.json()) as { settings: CalendarSettings }
      setS(d.settings)
      setSlots(null)
      toast.success('Calendar settings saved')
    } catch (err) {
      console.error('[calendar settings] save failed:', err)
      toast.error(errorText(err, 'Could not save the calendar settings.'))
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    if (testing) return
    setTesting(true)
    try {
      const res = await apiFetch('/api/google/calendar', { method: 'POST' })
      const d = (await res.json()) as { slots?: Array<{ start: string; label: string }> }
      setSlots(d.slots ?? [])
    } catch (err) {
      console.error('[calendar settings] test failed:', err)
      toast.error(errorText(err, 'Could not read the calendar.'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mt-3 pl-[52px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-slate-900"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} /> Booking &amp; sync settings
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[12px] text-slate-700">
          {!s ? (
            loadError ? <p className="text-red-600">{loadError}</p> : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={s.booking} onChange={(e) => set('booking', e.target.checked)} />
                The AI assistant may book appointments
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={s.meet} onChange={(e) => set('meet', e.target.checked)} />
                Add a Google Meet link to bookings
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-500">Slot length</span>
                  <select
                    value={s.slotMinutes}
                    onChange={(e) => set('slotMinutes', Number(e.target.value))}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2"
                  >
                    {SLOT_LENGTHS.map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-500">Days ahead</span>
                  <Input type="number" min={1} max={60} value={s.daysAhead} onChange={(e) => set('daysAhead', Number(e.target.value))} className="h-8" />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-500">Day starts</span>
                  <Input type="time" value={s.dayStart} onChange={(e) => set('dayStart', e.target.value)} className="h-8" />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-500">Day ends</span>
                  <Input type="time" value={s.dayEnd} onChange={(e) => set('dayEnd', e.target.value)} className="h-8" />
                </label>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500">Working days</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {DAYS.map((d, i) => {
                    const on = s.workDays.includes(i)
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => set('workDays', on ? s.workDays.filter((x) => x !== i) : [...s.workDays, i].sort())}
                        className={`rounded-md border px-2 py-1 text-[11.5px] ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500'}`}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2">
                Earliest booking
                <Input type="number" min={0} max={72} value={s.leadHours} onChange={(e) => set('leadHours', Number(e.target.value))} className="h-8 w-16" />
                hours from now
              </label>
              <div className="space-y-1.5 border-t border-slate-200 pt-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={s.syncFollowUps} onChange={(e) => set('syncFollowUps', e.target.checked)} />
                  Put follow-ups and call-backs on the calendar (changes there come back)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={s.syncTasks} onChange={(e) => set('syncTasks', e.target.checked)} />
                  Put tasks with a due date on the calendar
                </label>
                <p className="text-[11px] text-slate-400">
                  Times are in the business time zone{timezone ? ` (${timezone})` : ''}. Sync runs every 5 minutes; {synced} follow-up{synced === 1 ? '' : 's'} on the calendar now.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={testing} onClick={() => void test()}>
                  {testing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Show free times
                </Button>
              </div>
              {slots && (
                slots.length === 0 ? (
                  <p className="text-amber-700">No free times with these settings — the assistant would have nothing to offer.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {slots.map((x) => (
                      <li key={x.start} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11.5px] text-emerald-800">{x.label}</li>
                    ))}
                  </ul>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
