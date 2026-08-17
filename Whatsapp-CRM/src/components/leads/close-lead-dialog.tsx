'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Trophy, ThumbsDown } from 'lucide-react'

interface PipelineStageLite { id: string; name: string; stage_type: string; color: string }
interface PipelineLite { id: string; name: string; stages: PipelineStageLite[] }

export interface CloseLeadResult {
  outcome: 'won' | 'lost'
  remarks: string
  pipelineId?: string
  stageId?: string
}

interface CloseLeadDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onConfirm: (result: CloseLeadResult) => Promise<void>
}

export function CloseLeadDialog({ open, onOpenChange, onConfirm }: CloseLeadDialogProps) {
  const [outcome, setOutcome] = useState<'won' | 'lost'>('won')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  const [addToPipeline, setAddToPipeline] = useState(false)
  const [pipelines, setPipelines] = useState<PipelineLite[]>([])
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')

  useEffect(() => {
    if (!open) return
    // Reset per-open, and load pipelines lazily only once needed
    setOutcome('won')
    setRemarks('')
    setAddToPipeline(false)
    setPipelineId('')
    setStageId('')
    fetch('/api/pipelines')
      .then((r) => r.json())
      .then((d) => setPipelines(Array.isArray(d.pipelines) ? d.pipelines : []))
      .catch(() => {})
  }, [open])

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)

  // Default the stage to the matching Won/Lost close-stage when the pipeline
  // or outcome changes, so the common case needs zero extra clicks.
  useEffect(() => {
    if (!selectedPipeline) return
    const match = selectedPipeline.stages.find((s) => s.stage_type === outcome)
    setStageId(match?.id ?? selectedPipeline.stages[0]?.id ?? '')
  }, [selectedPipeline, outcome])

  const handleConfirm = async () => {
    if (!remarks.trim()) return
    if (addToPipeline && (!pipelineId || !stageId)) return
    setSaving(true)
    try {
      await onConfirm({
        outcome,
        remarks: remarks.trim(),
        pipelineId: addToPipeline ? pipelineId : undefined,
        stageId: addToPipeline ? stageId : undefined,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>Close Enquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          {/* Won / Lost */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setOutcome('won')}
              className={`flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-semibold transition-colors ${
                outcome === 'won' ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100'
              }`}>
              <Trophy className="size-4" /> Won
            </button>
            <button type="button" onClick={() => setOutcome('lost')}
              className={`flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-semibold transition-colors ${
                outcome === 'lost' ? 'bg-rose-500 border-rose-500 text-white' : 'bg-rose-50 border-rose-100 text-rose-700 hover:bg-rose-100'
              }`}>
              <ThumbsDown className="size-4" /> Lost
            </button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              {outcome === 'won' ? 'Closing Notes' : 'Reason for Losing'} <span className="text-destructive">*</span>
            </Label>
            <textarea
              className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm min-h-[90px] resize-none"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={outcome === 'won' ? 'What closed this deal…' : 'Why this enquiry is being lost…'}
              autoFocus
            />
          </div>

          {/* Add to Pipeline */}
          <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
              <input type="checkbox" checked={addToPipeline} onChange={(e) => setAddToPipeline(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
              Add to Pipeline
            </label>
            {addToPipeline && (
              <div className="grid grid-cols-2 gap-2">
                <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                  <option value="">Select pipeline…</option>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={!selectedPipeline}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm disabled:opacity-50">
                  <option value="">Select stage…</option>
                  {selectedPipeline?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={saving || !remarks.trim() || (addToPipeline && (!pipelineId || !stageId))} className="gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />}
              Confirm Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
