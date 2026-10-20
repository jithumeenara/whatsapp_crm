'use client'

/**
 * Settings → Contact → Tags → ✨ on a tag: may the AI add this tag by
 * meaning, and what does the tag mean. Written for the AI, in the
 * business's own words, in any language.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch, errorText } from '@/lib/api-fetch'
import { cn } from '@/lib/utils'
import type { Tag } from '@/types'

type Mode = 'off' | 'suggest' | 'auto'

const MODES: Array<{ value: Mode; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'The AI never touches this tag.' },
  { value: 'suggest', label: 'Suggest', hint: 'The AI suggests it in the contact panel; a person adds it. Start here.' },
  { value: 'auto', label: 'Add automatically', hint: 'Added when the AI is sure — and its automations run. Anything less sure is a suggestion.' },
]

export function AiTagDialog({ tag, onClose, onSaved }: { tag: Tag; onClose: () => void; onSaved: (t: Tag) => void }) {
  const [mode, setMode] = useState<Mode>(tag.ai_mode ?? 'off')
  const [description, setDescription] = useState(tag.ai_description ?? '')
  const [avoid, setAvoid] = useState(tag.ai_avoid ?? '')
  const [examples, setExamples] = useState((tag.ai_examples ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  const needsMeaning = mode !== 'off' && description.trim().length < 5

  async function save() {
    if (saving || needsMeaning) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/tags/${tag.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_mode: mode,
          ai_description: description,
          ai_avoid: avoid,
          ai_examples: examples.split(/\n|,/).map((e) => e.trim()).filter(Boolean),
        }),
      })
      const body = (await res.json()) as { tag: Tag }
      toast.success(mode === 'off' ? `AI is off for "${tag.name}"` : `AI will ${mode === 'auto' ? 'add' : 'suggest'} "${tag.name}"`)
      onSaved(body.tag)
    } catch (err) {
      console.error('[tags] AI settings failed:', err)
      toast.error(errorText(err, 'Could not save.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="bg-white border-slate-200 text-slate-800 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden="true" /> AI for “{tag.name}”
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            The AI reads a customer&apos;s messages a minute after they write and adds this tag when the meaning fits — in Malayalam, Manglish or English.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <fieldset className="space-y-1.5">
            <legend className="text-[12px] font-semibold text-slate-700">What the AI may do</legend>
            {MODES.map((m) => (
              <label key={m.value} className={cn('flex cursor-pointer gap-2.5 rounded-xl border p-3', mode === m.value ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200')}>
                <input type="radio" name="ai-mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-0.5" />
                <span>
                  <span className="block text-[13px] font-semibold text-slate-800">{m.label}</span>
                  <span className="block text-[12px] text-slate-500">{m.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor="ai-desc" className="text-[12px] font-semibold text-slate-700">Add it when…</label>
            <Textarea
              id="ai-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="e.g. bones, joints, knee or back pain, fractures, sports injuries"
              className="text-[13px]"
              aria-invalid={needsMeaning}
            />
            {needsMeaning && <p className="text-[12px] text-amber-800">Say when it applies — the AI only knows what you tell it.</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ai-avoid" className="text-[12px] font-semibold text-slate-700">Don&apos;t add it when… (optional)</label>
            <Input id="ai-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} maxLength={300} placeholder="e.g. only asking for the bill or a report" className="h-10 text-[13px]" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ai-examples" className="text-[12px] font-semibold text-slate-700">Things customers say (one per line, up to 10)</label>
            <Textarea
              id="ai-examples"
              value={examples}
              onChange={(e) => setExamples(e.target.value)}
              rows={4}
              placeholder={'kaalmuttu vedana\nമുട്ടുവേദന\nknee pain\nnadakkan pattunilla'}
              className="text-[13px]"
            />
            <p className="text-[11.5px] text-slate-400">Mix the ways people write: Malayalam, Manglish, English, short and long.</p>
          </div>
        </div>
        <DialogFooter className="bg-white border-slate-200">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || needsMeaning}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
