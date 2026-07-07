"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, XCircle, Clock, RefreshCw, User } from "lucide-react"
import { toast } from "sonner"

interface FlowRun {
  id: string; status: string; started_at: string; finished_at?: string
  error_message?: string; contact_id?: string; contact?: { name?: string; phone?: string }
}

export default function FlowRunsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [flowName, setFlowName] = useState("")
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [fRes, rRes] = await Promise.all([
        fetch(`/api/flows/${id}`),
        fetch(`/api/flows/${id}/runs`),
      ])
      const fData = await fRes.json()
      const rData = await rRes.json()
      setFlowName((fData.flow ?? fData).name ?? "Flow")
      setRuns(rData.runs ?? [])
    } catch { toast.error("Failed to load runs") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  function duration(run: FlowRun) {
    if (!run.finished_at) return "Running…"
    const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <button onClick={() => router.push(`/flows/${id}`)} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-[16px] font-bold text-slate-800">{flowName} — Runs</h1>
          <p className="text-[12px] text-slate-400">{runs.length} executions</p>
        </div>
        <button onClick={load} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-white rounded-xl animate-pulse" />)}</div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <Clock className="h-8 w-8 mb-2" />
            <p className="text-[14px]">No runs yet — flow hasn't executed</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div key={run.id} className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-4 shadow-sm">
                {run.status === "success" || run.status === "completed"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  : run.status === "error" || run.status === "failed"
                  ? <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
                  : <Clock className="h-4 w-4 text-indigo-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-slate-700 capitalize">{run.status}</p>
                    {(run.contact?.name || run.contact?.phone) && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                        <User className="h-3 w-3" />
                        {run.contact.name ?? run.contact.phone}
                      </span>
                    )}
                  </div>
                  {run.error_message && <p className="text-[11px] text-rose-500 truncate">{run.error_message}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12px] text-slate-400">{new Date(run.started_at).toLocaleString()}</p>
                  <p className="text-[11px] text-slate-300">{duration(run)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
