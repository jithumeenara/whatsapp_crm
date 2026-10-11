'use client'

/**
 * The Forms card: link a form (its Data Store table is made from its
 * questions), then each form's responses, last read, Sync now, keep in
 * sync, unlink. Unlinking keeps the table and everything in it.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/hooks/use-confirm'
import { apiFetch, errorText } from '@/lib/api-fetch'
import { pickGoogleDriveFile } from '@/lib/google/picker-client'

interface FormLink {
  id: string
  table_id: string
  form_title: string | null
  responder_url: string | null
  auto_sync: boolean
  records: number
  last_synced_at: string | null
  last_error: string | null
}

export function GoogleFormsLinks() {
  const [links, setLinks] = useState<FormLink[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()

  const load = useCallback(async () => {
    try {
      const d = (await (await apiFetch('/api/google/forms')).json()) as { links?: FormLink[] }
      setLinks(d.links ?? [])
      setLoadError('')
    } catch (err) {
      console.error('[google forms] load failed:', err)
      setLoadError(errorText(err, 'Could not load the linked forms.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function linkForm() {
    if (busy) return
    setBusy('link')
    try {
      const picked = await pickGoogleDriveFile('form')
      if (!picked) return
      const res = await apiFetch('/api/google/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: picked.id }),
      })
      const d = (await res.json()) as { imported: number }
      toast.success(`“${picked.name}” linked — ${d.imported} response${d.imported === 1 ? '' : 's'} brought in`)
      await load()
    } catch (err) {
      console.error('[google forms] link failed:', err)
      toast.error(errorText(err, 'Could not link that form.'))
    } finally {
      setBusy(null)
    }
  }

  async function act(l: FormLink, what: 'sync' | 'auto' | 'unlink') {
    if (busy) return
    if (what === 'unlink') {
      const ok = await confirm({
        title: 'Unlink this form?',
        description: 'New responses stop arriving. The table and the records already in it stay.',
        confirmLabel: 'Unlink',
        variant: 'destructive',
      })
      if (!ok) return
    }
    setBusy(`${what}-${l.id}`)
    try {
      if (what === 'sync') {
        const d = (await (await apiFetch(`/api/google/forms/${l.id}`, { method: 'POST' })).json()) as { imported: number }
        toast.success(d.imported ? `${d.imported} new response${d.imported === 1 ? '' : 's'}` : 'No new responses')
      } else if (what === 'auto') {
        await apiFetch(`/api/google/forms/${l.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_sync: !l.auto_sync }),
        })
      } else {
        await apiFetch(`/api/google/forms/${l.id}`, { method: 'DELETE' })
        toast.success('Form unlinked')
      }
      await load()
    } catch (err) {
      console.error(`[google forms] ${what} failed:`, err)
      toast.error(errorText(err, 'That did not work.'))
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 space-y-2 pl-[52px] text-[12px] text-slate-700">
      {loadError && <p className="text-red-600">{loadError}</p>}
      {links?.map((l) => (
        <div key={l.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/data/${l.table_id}`} className="min-w-0 flex-1 truncate font-medium text-indigo-700 hover:underline">
              {l.form_title || 'Google Form'}
            </a>
            <span className="text-slate-500">{l.records} record{l.records === 1 ? '' : 's'}</span>
            {l.responder_url && (
              <a href={l.responder_url} target="_blank" rel="noopener noreferrer" title="Open the form" className="text-slate-400 hover:text-slate-700">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={l.auto_sync} disabled={!!busy} onChange={() => void act(l, 'auto')} />
              Every 15 minutes
            </label>
            <button type="button" disabled={!!busy} onClick={() => void act(l, 'sync')} className="flex items-center gap-1 font-medium text-indigo-600 hover:underline disabled:opacity-50">
              {busy === `sync-${l.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sync now
            </button>
            <button type="button" disabled={!!busy} onClick={() => void act(l, 'unlink')} className="text-slate-500 hover:text-red-600 disabled:opacity-50">
              Unlink
            </button>
            <span className="text-slate-400">
              {l.last_synced_at ? `Read ${new Date(l.last_synced_at).toLocaleString()}` : 'Not read yet'}
            </span>
          </div>
          {l.last_error && <p className="mt-1 text-[11.5px] text-amber-700">{l.last_error}</p>}
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void linkForm()}>
        {busy === 'link' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />} Link a form
      </Button>
      <p className="text-[11px] text-slate-400">
        A Data Store table is made from the form&apos;s questions. Responses arrive as records, with alerts like a web form.
      </p>
    </div>
  )
}
