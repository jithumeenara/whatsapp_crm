'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Trophy, ThumbsDown, Sparkles } from 'lucide-react'

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface PipelineStageLite { id: string; name: string; stage_type: string; color: string }
interface PipelineLite { id: string; name: string; stages: PipelineStageLite[] }
interface ReasonLite { icon: string; label: string }

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
  const [reason, setReason] = useState('')
  const [reasons, setReasons] = useState<ReasonLite[]>([])
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  const [addToPipeline, setAddToPipeline] = useState(false)
  const [pipelines, setPipelines] = useState<PipelineLite[]>([])
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')

  useEffect(() => {
    if (!open) return
    setOutcome('won')
    setReason('')
    setRemarks('')
    setAddToPipeline(false)
    setPipelineId('')
    setStageId('')
    fetch('/api/pipelines')
      .then((r) => r.json())
      .then((d) => setPipelines(Array.isArray(d.pipelines) ? d.pipelines : []))
      .catch(() => {})
    // Admin-configurable list (Settings → Leads → Close Enquiry Reasons)
    fetch('/api/leads/settings')
      .then((r) => r.json())
      .then((d) => setReasons(Array.isArray(d.close_enquiry_reasons) ? d.close_enquiry_reasons : []))
      .catch(() => {})
  }, [open])

  // Picking a reason seeds the remarks field (still freely editable) so
  // agents get a consistent starting point instead of typing from scratch.
  function selectReason(label: string) {
    setReason(label)
    if (!remarks.trim()) setRemarks(label)
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)

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
      <DialogContent className="sm:max-w-lg bg-white p-0 overflow-hidden rounded-3xl gap-0">
        <DialogHeader
          className={cn(
            "px-6 pt-6 pb-5 transition-colors",
            outcome === "won" ? "bg-gradient-to-br from-emerald-50 to-white" : "bg-gradient-to-br from-rose-50 to-white",
          )}
        >
          <DialogTitle className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
            <Sparkles className={cn("h-4 w-4", outcome === "won" ? "text-emerald-500" : "text-rose-500")} />
            Close Enquiry
          </DialogTitle>
          <p className="text-[12px] text-slate-400 mt-0.5">Record the final outcome for this lead.</p>
        </DialogHeader>

        <div className="px-6 pb-6 pt-1 space-y-5">
          {/* Won / Lost */}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setOutcome('won')}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl border-2 py-4 transition-all",
                outcome === 'won'
                  ? "border-emerald-500 bg-emerald-50 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"
                  : "border-slate-100 bg-white hover:border-emerald-200 hover:bg-emerald-50/40",
              )}>
              <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", outcome === "won" ? "bg-emerald-500 text-white" : "bg-emerald-50 text-emerald-500")}>
                <Trophy className="h-5 w-5" />
              </div>
              <span className={cn("text-[13px] font-bold", outcome === "won" ? "text-emerald-700" : "text-slate-600")}>Won</span>
            </button>
            <button type="button" onClick={() => setOutcome('lost')}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl border-2 py-4 transition-all",
                outcome === 'lost'
                  ? "border-rose-500 bg-rose-50 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]"
                  : "border-slate-100 bg-white hover:border-rose-200 hover:bg-rose-50/40",
              )}>
              <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", outcome === "lost" ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-500")}>
                <ThumbsDown className="h-5 w-5" />
              </div>
              <span className={cn("text-[13px] font-bold", outcome === "lost" ? "text-rose-700" : "text-slate-600")}>Lost</span>
            </button>
          </div>

          {reasons.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Reason</label>
              <select value={reason} onChange={(e) => selectReason(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400">
                <option value="">Select a reason…</option>
                {reasons.map((r) => <option key={r.label} value={r.label}>{r.icon ? `${r.icon} ` : ""}{r.label}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              {outcome === 'won' ? 'Closing Notes' : 'Reason for Losing'} <span className="text-rose-500">*</span>
            </label>
            <textarea
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-800 min-h-[90px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={outcome === 'won' ? 'What closed this deal…' : 'Why this enquiry is being lost…'}
              autoFocus
            />
          </div>

          {/* Add to Pipeline */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-slate-700">Add to Pipeline</span>
              <button type="button" role="switch" aria-checked={addToPipeline}
                onClick={() => setAddToPipeline((v) => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  addToPipeline ? "bg-indigo-600" : "bg-slate-200",
                )}>
                <span className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                  addToPipeline ? "translate-x-4" : "translate-x-0",
                )} />
              </button>
            </div>
            {addToPipeline && (
              <div className="grid grid-cols-2 gap-2">
                <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                  <option value="">Select pipeline…</option>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={stageId} onChange={(e) => setStageId(e.target.value)} disabled={!selectedPipeline}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50">
                  <option value="">Select stage…</option>
                  {selectedPipeline?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
              className="h-10 px-4 rounded-xl text-[13px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={handleConfirm}
              disabled={saving || !remarks.trim() || (addToPipeline && (!pipelineId || !stageId))}
              className={cn(
                "h-10 px-5 rounded-xl text-[13px] font-bold text-white flex items-center gap-2 disabled:opacity-50 transition-colors",
                outcome === "won" ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600",
              )}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
