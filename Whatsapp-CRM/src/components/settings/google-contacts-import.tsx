'use client'

/**
 * The Contacts card's import: choose groups (or all), import, see what
 * happened. Matching is by phone and email, so importing again only adds
 * who is new and fills in what was missing.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch, errorText } from '@/lib/api-fetch'
import type { ContactGroup, ContactsImportResult } from '@/lib/google/contacts'

export function GoogleContactsImport() {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<ContactGroup[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ContactsImportResult | null>(null)

  useEffect(() => {
    if (!open || groups) return
    let live = true
    apiFetch('/api/google/contacts')
      .then((r) => r.json())
      .then((d: { groups?: ContactGroup[] }) => { if (live) setGroups(d.groups ?? []) })
      .catch((err) => {
        console.error('[google contacts] groups failed:', err)
        if (live) setLoadError(errorText(err, 'Could not read the contact groups.'))
      })
    return () => { live = false }
  }, [open, groups])

  async function run() {
    if (running) return
    setRunning(true)
    setResult(null)
    try {
      const res = await apiFetch('/api/google/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: [...chosen] }),
      })
      const r = (await res.json()) as ContactsImportResult
      setResult(r)
      toast.success(`${r.created} contact${r.created === 1 ? '' : 's'} added, ${r.updated} updated`)
    } catch (err) {
      console.error('[google contacts] import failed:', err)
      toast.error(errorText(err, 'The import did not finish.'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mt-3 pl-[52px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-slate-900"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} /> Import contacts
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[12px] text-slate-700">
          {!groups ? (
            loadError ? <p className="text-red-600">{loadError}</p> : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <>
              <div>
                <span className="block text-[11px] text-slate-500">Groups — none ticked imports everyone</span>
                {groups.length === 0 ? (
                  <p className="mt-1 text-slate-400">No groups in this Google account.</p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {groups.map((g) => {
                      const on = chosen.has(g.id)
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() =>
                            setChosen((prev) => {
                              const next = new Set(prev)
                              if (on) next.delete(g.id)
                              else next.add(g.id)
                              return next
                            })
                          }
                          className={`rounded-md border px-2 py-1 text-[11.5px] ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`}
                        >
                          {g.name} <span className="text-slate-400">{g.count}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Matched by phone and email. A contact already here only gains a missing name, email or company. Numbers without a country code take the one most of your contacts have. Imported contacts are not marked as opted in.
              </p>
              <Button type="button" size="sm" disabled={running} onClick={() => void run()}>
                {running && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} {running ? 'Importing…' : 'Import now'}
              </Button>
              {result && (
                <p className="text-slate-600">
                  Read {result.read}: <b>{result.created}</b> added, <b>{result.updated}</b> updated, {result.unchanged} already up to date
                  {result.skipped > 0 ? `, ${result.skipped} skipped (no usable phone number)` : ''}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
