"use client"

/**
 * The business's own funnel stage for this lead (Settings → Reports).
 * Shows nothing until the business has set stages up. A won or lost stage
 * closes the lead, so it asks first.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Flag, Loader2 } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import type { FunnelStage } from "@/lib/reports/settings"

export function LeadStageCard({ leadId, onChanged, readOnly = false }: { leadId: string; onChanged: () => void; readOnly?: boolean }) {
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/leads/${leadId}/stage`)
      const body = (await res.json()) as { stages?: FunnelStage[]; current?: string | null }
      setStages(Array.isArray(body.stages) ? body.stages : [])
      setCurrent(body.current ?? null)
    } catch (err) {
      // The card is optional: a failed read leaves the rest of the page working.
      console.error("[lead stage] load failed:", err)
    }
  }, [leadId])

  useEffect(() => { void load() }, [load])

  async function mark(stage: FunnelStage) {
    if (saving || stage.key === current) return
    if (stage.outcome !== "open" && !window.confirm(`"${stage.label}" closes this lead as ${stage.outcome}. Continue?`)) return
    setSaving(stage.key)
    try {
      await apiFetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funnel_stage: stage.key }),
      })
      setCurrent(stage.key)
      toast.success(stage.outcome === "open" ? `Stage: ${stage.label}` : `Closed: ${stage.label}`)
      onChanged()
    } catch (err) {
      console.error("[lead stage] save failed:", err)
      toast.error(errorText(err, "Could not save the stage. Try again."))
    } finally {
      setSaving(null)
    }
  }

  if (stages.length === 0) return null
  const tone = { open: "border-indigo-500 bg-indigo-50 text-indigo-700", won: "border-emerald-500 bg-emerald-50 text-emerald-700", lost: "border-rose-400 bg-rose-50 text-rose-700" }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Flag className="h-3.5 w-3.5" aria-hidden /> Stage
      </p>
      <div role="group" aria-label="Stage" className="flex flex-wrap gap-2">
        {stages.map((s) => {
          const on = s.key === current
          return (
            <button key={s.key} type="button" aria-pressed={on} disabled={readOnly || saving !== null} onClick={() => void mark(s)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-60 ${on ? tone[s.outcome] : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              {saving === s.key && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
              {s.label}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11.5px] text-slate-500">Mark the furthest step this lead has reached. Reports count it.</p>
    </div>
  )
}
